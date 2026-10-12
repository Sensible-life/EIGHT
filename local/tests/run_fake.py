"""가중치 없이 CLI를 돌려보는 테스트 러너: python tests/run_fake.py separate.py song.wav ...
랜덤 초기화 HTDemucs 로 get_model을 바꿔치기 한다(분리 품질은 무의미, 코드 경로 확인용)."""
import runpy, sys
from fractions import Fraction
from pathlib import Path
import torch, demucs.pretrained
from demucs.apply import BagOfModels
from demucs.htdemucs import HTDemucs
torch.manual_seed(0)
_bag = BagOfModels([HTDemucs(sources=["drums", "bass", "other", "vocals"], segment=Fraction(39, 5)).eval()])
demucs.pretrained.get_model = lambda name: _bag
script = sys.argv[1]; sys.argv = sys.argv[1:]
sys.path.insert(0, str(Path(script).resolve().parent))
runpy.run_path(script, run_name="__main__")
