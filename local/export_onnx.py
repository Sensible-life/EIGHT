#!/usr/bin/env python3
"""Demucs(HTDemucs) → ONNX 변환 + 검증.  (앱 내장용 첫 단계)

HTDemucs는 내부에서 STFT/iSTFT(복소수 연산)를 쓰기 때문에 그대로는 ONNX/CoreML로
변환이 잘 안 된다. 그래서 신경망 본체(core)만 떼어 내보내고, STFT·iSTFT·청크 분할은
'호스트 코드'(choreo/onnx_separator.py, numpy만 사용)가 담당하게 나눈다.
→ 앱에서는 이 호스트 코드만 Swift/Kotlin/C++로 옮기고 core.onnx는 그대로 쓴다.

  python export_onnx.py                       # htdemucs → models/htdemucs/
  python export_onnx.py --model htdemucs_ft   # 4개 sub-model 각각 export

출력:
  models/<name>/core_0.onnx (…core_N.onnx)
  models/<name>/manifest.json   (sources, samplerate, segment, nfft, hop, bag weights)
"""
import argparse
import json
import os
import sys
import time
from pathlib import Path

os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np  # noqa: E402
import torch  # noqa: E402
from torch import nn  # noqa: E402


class HTDemucsCore(nn.Module):
    """HTDemucs.forward에서 _spec / _mask / _ispec를 뺀 부분.

    입력:  mix (1, 2, L)          — 원 파형 (L = 학습 segment 길이 고정)
           mag (1, 4, 2048, T)    — STFT를 실수/허수 채널로 편 것 (complex-as-channels)
    출력:  spec_out (1, S, 4, 2048, T)  — stem별 스펙트로그램 (실수/허수 채널)
           wave_out (1, S, 2, L)        — 시간 branch 출력
    최종 stem = iSTFT(spec_out) + wave_out
    """

    def __init__(self, m):
        super().__init__()
        self.m = m

    def forward(self, mix, mag):
        m = self.m
        x = mag
        B, C, Fq, T = x.shape
        mean = x.mean(dim=(1, 2, 3), keepdim=True)
        std = x.std(dim=(1, 2, 3), keepdim=True)
        x = (x - mean) / (1e-5 + std)
        xt = mix
        meant = xt.mean(dim=(1, 2), keepdim=True)
        stdt = xt.std(dim=(1, 2), keepdim=True)
        xt = (xt - meant) / (1e-5 + stdt)

        saved, saved_t, lengths, lengths_t = [], [], [], []
        for idx, encode in enumerate(m.encoder):
            lengths.append(x.shape[-1])
            inject = None
            if idx < len(m.tencoder):
                lengths_t.append(xt.shape[-1])
                tenc = m.tencoder[idx]
                xt = tenc(xt)
                if not tenc.empty:
                    saved_t.append(xt)
                else:
                    inject = xt
            x = encode(x, inject)
            if idx == 0 and m.freq_emb is not None:
                frs = torch.arange(x.shape[-2], device=x.device)
                emb = m.freq_emb(frs).t()[None, :, :, None].expand_as(x)
                x = x + m.freq_emb_scale * emb
            saved.append(x)
        if m.crosstransformer:
            if m.bottom_channels:
                b, c, f, t = x.shape
                x = x.reshape(b, c, f * t)
                x = m.channel_upsampler(x)
                x = x.reshape(b, -1, f, t)
                xt = m.channel_upsampler_t(xt)
            x, xt = m.crosstransformer(x, xt)
            if m.bottom_channels:
                x = x.reshape(b, -1, f * t)
                x = m.channel_downsampler(x)
                x = x.reshape(b, -1, f, t)
                xt = m.channel_downsampler_t(xt)
        for idx, decode in enumerate(m.decoder):
            skip = saved.pop(-1)
            x, pre = decode(x, skip, lengths.pop(-1))
            offset = m.depth - len(m.tdecoder)
            if idx >= offset:
                tdec = m.tdecoder[idx - offset]
                length_t = lengths_t.pop(-1)
                if tdec.empty:
                    pre = pre[:, :, 0]
                    xt, _ = tdec(pre, None, length_t)
                else:
                    skip = saved_t.pop(-1)
                    xt, _ = tdec(xt, skip, length_t)
        S = len(m.sources)
        L = mix.shape[-1]
        x = x.view(B, S, -1, Fq, T) * std[:, None] + mean[:, None]
        xt = xt.view(B, S, -1, L) * stdt[:, None] + meant[:, None]
        return x, xt


def sub_models(model):
    from demucs.apply import BagOfModels

    if isinstance(model, BagOfModels):
        w = model.weights if model.weights is not None else [[1.0] * len(model.sources)] * len(model.models)
        return list(model.models), [list(map(float, r)) for r in w]
    return [model], [[1.0] * len(model.sources)]


def export(name: str, out_dir: Path, opset: int, verify: bool = True):
    from demucs.pretrained import get_model

    from choreo.onnx_separator import OnnxCore, host_spec, host_ispec

    # nn.MultiheadAttention의 eval fast-path(_native_multi_head_attention)는 ONNX로 안 나가므로 끔
    torch.backends.mha.set_fastpath_enabled(False)
    bag = get_model(name)
    bag.eval()
    models, weights = sub_models(bag)
    out_dir.mkdir(parents=True, exist_ok=True)
    m0 = models[0]
    seg_len = int(float(m0.segment) * m0.samplerate)
    manifest = {
        "model": name,
        "sources": list(bag.sources),
        "samplerate": int(m0.samplerate),
        "audio_channels": int(m0.audio_channels),
        "segment_samples": seg_len,
        "nfft": int(m0.nfft),
        "hop": int(m0.hop_length),
        "weights": weights,
        "files": [],
        "inputs": {"mix": [1, 2, seg_len], "mag": "(1, 4, nfft/2, ceil(L/hop))"},
        "outputs": ["spec_out (1,S,4,F,T)", "wave_out (1,S,2,L)"],
    }
    rng = np.random.default_rng(0)
    for i, m in enumerate(models):
        core = HTDemucsCore(m).eval()
        mix = torch.from_numpy(rng.standard_normal((1, 2, seg_len)).astype(np.float32) * 0.1)
        mag = torch.from_numpy(host_spec(mix.numpy(), m.nfft, m.hop_length))
        path = out_dir / f"core_{i}.onnx"
        t0 = time.time()
        with torch.no_grad():
            torch.onnx.export(core, (mix, mag), str(path), input_names=["mix", "mag"],
                              output_names=["spec_out", "wave_out"], opset_version=opset, dynamo=False)
        mb = path.stat().st_size / 1e6
        print(f"[{name} #{i}] export {time.time() - t0:.1f}s → {path} ({mb:.0f} MB)")
        manifest["files"].append(path.name)

        if verify:
            # 기준: 원래 PyTorch HTDemucs 전체 forward (STFT 포함)
            with torch.no_grad():
                ref = m(mix).numpy()
            oc = OnnxCore(str(path))
            spec_out, wave_out = oc(mix.numpy(), mag.numpy())
            est = host_ispec(spec_out, m.hop_length, seg_len) + wave_out
            err = np.abs(ref - est).max() / (np.abs(ref).max() + 1e-9)
            print(f"   검증: PyTorch 원본 vs ONNX+호스트 STFT  최대 상대오차 {err:.2e}  {'OK' if err < 1e-3 else '⚠ 큼'}")
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=1))
    print(f"manifest → {out_dir / 'manifest.json'}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="htdemucs")
    ap.add_argument("--out", type=Path, default=None)
    ap.add_argument("--opset", type=int, default=17)
    ap.add_argument("--no-verify", action="store_true")
    a = ap.parse_args()
    export(a.model, a.out or Path("models") / a.model, a.opset, not a.no_verify)


if __name__ == "__main__":
    main()
