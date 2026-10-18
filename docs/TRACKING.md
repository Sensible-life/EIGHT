# 카메라 트래킹 — 몸을 어디에 썼는지 비추기

세션 화면의 **[카메라] 탭**: 폰을 세워 두고 음악에 맞춰 춤추면, 폰이 혼자 카메라 → 자세 인식(MediaPipe) → 부위·높이 집계 → "안 가본 쪽" 제안까지 처리한다. 집계 창은 곡의 실제 8카운트를 따른다.

- 설계: `docs/superpowers/specs/2026-10-14-body-tracking-design.md` · 구현 계획: `docs/superpowers/plans/2026-10-14-body-tracking.md`
- 원래 프로토타입(Python): 태양의 `id403` 레포. 옮긴 뒤에는 이 레포의 TypeScript가 원본이고, id403은 정답 데이터를 만드는 기준으로만 쓴다.

## 원칙
1. AI는 안무나 "맞는" 동작을 만들지 않는다. 쓴 부위·높이라는 사실만 비추고 안 가본 쪽을 제안한다. 점수·순위·처방 없음.
2. 습관이 아니라 안 가본 쪽을 보여준다(`underused`, 화면에서는 "안 가본 쪽"). 빨간색·경고 표현 없음.
3. 영상 프레임은 MediaPipe에 넣은 뒤 버린다. 미리보기는 화면에만 보이고 저장·전송하지 않는다. 세션 기록에는 집계 숫자만 남는다.
4. 가려진 부위는 "안 쓴 것"이 아니다. 부위마다 관측된 프레임만 센다.

## 구조
| 경로 (app/) | 역할 |
|---|---|
| `modules/pose-camera/` | Kotlin Expo 모듈. CameraX 전면 카메라 미리보기 + MediaPipe Pose(lite, GPU→CPU) → `onPose` 이벤트(관절 좌표·시각만). 카메라·엔진이 시작하지 못하는 치명적 오류는 짧은 한국어 메시지와 함께 `onError`로 JS에 전달된다. 카메라는 뷰가 붙어 있고 활성일 때만 돈다. 외부 카메라는 `FrameSource` 구현을 하나 더 만들면 된다 |
| `src/tracking/` | React 없는 TypeScript 로직: 스무딩, 캘리브레이션, 부위 활동, 높이, 집계 창, 제안, 세션, 스토어. `scripts/load-ts.cjs`로 node에서 바로 테스트 |
| `src/components/tracking/` | 카메라 탭, 관절 선 오버레이, 부위 막대, 분석 탭 카드 |
| `src/tracking/config.ts` | 모든 임계값. id403 `config/default.yaml`과 공유하는 섹션은 키·값이 같아야 한다(정답 테스트가 검사). `app` 섹션은 이 앱 전용이며 `min_bpm: 30` / `max_bpm: 300`을 포함한다 |

## 명령 (app/에서)
```
npm run models          # MediaPipe lite 모델 받기 (git 제외, 첫 빌드 전에 한 번)
npm run test:tracking   # 트래킹 로직 테스트 + id403 정답 비교
npx expo prebuild --platform android --no-install
npm run build:android   # Windows·Mac 모두
npm run android -- --check
```
- Windows: `scripts/android.cjs`가 `java.exe`를 찾아 `.\gradlew.bat`을 실행한다. `npm run android -- --check`는 환경만 점검하고, `npm run build:android`는 APK만 빌드한다.
- 모델 파일이 없으면 Gradle이 안내 메시지와 함께 실패한다. 그때 `npm run models`를 실행한다.
- EAS 클라우드 빌드에는 git 제외된 모델이 없으므로 `eas-build-post-install` 훅(`npm run models`)이 빌드 중에 내려받는다.
- 중간에 끊긴 빌드 뒤에 CMake가 "deleting depfile: Permission denied"를 내면 `app\android`에서 `.\gradlew.bat --stop` 후 다시 빌드한다.
- Xiaomi/MIUI 폰은 개발자 옵션의 **"USB를 통한 설치"**를 켜기 전까지 `adb install`이 `INSTALL_FAILED_USER_RESTRICTED`로 실패한다.

### 테스트 작성과 정답 비교
- 트래킹 테스트는 `scripts/tracking/*.test.cjs`이고, `scripts/load-ts.cjs`가 TS 모듈을 매번 새 vm realm에서 실행한다. realm이 다르면 strict `deepEqual`이 프로토타입을 비교해 실패하므로, 테스트는 `node:assert/strict` 대신 `scripts/tracking/assert.cjs`(realm에 안전한 deepEqual)를 쓴다.
- 정답 테스트(`golden.test.cjs`)는 모든 숫자를 상대 오차 1e-6으로 비교한다(설계 §5.1). 허용오차 표는 없다. `pyRound`는 Python `round()`처럼 정확한 십진 값으로 .5 동점을 정한다.
- 정답 데이터는 id403의 `golden-export` 브랜치(커밋 b51bb65), `tools/export_golden.py`에서 만든다.

정답 데이터 다시 만들기 (id403 로직을 바꾼 경우만):
```
cd <id403>
.venv\Scripts\python.exe tools\export_golden.py --out <EIGHT>\app\scripts\fixtures\tracking
```

## 화면과 동작
- 세션 화면 위 [믹서 | 카메라] 탭. 카메라는 카메라 탭이 보일 때만 켜진다. 믹서는 탭을 바꿔도 그대로 동작한다.
- [춤 시작]: 5초 카운트다운 → (처음이면) 가만히 3초 → 음악 자동 재생.
- [다시 맞추기]: `store.requestRecalibration()`을 호출한다. 트래커를 초기화하고, **다음** [춤 시작]에서 가만히 3초 측정을 다시 하게 한다. [춤 시작] 흐름 안에서는 `store.recalibrate()`가 쓰인다. 어느 쪽이든 세션 누적은 유지한다.
- 음악이 재생 중이고 트래킹 중일 때만 집계·제안한다. 제안은 글자로 8초 보인다(음성 없음).
- 8카운트 창: 서버 분석(`analysis.eights`) → 없으면 BPM 8박(`job.tempo`가 30~300일 때) → 없으면 4초 단위. `planFor`는 선택 인자로 `bpm`(`min_bpm`·`max_bpm`)을 받으며, 범위를 벗어난 템포는 4초 고정 격자로 처리한다. 반복 구간 되감기·뒤로 탐색·곡 처음으로 돌아가기에서 새 창이 시작된다.
- 화면의 "3 / 8" 박 번호는 현재 8카운트를 8등분한 위치다(`analysis.beats`를 쓰지 않는다). 실기기에서 어긋나 보이면 beats 기준으로 바꾼다.
- 세션 기록: `Session.tracking = { version: 1, trackedMs, totals }`(5초마다 저장). 이어하기 하면 누적이 이어진다. 분석 탭의 "카메라로 본 몸 사용" 카드는 30초 이상 트래킹한 세션을 합친다.

## 메시지 형식 (하드웨어·프로젝터로 보낼 때 그대로)
`src/tracking/types.ts`가 원본이고, 필드는 id403 `docs/message-schema.md`와 같다.

| 종류 | 빈도 | 필드 |
|---|---|---|
| `UsageMessage` (type 없음) | 10 Hz × 창 3개 | `t`, `window` (`8count` · `recent` · `session`), `segments` {head, torso, arm_l, arm_r, leg_l, leg_r}, `level` {low, mid, high}, `current_level`, `underused`, `tracking_ok` |
| `status` | 10 Hz | `t`, `state` (waiting · calibrating · tracking), `progress`, `session_s` |
| `feedback` | 드물게 | `t`, `kind` (segment_unexplored · level_unexplored · explored), `target`, `text` |
| `pose` | 사람이 잡힌 프레임마다 | `t`, `aspect`, `lm` (33 × [x, y, visibility], 거울 반전 안 함) |
| `perf` | 1 Hz | `t`, `source_fps`, `pose_fps`, `detect_rate`, `lat_ms` {capture_pose, pipeline} {p50, p95}, `capture_from`, `model`, `delegate`, `errors` |

- `window: "8count"`은 이 앱에서 "곡의 현재 8카운트"다(id403에서는 최근 4초).
- 왼쪽·오른쪽 = 춤추는 사람 본인의 왼쪽·오른쪽.

## 실기기 체크리스트 (갤럭시)
아직 실기기에서 돌려 보지 않았다. 폰으로 확인한 뒤 결과 칸을 채운다.

| 항목 | 결과 | 날짜·기종 | 메모 |
|---|---|---|---|
| 카메라 권한 허용 / 거부 / 설정에서 다시 허용 | 미확인 | | |
| 미리보기와 관절 선이 겹침 (손 들기·기울기로 좌우 확인) | 미확인 | | |
| [춤 시작]: 카운트다운 → 가만히 3초 → 자동 재생 | 미확인 | | |
| 사람이 안 잡히면 "카메라 앞에 서 주세요"로 기다림 | 미확인 | | |
| 카운트다운 중 dock으로 재생 → 자동 재생을 또 하지 않음 | 미확인 | | |
| 탭 전환 시 카메라 꺼짐·켜짐, 백그라운드 갔다 오기 | 미확인 | | |
| 반복 구간·탐색 시 8카운트 창이 새로 시작 | 미확인 | | |
| 일시정지 → "일시정지 · 집계 멈춤", 다시 재생하면 이어짐 | 미확인 | | |
| 저장하고 나가기 → 이어하기 → 누적 이어짐 | 미확인 | | |
| 세션 마치기 → 분석 탭 카드 | 미확인 | | |

## 측정 (lite)
| 기종 | delegate | pose_fps | capture_pose p50 / p95 (ms) | detect_rate | id403 A1 (같은 기종) |
|---|---|---|---|---|---|
| | | | | | |
