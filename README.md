# ChoreoLayer — 음원 분석 파이프라인 + 레이어 믹서 앱

시스템 흐름도의 **"음악 Input / 음악 분석"**과 **"Audio(앰프형 하드웨어)의 레이어 볼륨 조절"**을 먼저 구현한 프로토타입입니다.

```
[폰 앱 (Expo RN)] ──업로드──▶ [분석 서버 (맥, FastAPI)]
       ▲                         ├─ LALAL.AI API 또는 Demucs로 레이어 분리
       │                         ├─ beat · downbeat · 8 count · phrase · 구조(A/B/…)
       └──stem mp3 + JSON────────├─ accent(정박/엇박) · stem별 음압 envelope
                                 └─ 악기 등장/퇴장 이벤트 (8 count 단위)
```

## 1. 서버 실행 (맥)

### LALAL.AI 사용

React Native 앱은 기존 FastAPI 서버에 업로드합니다. 서버가 LALAL.AI에 음원을 전송해 분리 결과를 받으며,
기존 beat·8 count·구조 분석과 stem MP3 인코딩은 계속 서버에서 수행합니다. API 키는 앱으로 전송하지 않습니다.

1. `server/.env.example`을 `server/.env`로 복사하고 `LALAL_API_KEY`에 API 라이선스 키를 입력하세요.
2. 이미 서버 가상환경이 있다면 `cd server && .venv/bin/pip install -r requirements.txt`로 의존성을 갱신하세요.
3. `server/`에서 `./run.sh`를 실행하세요 (`.env`를 자동으로 읽습니다).
4. 앱에서 서버 연결을 확인하고 **LALAL.AI**를 선택해 음원을 업로드하세요.

| 모드 | 레이어 | LALAL.AI 요청 | 처리 분량 |
|---|---|---|---|
| 다양한 악기 (기본) | 보컬 / 드럼 / 베이스 / 피아노 / 일렉 기타 / 어쿠스틱 기타 / 신디사이저 / 현악기 / 관악기 / 나머지 | 6종 multistem → 나머지에서 3종 순차 분리 | 곡 길이 × 9 |
| 리드·코러스 옵션 | 보컬을 리드·코러스로 나누어 최대 11개 레이어 | 보컬 분리 후 나머지 악기 분리 | 선택한 악기 수 × 곡 길이 |
| 보컬 + 반주 | vocals / instrumental | `/split/stem_separator/` | 곡 길이 × 1 |

앱에서 필요한 악기만 선택하면 처리 분량을 줄일 수 있습니다. 코러스는 API가 감지한 경우에만 추가됩니다.
공식 multistem은 보컬·드럼·베이스·피아노·일렉 기타·어쿠스틱 기타만 지원합니다.
신디사이저·현악기·관악기는 Phoenix 단일 분리를 나머지 오디오에 순차 적용합니다.
각 악기를 원곡에서 별도로 뽑아 겹쳐 재생하는 방식이 아니며, 단계가 늘어날수록 처리 시간과 분리 아티팩트가 증가할 수 있습니다.
마지막 잔여 오디오는 `other`로 남겨 원곡의 소리를 버리지 않습니다. `drum`은 믹서 이름인 `drums`로 변환합니다.
이전 클라이언트의 `four_stem` 모드는 서버에서 계속 지원합니다.
결과 파일은 같은 샘플레이트와 길이로 디코딩한 뒤 기존 플레이어에서 재생합니다. 곡이 잘린 결과는 오류로 처리합니다.
실제 지연·분리 품질·동기화는 API 키를 설정한 뒤 실제 곡으로 확인해야 합니다.
처리 분량이 부족하거나 키가 없으면 오류를 표시하며, 자동으로 다른 서비스에 다시 요청하지 않습니다.
LALAL.AI의 원격 파일은 서비스의 만료 정책에 따라 남아 있으며, 앱의 작업 삭제는 로컬 결과만 삭제합니다.

공식 명세: [LALAL.AI API v1](https://www.lalal.ai/api/v1/docs/).

키 없이 서버 연동 검증 (HTTP 응답만 모사하고 디코딩·분석·인코딩·앱 API는 실제 실행):

```bash
cd server
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m unittest tests.test_lalal -v
```

### Demucs 사용

```bash
brew install ffmpeg          # 없으면
cd server
./run.sh                     # 처음엔 venv 만들고 패키지 설치 (몇 분)
# ▶ 앱의 서버 주소에 입력:  http://192.168.x.x:8000
```

- Apple Silicon이면 Demucs가 자동으로 **MPS(GPU)**를 사용합니다.
- 첫 분석 때 Demucs, beat_this 가중치를 자동으로 내려받습니다 (한 번만).
- 결과는 `server/data/<job id>/`에 저장됩니다. 들어 있는 파일: stem mp3, `analysis.json`, `job.json`.

동작 확인만 하려면:

```bash
cd server && .venv/bin/python tests/test_analysis.py        # 합성 곡으로 분석 정확도 확인
.venv/bin/python tests/test_server_e2e.py                   # 업로드→분리→분석→mp3 전체 흐름
```

## 2. 앱 실행

`react-native-audio-api`는 네이티브 모듈이라 **Expo Go에서는 안 돌아가고, dev build가 필요**합니다.

```bash
cd app
npm install
npx expo run:ios --device     # 아이폰 연결 (Xcode 필요)
# 또는 npx expo run:android
```

앱 첫 화면에 서버 주소를 입력하고 **확인**을 누른 뒤, 분리 서비스를 선택하고 음원을 선택하면 분석이 시작됩니다. 폰과 맥은 같은 Wi‑Fi에 있어야 하고, iOS에서는 "로컬 네트워크 접근"을 허용해야 합니다.

### Galaxy Watch 연동

Wear OS 동반 앱과 Android 연결 모듈을 추가했습니다. 베이스/킥/둘 다를 선택해 진동 패턴을 전달하고, 재생·일시정지·탐색·반복에 맞춰 워치에서 예약합니다. 감지 범위와 ±300ms 싱크 보정을 제공합니다. 현재는 폰과 워치 앱을 열어 둔 상태로 사용하는 개발 버전입니다. 설치·빌드 절차는 [wear/README.md](wear/README.md)를 참고하세요.

### 앱 기능

### 레이어 믹서

앱의 **분리된 파일 열기**에서 같은 곡의 WAV/MP3 파일 2~11개를 함께 선택하면 서버나 API 키 없이 바로 믹싱할 수 있습니다.
기존 `separated/htdemucs/Get Lucky/` 또는 `separated/htdemucs/Loco/`의 네 WAV 파일로 사용할 수 있습니다.
서버에서 분리한 곡은 라이브러리에서 열면 레이어가 자동으로 로딩됩니다.

- 각 레이어 볼륨 0~150%, 개별 음소거와 솔로 (여러 레이어를 함께 솔로 가능)
- 전체 볼륨, 재생/일시정지, 재생 위치 슬라이더, ±10초 이동, 곡 반복
- 실제 오디오에서 추출한 파형과 재생 중 음압 표시
- 초기화로 모든 레이어를 100%, 전체 볼륨을 80%로 복구
- 분석 정보가 있는 곡은 **박자·구간 보기**에서 구간 탐색과 현재 8 count 반복 가능

직접 가져온 파일은 현재 세션에서 사용하며, 저장·믹스 파일 내보내기는 아직 지원하지 않습니다.
오디오 길이가 0.15초 이상 다른 파일은 거절합니다. 길이가 같아도 서로 다른 곡이거나 시작점이 어긋난 파일을 자동 정렬하지는 않습니다.

브라우저에서도 같은 React Native 화면과 실제 오디오 엔진을 사용할 수 있습니다:

```bash
cd app
npm run web             # 또는 npx expo start --web --localhost
npm run lint
npm run typecheck
npm run test:audio      # 동시 시작·볼륨·탐색·반복·음소거/솔로·리소스 해제 검증
```

폰에서는 아래의 개발 빌드가 필요합니다. 웹 검증은 iOS/Android 실기기 오디오 검증을 대신하지 않습니다.

| 기능 | 설명 |
|---|---|
| 레이어 믹서 | stem별 볼륨(0~150%), Mute, Solo, 현재 음압 미터 |
| 8 count 표시 | 큰 숫자와 1~8 점 표시. accent가 오면 주황색으로 강조 |
| 타임라인 | 구간 색 블록(에너지가 높을수록 진함)과 8 count 눈금. 탭하면 가장 가까운 8 count 시작으로 이동 |
| −8 / +8 | 8 count 단위로 이동 |
| ⟲ 8 | 현재 8 count 반복 (모든 stem을 샘플 단위로 맞춰 loop) |
| 카운트 보정 | 자동 분석의 "1"이 어긋났을 때 박 단위로 보정 |
| 다가오는 변화 | 다음 8 count 안에 "보컬 등장", "B 구간 시작" 등을 미리 표시 |

모든 stem은 같은 오디오 시각에 함께 `start()`됩니다(Web Audio API 방식). 그래서 볼륨을 바꾸거나 이동하거나 반복해도 레이어끼리 싱크가 어긋나지 않습니다.

## 3. Demucs 튜닝 — 우리가 만질 수 있는 것

`server/app/separation.py`의 `SeparationConfig`에서 바꿀 수 있고, 앱의 업로드 옵션으로도 일부 선택할 수 있습니다.

| 옵션 | 효과 | 비용 |
|---|---|---|
| `model="htdemucs_ft"` | stem별로 fine-tune된 모델 4개를 묶어 씀. 체감 품질이 가장 크게 오름 | 약 4배 느림 |
| `model="htdemucs_6s"` | guitar, piano를 추가로 분리 | piano 품질은 약함 |
| `shifts=2~5` | 입력을 시간 이동시켜 여러 번 추론한 뒤 평균 (TTA) | 시간 × N |
| `overlap=0.5` | 청크 경계의 아티팩트 감소 | 조금 느려짐 |
| `segment` | 청크 길이. 메모리가 부족하면 줄이기 | – |

더 큰 성능 향상은 아래 단계로 갈수록 기대할 수 있습니다.

1. **모델 교체**: 현재 분리 성능이 가장 좋은 계열은 **BS‑RoFormer / Mel‑RoFormer**입니다(보컬 SDR 기준 htdemucs보다 꽤 높음). `make_separator()`에 백엔드를 하나 추가하면 앱과 분석 코드는 그대로 쓸 수 있습니다. 예를 들어 `audio-separator` 패키지를 붙이면 됩니다.
2. **앙상블**: 보컬은 RoFormer, 드럼과 베이스는 htdemucs_ft처럼 stem마다 가장 잘하는 모델의 결과를 골라 씁니다.
3. **Fine-tuning**: 우리가 주로 쓰는 장르(K‑pop, 힙합 등)의 멀티트랙 데이터로 추가 학습합니다. Demucs 학습 코드는 공개되어 있지만 GPU와 데이터가 필요합니다.

## 4. 분석 결과 (`GET /jobs/{id}/analysis`)

```jsonc
{
  "tempo": 120.0, "beatsPerBar": 4, "beatMethod": "beat_this",   // beat_this 실패 시 "grid"
  "beats":   [{ "t": 0.32, "count": 1, "eight": 0, "isDownbeat": true }, ...],
  "eights":  [{ "index": 0, "start": 0.32, "end": 4.32 }, ...],
  "sections":[{ "label": "A", "start": 0.32, "end": 32.3, "eights": 8, "energy": 0.95, "activeStems": ["drums","bass","other"] }],
  "phrases": [{ "start": 0.32, "end": 16.3, "section": "A", "eights": 4 }],   // 4 × 8 count
  "accents": [{ "t": 2.32, "strength": 0.9, "count": 5, "offbeat": false }],
  "stemEvents": [{ "t": 32.3, "stem": "vocals", "type": "enter", "eight": 8 }],
  "envelope": { "rate": 10, "mix": [...], "stems": { "drums": [...], ... } }  // 0..1, 초당 10프레임
}
```

`envelope`, `stemEvents`, `sections.activeStems`는 흐름도의 **AI Intervention**에 입력으로 넣기 좋게 설계했습니다. 예를 들어 "이 구간은 드럼이 주도하고 곧 보컬이 등장함 → 보컬 phrase에 집중해 보기" 같은 제안을 만들 때 씁니다.

## 5. 알려진 한계

- **8 count의 "1" 위치**: downbeat가 맞아도 8 count가 어느 마디에서 시작하는지는 곡마다 애매할 수 있습니다. 서버는 구조 경계와 가장 잘 맞는 쪽을 고르고, 틀리면 앱의 "카운트 보정"으로 고칩니다.
- **박자 변화**: 곡 중간에 박자표가 바뀌는 곡은 고려하지 않았습니다 (4/4 가정).
- **grid fallback**: beat_this를 못 쓸 때 쓰는 대체 방식입니다. 템포가 고정된 스튜디오 음원에서는 정확하지만, 라이브 연주처럼 템포가 흔들리는 곡에는 맞지 않습니다.
- **메모리**: 폰에서 모든 레이어를 디코드합니다. 44.1kHz 스테레오 4분짜리 곡은 레이어 10개에 오디오 버퍼만 약 850MB를 씁니다. 긴 곡은 필요한 악기만 선택하는 편이 좋습니다.

## ChoreoLayer 새 앱 UI (2026-10-12)

홈 · 워크스페이스 · 중앙 새 세션 · 분석 · 미션 구조로 개편했습니다. 현재 기능, 부족한 기능, 필요한 후속 작업과 실행 방법은 [기능 현황 문서](docs/FEATURE_STATUS.md)를 참고하세요. 기존 APK는 이전 빌드이며 새 네이티브 의존성을 포함한 개발 빌드가 필요합니다.
