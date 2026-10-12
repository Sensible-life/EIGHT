"""ONNX 경로 검증: PyTorch Demucs 와 ONNX+numpy 호스트 코드가 같은 결과를 내는지.

FAKE_WEIGHTS=1 이면 같은 구조의 랜덤 초기화 HTDemucs 로 테스트(가중치 다운로드 불필요).
맥에서는 FAKE_WEIGHTS 없이 실행하면 진짜 htdemucs 로 확인한다.
"""
import os, sys, time, tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import numpy as np, torch

if os.environ.get("FAKE_WEIGHTS"):
    import demucs.pretrained
    from demucs.htdemucs import HTDemucs
    from demucs.apply import BagOfModels
    from fractions import Fraction
    torch.manual_seed(0)
    _m = HTDemucs(sources=["drums", "bass", "other", "vocals"], segment=Fraction(39, 5)).eval()
    _bag = BagOfModels([_m])
    demucs.pretrained.get_model = lambda name: _bag

from export_onnx import export
from choreo.separation import SeparationConfig, DemucsSeparator
from choreo.onnx_separator import OnnxDemucsSeparator
from tests.synth import make_song

d = Path(tempfile.mkdtemp()) / "htdemucs"
export("htdemucs", d, opset=17, verify=True)

mix, _, _ = make_song(bars_per_sec=3)  # ≈18초 → 청크 여러 개 + 마지막 짧은 청크
mix = (mix / np.abs(mix).max() * 0.8).astype(np.float32)
t = time.time(); ref = DemucsSeparator(SeparationConfig(model="htdemucs", shifts=0, device="cpu")).separate(mix, 44100); t_torch = time.time() - t
sep = OnnxDemucsSeparator(d)
t = time.time(); est = sep.separate(mix, 44100); t_onnx = time.time() - t
for k in ref:
    err = np.abs(ref[k] - est[k]).max() / (np.abs(ref[k]).max() + 1e-9)
    print(f"{k:7s} 전체 곡 최대 상대오차 {err:.2e}")
print(f"시간  torch {t_torch:.1f}s  vs  onnx({sep.device}) {t_onnx:.1f}s")
