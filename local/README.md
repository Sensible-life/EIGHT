# local — 맥에서 바로 돌리는 Demucs 파이프라인 (서버·앱과 별개)

HTTP 서버 없이 터미널에서 바로 실행합니다. 음원을 넣으면 stem 파일과 `analysis.json`이 나와요.
분석 로직은 `server/`와 같습니다. 이 폴더는 따로 떼어 가도 혼자 동작해요.

```
local/
├─ separate.py        음원 → stem + 분석     (엔진: torch | onnx)
├─ bench.py           모델·설정별 속도/품질 비교 (정답 stem 있으면 SDR)
├─ export_onnx.py     Demucs → ONNX 변환 + 검증 (앱 내장 준비)
└─ choreo/
   ├─ separation.py   PyTorch Demucs (MPS/CUDA/CPU)
   ├─ onnx_separator.py  PyTorch 없이 numpy + onnxruntime 로 분리  ← 앱으로 옮길 기준 코드
   ├─ analysis.py     beat · 8 count · 구조 · accent · envelope
   └─ pipeline.py
```

## 설치 · 실행

```bash
cd local
./setup.sh                          # 한 번만 (venv + 패키지)
source .venv/bin/activate

python separate.py ~/Music/song.mp3                     # → out/song/{drums,bass,other,vocals}.wav + analysis.json
python separate.py ~/Music/song.mp3 --model htdemucs_ft # 고품질
python separate.py ~/Music/*.mp3 --format mp3           # 여러 곡 (모델은 한 번만 로드)
python separate.py song.mp3 --no-analysis               # 분리만
```

터미널에 단계별 소요 시간과 **실시간 대비 속도**(x배)가 출력되고, `out/<곡>/timing.json`에도 저장됩니다.

## 서버보다 빠른가?

**같은 맥에서 돌린다면 분리 속도 자체는 같습니다.** 시간은 대부분 Demucs 추론에서 걸리기 때문이에요. 서버 방식에서 더 드는 건 Wi‑Fi로 업로드하고 stem mp3를 받는 몇 초뿐입니다. 속도를 실제로 바꾸는 건 아래 요소들이에요.

| 요소 | 영향 |
|---|---|
| device | Apple Silicon **MPS**가 CPU보다 수 배 빠름 (자동 선택) |
| model | `htdemucs_ft`는 모델 4개라 약 4배 |
| shifts | N배 |
| 기기 | 맥 > 아이폰. 폰 안에서 돌리면 맥보다 느림 |

로컬 CLI의 장점은 속도보다 **반복 실험이 편하다는 것**입니다. 설정을 바꿔 여러 곡을 한꺼번에 돌리고 bench로 비교할 수 있어요.

## 설정 비교

```bash
python bench.py song.mp3 --clip 30                                   # htdemucs vs htdemucs_ft (앞 30초)
python bench.py song.mp3 --models htdemucs --shifts 0 1 3 --overlap 0.25 0.5
python bench.py mixture.wav --ref stems_dir/                         # 정답 stem 있으면 SDR(dB)
python bench.py song.mp3 --models htdemucs onnx:models/htdemucs      # torch vs onnx 속도
```

- `recon_sdr`: stem을 다시 더했을 때 원곡과 얼마나 같은지 (dB, 높을수록 좋음)
- `sdr_*`: 정답 stem 대비 품질 (Demucs 논문과 같은 방식으로 계산, 높을수록 좋음)

## 앱에 Demucs를 넣는 경로 (ONNX)

PyTorch 모델은 앱(iOS/Android)에서 그대로 돌릴 수 없어서 변환이 필요합니다. 그런데 HTDemucs는 내부에서 STFT(복소수 연산)를 쓰기 때문에 통째로는 변환이 잘 안 돼요. 그래서 두 부분으로 나눴습니다.

```
            ┌─────────── 호스트 코드 (앱에서 구현) ───────────┐
음원 → 정규화 → 7.8초 청크 → STFT ─▶ [core.onnx] ─▶ iSTFT + 시간branch → overlap-add → stem
            └─ choreo/onnx_separator.py 가 numpy로 된 기준 구현 ─┘
```

```bash
python export_onnx.py                  # models/htdemucs/core_0.onnx (float32, 100MB대) + manifest.json
python export_onnx.py --model htdemucs_ft   # 4개 모델 각각
python separate.py song.mp3 --engine onnx --shifts 0   # PyTorch 없이 분리
python tests/test_onnx.py              # PyTorch 결과와 같은지 전체 곡으로 검증
```

**검증 결과** (랜덤 가중치로 같은 구조를 만들어 테스트한 수치이고, 실제 가중치로는 맥에서 `tests/test_onnx.py`를 돌려 확인하면 됩니다):
- 청크 하나: PyTorch 원본 대비 최대 상대오차 4e‑5
- 청크 여러 개로 된 곡 전체: 최대 상대오차 1e‑4
- 곧, numpy로 짠 STFT·청크 처리가 Demucs와 사실상 똑같이 동작합니다.

### 앱 내장 다음 단계
1. `onnxruntime-react-native`로 `core_0.onnx`를 로드합니다 (Expo config plugin 필요).
2. `onnx_separator.py`의 STFT·iSTFT·청크 로직을 네이티브 모듈로 옮깁니다. Swift라면 Accelerate의 vDSP FFT, Android라면 C++를 씁니다. JS로도 가능하지만 느려요.
3. 모델 크기와 속도를 최적화합니다.
   - iOS: CoreML(Neural Engine, fp16)로 변환하는 게 가장 빠를 가능성이 높아요.
   - int8 양자화는 품질 저하가 있는지 bench로 먼저 확인해야 합니다.
   - fp16 ONNX 변환도 시도해 봤는데, CPU 런타임에서 매우 느려서 뺐습니다.
4. 메모리: 4분 곡 기준으로 청크 단위로 처리하면 모델 100MB대에 작업 메모리 수백 MB가 듭니다. 구형 폰에서는 부담될 수 있어요.

## 테스트 (가중치 없이 코드 경로 확인)

```bash
python tests/test_analysis.py                        # 합성 곡으로 분석 정확도
FAKE_WEIGHTS=1 python tests/test_onnx.py             # torch vs onnx 일치 확인 (랜덤 가중치)
python tests/run_fake.py separate.py song.wav        # CLI를 랜덤 가중치로 실행
```
