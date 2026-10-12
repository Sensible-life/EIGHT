#!/usr/bin/env python3
"""설정별 속도·품질 비교.

  python bench.py song.mp3                                   # 기본 조합 속도 비교
  python bench.py song.mp3 --models htdemucs htdemucs_ft --shifts 1 2 --overlap 0.25 0.5
  python bench.py mixture.wav --ref path/to/stems/            # 정답 stem이 있으면 SDR(dB)까지

--ref 폴더에는 drums.wav, bass.wav, other.wav, vocals.wav 처럼 stem 이름과 같은 파일을 둔다.
(MUSDB18-HQ 샘플이나 직접 가진 멀티트랙으로 확인 가능)
--clip 30 이면 앞 30초만 사용해서 빠르게 비교.
"""
import argparse
import itertools
import json
import os
import sys
import time
from pathlib import Path

os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np  # noqa: E402

from choreo.audio_io import load_audio  # noqa: E402
from choreo.separation import SeparationConfig, make_separator  # noqa: E402


def sdr(ref: np.ndarray, est: np.ndarray) -> float:
    """Demucs/MDX 논문에서 쓰는 전 구간 SDR (dB). 높을수록 좋음."""
    n = min(ref.shape[-1], est.shape[-1])
    ref, est = ref[..., :n], est[..., :n]
    return float(10 * np.log10((np.sum(ref ** 2) + 1e-8) / (np.sum((ref - est) ** 2) + 1e-8)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input", type=Path)
    ap.add_argument("--models", nargs="+", default=["htdemucs", "htdemucs_ft"],
                    help="onnx:<폴더> 를 넣으면 ONNX 엔진으로 (예: onnx:models/htdemucs)")
    ap.add_argument("--shifts", nargs="+", type=int, default=[1])
    ap.add_argument("--overlap", nargs="+", type=float, default=[0.25])
    ap.add_argument("--device", default="auto")
    ap.add_argument("--ref", type=Path, default=None)
    ap.add_argument("--clip", type=float, default=None, help="앞 N초만 사용")
    ap.add_argument("--out", type=Path, default=Path("bench_result.json"))
    a = ap.parse_args()

    rows = []
    cache = {}
    for model, shifts, overlap in itertools.product(a.models, a.shifts, a.overlap):
        cfg = SeparationConfig(model=model, shifts=shifts, overlap=overlap, device=a.device)
        if model not in cache:
            t0 = time.time()
            if model.startswith("onnx:"):
                from choreo.onnx_separator import OnnxDemucsSeparator

                cache[model] = OnnxDemucsSeparator(model[5:])
            else:
                cache[model] = make_separator(cfg)
            print(f"[{model}] 모델 로드 {time.time() - t0:.1f}s")
        sep = cache[model]
        if model.startswith("onnx:"):
            sep.overlap, sep.shifts = overlap, shifts
        else:
            sep.cfg = cfg
        mix = load_audio(a.input, sr=sep.samplerate)
        if a.clip:
            mix = mix[:, : int(a.clip * sep.samplerate)]
        dur = mix.shape[1] / sep.samplerate

        t0 = time.time()
        stems = sep.separate(mix, sep.samplerate)
        t = time.time() - t0
        row = {"model": model, "shifts": shifts, "overlap": overlap, "device": sep.device,
               "seconds": round(t, 2), "x_realtime": round(dur / t, 2)}
        # stem을 다시 더했을 때 원곡과 얼마나 같은지 (dB, 높을수록 좋음 · 정답 stem 없이도 볼 수 있는 기본 체크)
        row["recon_sdr"] = round(sdr(mix, sum(stems.values())), 1)
        if a.ref:
            for name, est in stems.items():
                p = next((p for p in a.ref.glob(f"{name}.*")), None)
                if p is not None:
                    row[f"sdr_{name}"] = round(sdr(load_audio(p, sr=sep.samplerate)[:, : est.shape[1]], est), 2)
            s = [v for k, v in row.items() if k.startswith("sdr_")]
            if s:
                row["sdr_avg"] = round(float(np.mean(s)), 2)
        rows.append(row)
        print(json.dumps(row, ensure_ascii=False))

    keys = list(dict.fromkeys(k for r in rows for k in r))
    print("\n| " + " | ".join(keys) + " |\n|" + "---|" * len(keys))
    for r in rows:
        print("| " + " | ".join(str(r.get(k, "")) for k in keys) + " |")
    a.out.write_text(json.dumps(rows, indent=1, ensure_ascii=False))
    print(f"\n저장: {a.out}")


if __name__ == "__main__":
    main()
