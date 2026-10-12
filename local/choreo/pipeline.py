"""음원 1곡 → stem 파일 + analysis.json. 서버 없이 맥에서 바로 실행."""
from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Callable, Dict, Optional

import numpy as np

from .analysis import analyze
from .audio_io import load_audio, write_mp3, write_wav
from .separation import SeparationConfig, make_separator, pick_device


def run(
    src: Path,
    out_dir: Path,
    cfg: SeparationConfig,
    analyze_music: bool = True,
    fmt: str = "wav",
    log: Callable[[str], None] = print,
    separator=None,
) -> dict:
    """반환값: {"stems": {name: path}, "analysis": path|None, "timing": {...}}"""
    out_dir.mkdir(parents=True, exist_ok=True)
    t_all = time.time()
    sep = separator or make_separator(cfg)

    t0 = time.time()
    mix = load_audio(src, sr=sep.samplerate)
    dur = mix.shape[1] / sep.samplerate
    t_load = time.time() - t0
    log(f"  음원 {dur:.1f}s 로드 ({t_load:.1f}s) · device={getattr(sep, 'device', '?')} · model={cfg.model} shifts={cfg.shifts}")

    t0 = time.time()
    last = {"p": -1}

    def prog(f: float):
        p = int(f * 20)
        if p != last["p"]:
            last["p"] = p
            print(f"\r  분리 [{'#' * p}{'.' * (20 - p)}] {f * 100:5.1f}%", end="", flush=True)

    stems: Dict[str, np.ndarray] = sep.separate(mix, sep.samplerate, progress=prog)
    print()
    t_sep = time.time() - t0
    log(f"  분리 완료 {t_sep:.1f}s (실시간 대비 x{dur / max(t_sep, 1e-6):.1f})")

    # 저장 (모든 stem에 같은 gain → 상대 음량 유지)
    gain = 1.0 / max(1.0, max(float(np.abs(a).max()) for a in stems.values()))
    paths = {}
    for name, a in stems.items():
        p = out_dir / f"{name}.{fmt}"
        (write_mp3 if fmt == "mp3" else write_wav)(a, sep.samplerate, p, gain)
        paths[name] = str(p)

    t_an = 0.0
    a_path = None
    if analyze_music:
        t0 = time.time()
        res = analyze(mix, stems, sep.samplerate, device=pick_device(cfg.device))
        t_an = time.time() - t0
        res["separation"] = {**cfg.to_dict(), "device": getattr(sep, "device", "?"), "seconds": round(t_sep, 1)}
        a_path = out_dir / "analysis.json"
        a_path.write_text(json.dumps(res, ensure_ascii=False))
        log(f"  분석 완료 {t_an:.1f}s · {res.get('tempo')} BPM · beat={res.get('beatMethod')} · "
            f"구조 {' '.join(s['label'] for s in res.get('sections', []))} · 8count {len(res.get('eights', []))}개")

    timing = {"duration": round(dur, 2), "load": round(t_load, 2), "separate": round(t_sep, 2),
              "analyze": round(t_an, 2), "total": round(time.time() - t_all, 2),
              "rtf": round(t_sep / dur, 3)}
    (out_dir / "timing.json").write_text(json.dumps({"config": cfg.to_dict(), **timing}, indent=1))
    return {"stems": paths, "analysis": str(a_path) if a_path else None, "timing": timing}
