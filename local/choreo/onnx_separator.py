"""PyTorch 없이 (numpy + onnxruntime) Demucs 분리.

앱에 내장할 때 옮겨야 하는 '호스트 코드'의 기준 구현이다.
  1. 전체 곡 정규화 (mean/std)
  2. 7.8초 청크로 자르기 (overlap 25%, 삼각형 가중치로 이어 붙이기)
  3. 청크마다: STFT → core.onnx → iSTFT + 시간 branch 합산
  4. bag(여러 모델)이면 stem별 가중 평균
Swift(Accelerate vDSP) / Kotlin / C++ 로 이 파일을 그대로 옮기면 된다.
"""
from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Dict, List, Optional, Sequence

import numpy as np

# ---------------------------------------------------------------- STFT (torch.stft 과 동일한 규약)


def _hann(n: int) -> np.ndarray:
    # torch.hann_window 기본값(periodic=True)
    return (0.5 - 0.5 * np.cos(2 * np.pi * np.arange(n) / n)).astype(np.float32)


def stft(x: np.ndarray, nfft: int, hop: int) -> np.ndarray:
    """torch.stft(center=True, pad_mode='reflect', normalized=True, onesided) 와 동일. x (..., L) → (..., F, T) complex"""
    win = _hann(nfft)
    xp = np.pad(x, [(0, 0)] * (x.ndim - 1) + [(nfft // 2, nfft // 2)], mode="reflect")
    frames = np.lib.stride_tricks.sliding_window_view(xp, nfft, axis=-1)[..., ::hop, :]  # (..., T, nfft)
    z = np.fft.rfft(frames * win, axis=-1) / np.sqrt(nfft)
    return np.swapaxes(z, -1, -2).astype(np.complex64)


def istft(z: np.ndarray, hop: int, length: int) -> np.ndarray:
    """torch.istft(center=True, normalized=True, length=length) 와 동일. z (..., F, T) → (..., length)"""
    nfft = 2 * z.shape[-2] - 2
    win = _hann(nfft)
    T = z.shape[-1]
    frames = np.fft.irfft(np.swapaxes(z, -1, -2) * np.sqrt(nfft), n=nfft, axis=-1).astype(np.float32) * win  # (..., T, nfft)
    total = nfft + hop * (T - 1)
    lead = z.shape[:-2]
    y = np.zeros(lead + (total,), np.float32)
    env = np.zeros(total, np.float32)
    w2 = win * win
    for t in range(T):  # overlap-add
        s = t * hop
        y[..., s : s + nfft] += frames[..., t, :]
        env[s : s + nfft] += w2
    y = y / np.where(env > 1e-11, env, 1.0)
    y = y[..., nfft // 2 :]
    if y.shape[-1] < length:
        y = np.pad(y, [(0, 0)] * (y.ndim - 1) + [(0, length - y.shape[-1])])
    return y[..., :length]


# ---------------------------------------------------------------- HTDemucs 전/후처리


def host_spec(mix: np.ndarray, nfft: int, hop: int) -> np.ndarray:
    """HTDemucs._spec + _magnitude(cac). mix (B, C, L) → (B, C*2, nfft/2, ceil(L/hop))"""
    L = mix.shape[-1]
    le = int(math.ceil(L / hop))
    pad = hop // 2 * 3
    x = np.pad(mix, [(0, 0), (0, 0), (pad, pad + le * hop - L)], mode="reflect")
    z = stft(x, nfft, hop)[..., :-1, :]
    z = z[..., 2 : 2 + le]
    B, C, Fq, T = z.shape
    m = np.stack([z.real, z.imag], axis=2)  # (B, C, 2, F, T)
    return m.reshape(B, C * 2, Fq, T).astype(np.float32)


def host_ispec(spec_out: np.ndarray, hop: int, length: int) -> np.ndarray:
    """HTDemucs._mask(cac) + _ispec. (B, S, C*2, F, T) → (B, S, C, length)"""
    B, S, C2, Fq, T = spec_out.shape
    m = spec_out.reshape(B, S, C2 // 2, 2, Fq, T)
    z = m[:, :, :, 0] + 1j * m[:, :, :, 1]
    z = np.pad(z, [(0, 0)] * 3 + [(0, 1), (2, 2)])
    pad = hop // 2 * 3
    le = hop * int(math.ceil(length / hop)) + 2 * pad
    x = istft(z, hop, le)
    return x[..., pad : pad + length]


# ---------------------------------------------------------------- 실행


class OnnxCore:
    def __init__(self, path: str, providers: Optional[Sequence[str]] = None):
        import onnxruntime as ort

        so = ort.SessionOptions()
        so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        avail = ort.get_available_providers()
        providers = [p for p in (providers or ["CoreMLExecutionProvider", "CPUExecutionProvider"]) if p in avail]
        self.sess = ort.InferenceSession(path, so, providers=providers)
        self.providers = self.sess.get_providers()

    def __call__(self, mix: np.ndarray, mag: np.ndarray):
        spec_out, wave_out = self.sess.run(None, {"mix": mix.astype(np.float32), "mag": mag.astype(np.float32)})
        return spec_out, wave_out


class OnnxDemucsSeparator:
    """choreo.separation.Separator 와 같은 인터페이스."""

    def __init__(self, model_dir: str | Path, overlap: float = 0.25, shifts: int = 0,
                 providers: Optional[Sequence[str]] = None):
        d = Path(model_dir)
        self.man = json.loads((d / "manifest.json").read_text())
        self.cores = [OnnxCore(str(d / f), providers) for f in self.man["files"]]
        self.sources: List[str] = self.man["sources"]
        self.samplerate: int = self.man["samplerate"]
        self.overlap = overlap
        self.shifts = shifts
        self.device = "onnx:" + ",".join(self.cores[0].providers)

    def _run_core(self, core: OnnxCore, chunk: np.ndarray) -> np.ndarray:
        nfft, hop = self.man["nfft"], self.man["hop"]
        mag = host_spec(chunk[None], nfft, hop)
        spec_out, wave_out = core(chunk[None], mag)
        return (host_ispec(spec_out, hop, chunk.shape[-1]) + wave_out)[0]  # (S, C, L)

    def _split(self, core: OnnxCore, mix: np.ndarray, tick) -> np.ndarray:
        """demucs apply_model(split=True)와 동일한 청크 분할 + 삼각형 가중 overlap-add."""
        C, L = mix.shape
        seg = self.man["segment_samples"]
        stride = int((1 - self.overlap) * seg)
        weight = np.concatenate([np.arange(1, seg // 2 + 1), np.arange(seg - seg // 2, 0, -1)]).astype(np.float32)
        weight /= weight.max()
        out = np.zeros((len(self.sources), C, L), np.float32)
        wsum = np.zeros(L, np.float32)
        for off in range(0, L, stride):
            n = min(seg, L - off)
            # demucs TensorChunk.padded: 청크를 가운데 두고 앞뒤를 실제 오디오로 채움 (범위 밖은 0)
            delta = seg - n
            start = off - delta // 2
            a, b = max(0, start), min(L, start + seg)
            chunk = np.pad(mix[:, a:b], [(0, 0), (a - start, start + seg - b)])
            y = self._run_core(core, chunk)[..., delta // 2 : delta // 2 + n]
            out[..., off : off + n] += weight[:n] * y
            wsum[off : off + n] += weight[:n]
            tick()
        return out / wsum

    def separate(self, audio: np.ndarray, sr: int, progress=None, shifts: Optional[int] = None, seed: Optional[int] = None) -> Dict[str, np.ndarray]:
        """shifts=0: 결정적(앱 기본값 권장). shifts=N: demucs처럼 랜덤 시간 이동 N번 평균 (품질↑, 시간×N)."""
        if sr != self.samplerate:
            raise ValueError(f"expected {self.samplerate} Hz")
        shifts = self.shifts if shifts is None else shifts
        if audio.shape[0] == 1:
            audio = np.repeat(audio, 2, axis=0)
        audio = audio.astype(np.float32)
        ref = audio.mean(0)
        mean, std = ref.mean(), ref.std() + 1e-8
        mix = (audio - mean) / std
        C, L = mix.shape

        seg = self.man["segment_samples"]
        n_chunks = len(range(0, L + (sr // 2 if shifts else 0), int((1 - self.overlap) * seg)))
        steps = max(1, n_chunks * max(1, shifts) * len(self.cores))
        state = {"done": 0}

        def tick():
            state["done"] += 1
            if progress:
                progress(min(1.0, state["done"] / steps))

        rng = np.random.default_rng(seed)
        W = np.array(self.man["weights"], np.float32)  # (n_models, S)
        total = np.zeros((len(self.sources), C, L), np.float32)
        for mi, core in enumerate(self.cores):
            if shifts:
                max_shift = sr // 2
                padded = np.pad(mix, [(0, 0), (max_shift, max_shift)])
                acc = np.zeros_like(total)
                for _ in range(shifts):
                    o = int(rng.integers(0, max_shift + 1))
                    res = self._split(core, padded[:, o : L + max_shift], tick)
                    acc += res[..., max_shift - o : max_shift - o + L]
                y = acc / shifts
            else:
                y = self._split(core, mix, tick)
            total += y * W[mi][:, None, None]
        total /= W.sum(0)[:, None, None]
        total = total * std + mean
        if progress:
            progress(1.0)
        return {name: total[i] for i, name in enumerate(self.sources)}
