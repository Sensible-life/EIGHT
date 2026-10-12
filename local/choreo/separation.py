"""Stem separation.

Separator 인터페이스로 감싸 두었기 때문에 Demucs 설정(모델/shifts/overlap/segment)을
바꾸거나, 나중에 다른 모델(BS-RoFormer 등)을 같은 자리에 끼워 넣을 수 있다.
"""
from __future__ import annotations

import threading
from dataclasses import dataclass, asdict
from typing import Callable, Dict, Optional, Protocol

import numpy as np
import torch

ProgressFn = Callable[[float], None]


@dataclass
class SeparationConfig:
    # htdemucs     : 기본 4-stem (vocals/drums/bass/other). 빠름.
    # htdemucs_ft  : stem별로 fine-tune된 4개 모델 묶음. 품질↑, 속도 약 4배 느림.
    # htdemucs_6s  : 6-stem (+guitar, piano). piano 품질은 약함.
    model: str = "htdemucs"
    # shifts: 입력을 랜덤하게 시간 이동시켜 여러 번 추론 후 평균 (test-time augmentation).
    #         0 → 이동 없음(결정적, 같은 입력이면 항상 같은 결과), 1 → demucs CLI 기본(랜덤 1회),
    #         2~5 → SDR 약간↑, 시간은 배수로 증가.
    shifts: int = 1
    # overlap: 청크 사이 겹침 비율. 0.25 기본, 0.5 정도로 올리면 경계 아티팩트 감소.
    overlap: float = 0.25
    # segment: 청크 길이(초). None이면 모델 기본값. 메모리 부족하면 줄이기.
    segment: Optional[float] = None
    device: str = "auto"  # auto | mps | cuda | cpu

    def to_dict(self) -> dict:
        return asdict(self)


def pick_device(pref: str = "auto") -> str:
    if pref != "auto":
        return pref
    if torch.cuda.is_available():
        return "cuda"
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


class Separator(Protocol):
    sources: list
    samplerate: int

    def separate(self, audio: np.ndarray, sr: int, progress: Optional[ProgressFn] = None) -> Dict[str, np.ndarray]:
        """audio: (channels, samples) float32 → {stem_name: (channels, samples)}"""
        ...


class DemucsSeparator:
    _cache: Dict[str, object] = {}
    _lock = threading.Lock()

    def __init__(self, cfg: SeparationConfig):
        self.cfg = cfg
        self.device = pick_device(cfg.device)
        self.model = self._load(cfg.model)
        self.sources = list(self.model.sources)
        self.samplerate = int(self.model.samplerate)

    @classmethod
    def _load(cls, name: str):
        with cls._lock:
            if name not in cls._cache:
                from demucs.pretrained import get_model

                m = get_model(name)
                m.eval()
                cls._cache[name] = m
            return cls._cache[name]

    def separate(self, audio, sr, progress=None):
        from demucs.apply import apply_model

        if sr != self.samplerate:
            raise ValueError(f"expected {self.samplerate} Hz, got {sr}")
        if audio.shape[0] == 1:  # mono → stereo
            audio = np.repeat(audio, 2, axis=0)

        wav = torch.from_numpy(np.ascontiguousarray(audio, dtype=np.float32))
        # Demucs CLI와 동일한 정규화
        ref = wav.mean(0)
        mean, std = ref.mean(), ref.std() + 1e-8
        wav = (wav - mean) / std

        n = wav.shape[-1]
        seg_sec = self.cfg.segment or float(getattr(self.model, "segment", 7.8))
        seg_len = int(seg_sec * self.samplerate)
        state = {"done": 0.0}

        def cb(d: dict):
            if progress is None or d.get("state") != "end":
                return
            models = max(1, d.get("models", 1))
            shifts = max(1, self.cfg.shifts)  # shifts=0이어도 1회 실행
            seg = min(1.0, (d.get("segment_offset", 0) + seg_len) / max(1, n))
            frac = (d.get("model_idx_in_bag", 0) + (d.get("shift_idx", 0) + seg) / shifts) / models
            if frac > state["done"]:
                state["done"] = frac
                progress(min(frac, 0.99))

        with torch.no_grad():
            out = apply_model(
                self.model,
                wav[None],
                shifts=self.cfg.shifts,
                split=True,
                overlap=self.cfg.overlap,
                segment=self.cfg.segment,
                device=self.device,
                progress=False,
                callback=cb,
            )[0]
        out = out * std + mean
        if progress:
            progress(1.0)
        return {name: out[i].cpu().numpy() for i, name in enumerate(self.sources)}


def make_separator(cfg: SeparationConfig) -> Separator:
    # 다른 백엔드를 추가할 때는 여기서 분기 (예: cfg.model.startswith("roformer:"))
    return DemucsSeparator(cfg)
