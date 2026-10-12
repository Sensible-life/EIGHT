#!/usr/bin/env python3
"""로컬 실행: 음원 → Demucs stem + 분석 JSON

  python separate.py song.mp3
  python separate.py song.mp3 --model htdemucs_ft --shifts 2
  python separate.py ~/Music/*.mp3 --out results --format mp3
  python separate.py song.mp3 --no-analysis          # 분리만
  python separate.py song.mp3 --engine onnx          # PyTorch 없이 ONNX로 (export_onnx.py 먼저)
"""
import argparse
import os
import sys
from pathlib import Path

os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")  # MPS 미지원 op는 CPU로
sys.path.insert(0, str(Path(__file__).resolve().parent))

from choreo import run  # noqa: E402
from choreo.separation import SeparationConfig  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description="Demucs 로컬 분리 + 음악 분석")
    ap.add_argument("inputs", nargs="+", type=Path)
    ap.add_argument("--out", type=Path, default=Path("out"))
    ap.add_argument("--model", default="htdemucs", help="htdemucs | htdemucs_ft | htdemucs_6s | mdx_extra")
    ap.add_argument("--shifts", type=int, default=1)
    ap.add_argument("--overlap", type=float, default=0.25)
    ap.add_argument("--segment", type=float, default=None)
    ap.add_argument("--device", default="auto", help="auto | mps | cuda | cpu")
    ap.add_argument("--format", choices=["wav", "mp3"], default="wav")
    ap.add_argument("--no-analysis", action="store_true")
    ap.add_argument("--engine", choices=["torch", "onnx"], default="torch")
    ap.add_argument("--onnx-dir", type=Path, default=None, help="기본: models/<model>")
    a = ap.parse_args()

    cfg = SeparationConfig(model=a.model, shifts=a.shifts, overlap=a.overlap, segment=a.segment, device=a.device)
    if a.engine == "onnx":
        from choreo.onnx_separator import OnnxDemucsSeparator

        sep = OnnxDemucsSeparator(a.onnx_dir or Path("models") / a.model, overlap=a.overlap, shifts=a.shifts)
    else:
        from choreo.separation import make_separator

        sep = make_separator(cfg)  # 여러 곡이어도 모델은 한 번만 로드
    for src in a.inputs:
        out = a.out / src.stem
        print(f"▶ {src.name}")
        r = run(src, out, cfg, analyze_music=not a.no_analysis, fmt=a.format, separator=sep)
        print(f"  → {out}/  (총 {r['timing']['total']}s)\n")


if __name__ == "__main__":
    main()
