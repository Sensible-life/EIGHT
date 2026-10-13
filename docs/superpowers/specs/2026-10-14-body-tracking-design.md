# 몸 사용 트래킹 — EIGHT 앱 이식 설계

- 작성일: 2026-10-14 · 담당: 태양 (+ Claude)
- 상태: 리뷰 대기
- 브랜치: `body-tracking` (main 직접 push 금지, 단계별 PR)
- 기준 구현: 태양의 트래킹 프로토타입 레포 `id403` (이 레포 옆 폴더 `../id403`, 기준 커밋 `f49ddc3`, 브랜치 `android-app`)
  - 로직: `src/body_usage/` · 설정: `config/default.yaml` · 메시지 형식: `docs/message-schema.md`
  - 폰 카메라·MediaPipe: `android/app/src/main/java/com/id403/lighttrace/{camera,pose}/`
  - 시각 언어: `docs/superpowers/specs/2026-10-05-visual-design.md` (이번엔 색·스타일은 이 앱 테마를 따름)

---

## 0. 목표와 범위

**목표**: 성원의 연습 세션(레이어 믹서) 화면에 **카메라 탭**을 붙인다. 폰을 세워 두고 음악에 맞춰 춤추면, 폰이 카메라 → 자세 인식 → 부위·높이 집계 → "안 가본 쪽" 제안까지 혼자 처리하고, 집계 창을 **곡의 실제 8카운트**에 맞춘다. 세션이 끝나면 집계값이 세션 기록에 남고 분석 탭에서 볼 수 있다.

**정해진 조건**
- 이 레포(EIGHT)가 중심이다. 기능은 이 레포의 스택(Expo SDK 57 · React Native 0.86 · TypeScript)으로 **새로 짠다**. `id403`의 Python·Chaquopy·WebView 구조는 가져오지 않는다.
- **Android만** 대상. 처리는 전부 폰에서 한다. 외부 카메라(앰프)는 나중에 데이터를 폰으로 보내는 입력 소스 하나로 붙인다.
- 성원의 기존 화면·기능은 그대로 두고 **추가만** 한다. 색·스타일은 이 앱 테마(`src/theme.ts`)를 따른다.
- 부위 사용 시각화 본편은 나중에 하드웨어(프로젝터 등)로 갈 수 있다. 그래서 폰 탭은 "잘 잡히고 있나 + 지금 현황" 확인용이고, 집계 결과는 `id403/docs/message-schema.md` 형식 그대로 만든다.

**설계 원칙** (id403에서 그대로 가져옴, §6에서 문서로 옮김)
1. AI는 안무나 "맞는" 동작을 만들지 않는다. 쓴 부위·높이라는 사실만 비추고 **안 가본 쪽**을 제안한다. 점수·순위·처방 없음.
2. 습관이 아니라 안 가본 쪽을 보여준다. `underused`는 1급 출력이다.
3. 카메라 데이터: 영상 프레임은 MediaPipe에 넣은 뒤 버린다. **미리보기는 화면에만** 보여주고 저장·전송하지 않는다. 세션 기록에는 집계된 숫자만 남고 관절 좌표도 남기지 않는다.
4. 가려진 부위는 "안 쓴 것"이 아니다. 부위마다 관측 시간을 따로 센다.

**이번 범위**
1. `app/modules/pose-camera/` — Kotlin Expo 모듈: 전면 카메라 미리보기 + MediaPipe(lite) → 관절 좌표 이벤트
2. `app/src/tracking/` — TypeScript 순수 로직: 프레임 처리, 곡에 맞춘 집계 창, 글자 제안, 세션
3. 세션 화면의 **[믹서 | 카메라]** 탭과 [춤 시작] 흐름
4. 세션 기록 저장(`Session.tracking`), 백업 검사, 분석 탭 카드
5. 정답 데이터 비교 테스트, 모델 다운로드 스크립트, 문서, Windows 빌드 수정

**범위 밖** (다음 설계): 사후 분석(영상 → 좌표)과 움직임 스튜디오 연결, 외부 카메라(Wi-Fi) 입력, 하드웨어·프로젝터로 메시지 전송, 음성·워치 제안, 8카운트·구간별 기록 보기, full 모델 선택, iOS, 성원 기존 기능 수정(비트 일치 %, 영상 저장).

---

## 1. 구조

```
[pose-camera 모듈 · Kotlin]                        [TypeScript]
 FrontCameraSource ─┬─ Preview ─▶ PreviewView (화면에만)
  (CameraX, 4:3)    └─ ImageAnalysis ─▶ PoseEngine (MediaPipe LIVE_STREAM, GPU→CPU)
                                           │ onPose 이벤트 (관절 좌표 + 시각, 영상 없음)
                                           ▼
                         components/tracking/useLiveTracking ──▶ tracking/LiveSession
                           ▲ player.position · analysis.eights        │ UsageMessage · status ·
                           │ (StemPlayer, PlayerScreen)               │ feedback · pose · perf
                                                                      ▼
                                              CameraTab (미리보기 위 관절 선 + 인식 현황)
                                              Session.tracking (5초마다 checkpoint)
```

### 1.1 `app/modules/pose-camera/` (Kotlin, Expo 모듈)

성원의 `app/modules/watch-haptics/`와 같은 로컬 Expo 모듈 형태(`expo-module.config.json`의 `platforms: ["android"]`). id403의 Kotlin을 옮긴다.

| id403 | 이 모듈 | 바뀌는 점 |
|---|---|---|
| `camera/FrameSource.kt` | 그대로 | 외부 카메라는 나중에 구현 하나 추가 |
| `camera/FrontCameraSource.kt` | `Preview` use case 추가 | ImageAnalysis와 **같은 4:3 비율**로 함께 bind. `unbindAll()` 대신 자기 use case만 unbind |
| `pose/PoseEngine.kt` | 거의 그대로 | 결과를 Expo 이벤트로 보냄 |
| `runtime/PythonRuntime.kt`, `WebBridge.kt`, `WebUi.kt` 등 | 가져오지 않음 | — |

- **네이티브 뷰 `PoseCameraView`**
  - props: `active: boolean`(true일 때만 카메라·MediaPipe 동작), `model: "lite"`
  - 이벤트 `onPose`: 프레임마다 1개. 사람이 없어도 보낸다.
    ```ts
    { seq: number;            // 카메라가 낸 프레임 번호 (source fps 계산용)
      ageMs: number;          // 이벤트를 보내는 순간 기준, 카메라가 프레임을 받은 뒤 지난 ms
      emitWallMs: number;     // 보내는 순간의 System.currentTimeMillis()
      latencyMs: number;      // 프레임 → 자세 결과 (capture_pose)
      aspect: number;         // 프레임 가로/세로 (세로 폰이면 0.75)
      image: number[] | null; // 33 × [x, y, visibility], 이미지 좌표 0–1, y 아래로 증가, 거울 반전 안 함
      world: number[] | null; // 33 × [x, y, z], 미터, 골반 중심 원점
    }
    ```
  - 이벤트 `onEngine`: `{ model, delegate: "gpu" | "cpu" }` (GPU 실패로 CPU 전환 시 다시 보냄)
  - 이벤트 `onError`: `{ message }` (프레임 오류는 perf `errors`로 셈)
- **수명**: 뷰가 붙고 `active`가 true일 때 시작, false가 되거나 뷰가 빠지면 멈춘다. LifecycleOwner는 현재 Activity. 앱이 백그라운드로 가면 CameraX가 알아서 멈춘다.
- **권한**: 모듈은 권한을 요청하지 않는다. 카메라 탭이 이미 의존성에 있는 `expo-image-picker`의 `requestCameraPermissionsAsync()`로 요청한다(`android.permission.CAMERA`, `app.json`에 이미 선언됨).
- **미리보기와 관절 선 맞추기**: Preview와 ImageAnalysis를 같은 4:3으로 받고, 뷰를 세로 3:4 박스로 배치한다(`PreviewView` FILL_CENTER에서 잘림 없음). 전면 카메라 미리보기는 거울처럼 보이므로, 관절 선은 `x → 1 − x`로 뒤집어 그린다. 로직은 언제나 뒤집지 않은 좌표를 쓴다.
- **모델 파일**: `pose_landmarker_lite.task`를 `app/scripts/download-models.cjs`로 받아 모듈의 `android/src/main/assets/`에 둔다. git에는 올리지 않는다(`.gitignore` 추가). 파일이 없으면 Gradle 빌드가 받는 방법을 알려주며 실패한다.
- **의존성** (id403과 같은 버전에서 시작, 빌드 때 SDK 57과 맞춰 확인): `androidx.camera:camera-{core,camera2,lifecycle,view}:1.4.2`, `com.google.mediapipe:tasks-vision:1.0.0`.

### 1.2 `app/src/tracking/` (TypeScript, 순수 로직)

- **React·React Native·Expo를 import하지 않는다.** `scripts/load-ts.cjs`가 상대 경로 import만 허용하므로, 이 규칙을 지켜야 node로 바로 테스트된다.
- Python 동작을 그대로 옮긴다(계산 결과가 같아야 함). 코드 모양은 TypeScript식으로.

| id403 (`src/body_usage/`) | `app/src/tracking/` | 비고 |
|---|---|---|
| `types.py` | `types.ts` | `PoseFrame`, `FrameResult`, 메시지 타입 |
| `processing/segments.py` | `segments.ts` | 부위·관절 정의 |
| `processing/smoothing.py` | `smoothing.ts` | One Euro 필터 |
| `processing/features.py` | `features.ts` | 정규화, 관절 각도, `segmentActivity`, 다리 기하, `level` |
| `processing/calibration.py` | `calibration.ts` | |
| `processing/tracker.py` | `tracker.ts` | waiting → calibrating → tracking |
| `aggregate/usage.py` | `usage.ts` + `windows.ts` | 창 나누기를 갈아끼울 수 있게 (§3) |
| `feedback/engine.py`, `phrases.py` | `feedback.ts`, `phrases.ts` | 문장 그대로 |
| `pipeline.py` | `pipeline.ts` | |
| `session.py` | `session.ts` (`LiveSession`) | `recalibrate()` 추가 (§2) |
| `perf.py` | `perf.ts` | |
| `config/default.yaml` | `config.ts` | `(tune)` 표시 유지. 다른 곳에 임계값 하드코딩 금지 |
| numpy 연산 | `math.ts` | median, norm, 각도 등 작은 헬퍼 |
| `sources/`, `pose/`, `outputs/`, `main.py`, `mobile.py` | 가져오지 않음 | 카메라·모델은 Kotlin 모듈, 출력은 화면 |

- 옮긴 뒤에는 **TypeScript가 원본**이다. id403은 "프레임 처리가 같은 값을 내는지" 비교하는 기준으로만 남고 새 기능을 넣지 않는다.

### 1.3 메시지

`id403/docs/message-schema.md`의 `UsageMessage`·`status`·`feedback`·`pose`·`perf`를 **필드 그대로** 쓴다. 폰 안에서는 `LiveSession`이 콜백으로 객체를 넘기고, 하드웨어로 보낼 때(다음 설계) JSON으로 바꾸기만 한다. `window: "8count"`의 이름은 유지하고 의미만 "곡의 8카운트"로 정확해진다(§3). 형식 문서는 이 레포 `docs/TRACKING.md`로 옮긴다(§6).

---

## 2. 카메라 탭

```
 ‹ 저장하고 나가기                 MY SESSION
 [ 믹서 | 카메라 ]                              ← 새 탭 (성원 화면 위)
 ┌──────────────────────────────────┐
 │  카메라 미리보기 (3:4, 거울)        │
 │  관절 선 · 많이 쓴 부위일수록 진하게  │
 │  트래킹 중 · 24fps · 41ms           │  ← 작은 HUD
 └──────────────────────────────────┘
   이번 8카운트 | 세션 전체        3 / 8
   머리 ▮  몸통 ▮▮  왼팔 ▮▮▮▮▮  오른팔 ▮▮▮▮  왼다리 ▮  오른다리 ▮▮
   높이  낮음 10 · 중간 80 · 높음 10
   안 가본 쪽: 왼다리 · 낮은 높이
   "왼다리, 아직 조용해요. 한번 깨워볼까요?"
   [ 춤 시작 ]   [ 다시 맞추기 ]
 ── 재생 컨트롤 dock (성원 것 그대로, 두 탭 공통) ──
```

- **탭**: `PlayerScreen`의 위쪽 바 아래에 [믹서 | 카메라]. 믹서 탭 내용은 지금 스크롤 화면 그대로. dock(재생·탐색·반복)은 두 탭에서 공통. 음악은 탭과 상관없이 계속 재생.
- **카메라 켜짐**: 카메라 탭이 보일 때만 `active = true`. 믹서 탭·세션 나가기·앱 백그라운드에서 꺼진다(성원 화면은 백그라운드에서 음악도 멈춘다).
- **[춤 시작] 흐름** (폰에서 누르고 2.5–3m 뒤로 가는 경우)
  1. 5초 카운트다운 ("자리를 잡아 주세요") — 이 동안 들어온 프레임은 캘리브레이션에 쓰지 않는다.
  2. 아직 맞춘 적이 없으면 `recalibrate()` → 사람이 잡히면 3초 가만히(진행 표시를 크게). 사람이 안 잡히면 "카메라 앞에 서 주세요"로 기다린다.
  3. 캘리브레이션이 끝나면(이미 맞춘 상태면 1번 뒤 바로) `PlayerScreen`이 넘겨준 `onPlay()`로 음악을 재생한다.
  - [춤 시작]은 음악이 멈춰 있을 때만 누를 수 있다(재생 중에는 비활성). 카운트다운·캘리브레이션 중 탭을 바꾸거나 나가면 취소된다.
  - [춤 시작] 없이 dock에서 바로 재생해도 트래킹은 돈다. 맞춘 적이 없으면 id403처럼 사람이 처음 잡히는 순간부터 3초를 재고, 화면에 "가만히 3초"를 띄운다.
- **[다시 맞추기]**: `recalibrate()` — 트래커(스무딩·캘리브레이션)만 초기화하고 **세션 누적은 유지**한다. 다음 [춤 시작]에서 다시 3초를 잰다. (id403의 `reset()`은 누적까지 지우는 "새 세션"이고, 이 앱에서 세션은 성원의 세션 기록 단위다.)
- **집계 조건**: 트래커가 `tracking`이고 **음악이 재생 중**일 때만 집계·제안한다. 일시정지 중에는 미리보기·관절 선·상태만 갱신하고, 수치는 흐리게 + "일시정지 · 집계 멈춤".
- **제안**: `feedback` 문장을 글자 한 줄로 8초 보여주고 흐려진다(`config.ts`). 음성 없음.
- **인식 상태 표시**: `status.state`(waiting "카메라 앞에 서 주세요" / calibrating 진행률 / tracking), `tracking_ok`가 false면 "잘 안 보여요" + 수치 흐림.
- **HUD**: `perf`의 `pose_fps`, `lat_ms.capture_pose.p50`, `detect_rate`, delegate를 작은 글씨로(팀 테스트용).
- **권한 거부**: 안내 문구 + "설정 열기"(`Linking.openSettings()`).
- **색**: 테마의 `C.accent` 계열. 관절 선 진하기 = 세션 창 부위 비율. 안 가본 쪽은 점선 테두리 + "안 가본 쪽" 표시. **빨간색(`C.err`) 쓰지 않음**, 경고처럼 보이지 않게.

---

## 3. 음악에 맞추기

- **프레임의 곡 위치**: `onPose`가 JS에 도착한 순간
  `frameAgeMs = ageMs + (Date.now() − emitWallMs)`
  `musicT = player.position − frameAgeMs / 1000`
  오차는 수십 ms로, 8카운트(약 4초) 경계에는 영향이 거의 없다. 스피커 출력 지연은 보정하지 않는다(§7).
- **창 나누기 (`windows.ts`)** — 누적기(`usage.ts`)에 전략을 넣어 준다.

| 전략 | 쓰는 곳 | `8count` 창 |
|---|---|---|
| `musicEights(eights)` | 서버 분석(`analysis.eights`)이 있는 곡 | 지금 프레임이 속한 8카운트의 시작부터. 첫 8카운트 전은 "도입" |
| `tempoGrid(bpm)` | 분석 없음, `job.tempo` 있음 | 곡 0초부터 `8 × 60 / bpm`초씩 |
| `fixedGrid(4000)` | 분석·BPM 모두 없음 | 곡 0초부터 4초씩. 화면에 "박자 정보 없음 · 4초 단위" |
| `rolling(4000)` | **정답 비교 테스트 전용** | id403과 같은 "최근 4초" |

- **새 8카운트 창이 시작되는 때**: 창 키(8카운트 번호)가 바뀌거나, `musicT`가 직전보다 `0.2초`(`config.ts`) 넘게 뒤로 가면(반복 구간 되감기, 뒤로 탐색). 같은 8카운트를 반복하면 매번 새 창이다.
- **`recent` 창(30초)**: "집계한 시간" 시계 기준. 집계할 때만 흐르는 시계라서 일시정지 공백을 세지 않는다. 항상 재생 중이면 카메라 시계와 같다(정답 비교가 성립).
- **`session` 창**: 세션 기록 전체 누적(이어하기 포함, §4).
- **`tracking_ok`**: id403처럼 카메라 시계 최근 1초 기준. 일시정지 중에는 집계 샘플이 없으니 false → 수치 흐림(§2와 일치).
- **화면의 "3 / 8"**: 성원 코드와 같은 방식(`lastIndexAtOrBefore(analysis.beats, …)`)으로 박 번호를 보여준다. 대체 전략에서는 시간으로 계산한 박 번호.

---

## 4. 저장과 보여주기

- **타입** (`app/src/tracking/types.ts`, `state/model.ts`에서 참조)
  ```ts
  type UsageTotals = {
    frames: number;                          // 집계한 프레임 수
    score: Record<Segment, number>;          // 부위별 활동 합 (관측된 프레임만)
    observed: Record<Segment, number>;       // 부위별 관측 프레임 수
    levels: Record<'low' | 'mid' | 'high', number>; // 높이별 프레임 수
  };
  type SessionTracking = { version: 1; trackedMs: number; totals: UsageTotals };
  // state/model.ts
  type PlaybackSnapshot = { ...기존 필드; tracking?: SessionTracking };
  ```
  비율·`underused`는 저장하지 않고, 볼 때 `usage.ts`의 같은 함수(`snapshotFromTotals`)로 계산한다.
- **저장 경로**: 성원의 `checkpoint`(5초마다, 저장하고 나가기, 세션 마치기)가 `PlaybackSnapshot`을 세션에 펼쳐 넣으므로, `PlayerScreen`의 `latest.current`에 `tracking: session.exportTotals()`를 함께 넣으면 끝난다. 트래킹을 한 번도 안 쓴 세션은 `tracking`이 없다.
- **이어하기**: `initialSnapshot.tracking`이 있으면 `session.importTotals()`로 누적을 이어 붙인다. 캘리브레이션은 이어하지 않고 [춤 시작]에서 다시 잰다.
- **관절 좌표·영상은 저장하지 않는다.**
- **백업 검사** (`state/validation.ts`): 세션 검사에 `s.tracking === undefined || validTracking(s.tracking)` 추가. 키는 정해진 부위·높이만, 값은 0 이상 유한수, `observed[seg] ≤ frames`. 예전 데이터는 그대로 통과.
- **분석 탭 카드 "카메라로 본 몸 사용"** (`app/analysis.tsx`에 추가, 성원 카드는 그대로)
  - 성원의 기간 필터(최근 7일/전체)를 따른다. `trackedMs ≥ 30초`인 세션만.
  - 부위 비율 막대: 기간 내 세션의 `totals`를 더해 `snapshotFromTotals`로 계산.
  - 높이 비율.
  - 자주 안 가본 쪽: 세션별 `underused`에 들어간 부위, 낮은·높은 높이 비율이 `feedback.level_min_share` 미만이었던 세션 수를 "N개 세션 중 M번"으로. 점수·순위 표현 없음.
  - 기록이 없으면 "세션의 카메라 탭에서 춤추면 기록이 쌓여요."

---

## 5. 검증

### 5.1 정답 데이터 비교 (id403 → EIGHT)

- id403에 `tools/export_golden.py` 추가(id403 쪽 커밋). 합성 관절 시퀀스를 id403 파이프라인(`LiveSession`)에 넣고 결과를 JSON으로 쓴다.
  - 시나리오: `still`, `arms_only`, `legs_only`, `occluded_arm`(한쪽 팔 visibility 0), `floor_low`, `arms_up_jump`, `lost_and_found`(사람이 잠깐 사라짐), `demo`(`tools/fake_publisher.py --scenario demo`의 가상 댄서)
  - 파일 하나 = 시나리오 하나: `{ config, frames: [{ t_ms, image, world, aspect } | { t_ms, none }], expected: [{ t_ms, frame_result, messages: [...] }] }`
  - **실제 사람 녹화에서 나온 좌표는 넣지 않는다**(공개 레포).
- 출력 위치: `app/scripts/fixtures/tracking/*.json`. 다시 만들 땐 `python tools/export_golden.py --out ../EIGHT/app/scripts/fixtures/tracking`.
- 비교 테스트는 `rolling(4000)` 전략 + "항상 재생 중"으로 돌린다. 숫자는 허용 오차 `1e-6`(필요하면 `1e-4`까지, 이유를 테스트에 적음), 상태·`current_level`·`underused`·`tracking_ok`·제안 `kind`/`target`/`text`는 정확히 일치.

### 5.2 TypeScript 테스트

`app/scripts/test-tracking.cjs` (성원 방식: `load-ts.cjs` + `node:assert`), `package.json`에 `"test:tracking"`.
- 위 정답 비교 전체
- `musicEights`: 8카운트 경계, 도입 구간, 반복 되감기·뒤로 탐색 시 새 창, 앞으로 탐색
- `tempoGrid` / `fixedGrid` 대체
- 일시정지 중 집계 멈춤, `recent` 창이 공백을 세지 않음
- `recalibrate()`가 누적을 유지, `exportTotals` → `importTotals` 왕복
- `validTracking`: 정상·예전 데이터 통과, 잘못된 키·음수·`observed > frames` 거부 (`test:library`에도 한 줄)

### 5.3 기존 검사

`npm run lint`, `npm run typecheck`, 기존 `test:audio`·`test:haptics`·`test:upload`·`test:library`·`test:motion` 모두 통과.

### 5.4 실기기 체크리스트 (갤럭시, `docs/TRACKING.md`에 표로)

- 카메라 권한 허용·거부·설정에서 다시 허용
- 미리보기와 관절 선이 겹치는지(손 들기·한쪽으로 기울기로 좌우 반전·잘림 확인)
- [춤 시작]: 카운트다운 → 가만히 3초 → 자동 재생, 사람이 안 잡힐 때 기다림
- 탭 전환 시 카메라 꺼짐·켜짐, 백그라운드 갔다 오기
- 반복 구간·탐색 시 8카운트 창이 새로 시작
- 저장하고 나가기 → 이어하기 → 누적 이어짐, 세션 마치기 → 분석 카드
- fps·지연이 id403 A1 수치(lite, 같은 기종)와 비슷한지 — `docs/TRACKING.md`에 기록

---

## 6. 협업과 진행 순서

- **PR은 `body-tracking`에서 단계별로**, 성원이 하나씩 리뷰 후 main에 merge. main을 자주 merge해서 충돌을 작게 유지.
  1. **Windows 빌드 수정** — `scripts/android.cjs`(JDK 탐색이 `bin/java`만 봐서 Windows의 `java.exe`를 못 찾음, `gradlew.bat` 실행 방식 확인). 성원 파일이라 따로.
  2. **트래킹 로직** — `app/src/tracking/`, `app/scripts/test-tracking.cjs`, 정답 데이터, `package.json` 스크립트. 새 폴더만.
  3. **카메라 모듈과 카메라 탭** — `app/modules/pose-camera/`, `app/src/components/tracking/`(`CameraTab`, `SkeletonOverlay`, `BodyUsageBars`, `useLiveTracking`), `PlayerScreen.tsx` 탭, `react-native-svg`(`npx expo install`), 모델 다운로드 스크립트.
  4. **저장·분석 카드·문서** — `state/model.ts`, `state/validation.ts`, `app/analysis.tsx`, `docs/TRACKING.md`(원칙·메시지 형식·실기기 표), `docs/FEATURE_STATUS.md`·`README.md` 갱신.
- **고칠 성원 파일**(시작 전에 성원에게 목록 공유): `screens/PlayerScreen.tsx`, `state/model.ts`, `state/validation.ts`, `app/analysis.tsx`, `package.json`·`package-lock.json`, `scripts/android.cjs`, `.gitignore`, `docs/FEATURE_STATUS.md`, `README.md`. 그 밖의 성원 파일은 고치지 않는다.
- **새 파일 위치**: `app/modules/pose-camera/`, `app/src/tracking/`(React 없음), `app/src/components/tracking/`(화면·훅), `app/scripts/`(테스트·다운로드·정답 데이터).
- **새 세션 안내 파일**: EIGHT 루트 `CLAUDE.md`(→ `app/AGENTS.md`와 `docs/TRACKING.md`를 불러오고, main push 금지·원칙·명령을 적음)를 둘지 **성원 동의 후** 결정. 동의 전에는 이 문서가 안내 역할을 한다.
- **서명 키**: 워치 연동을 확인하려면 성원의 디버그 서명 키(`debug.keystore`)가 필요하다. 레포에 올리지 않고 따로 받는다. 없으면 워치 없이 시작하기로 확인한다.

---

## 7. 위험과 열린 문제

- **미리보기·관절 선 정렬**: 기기마다 지원 해상도가 달라 4:3이 안 나오면 잘림이 생긴다. 모듈이 실제 프레임 `aspect`를 보내고, 오버레이는 그 비율로 그린다. 실기기 체크리스트로 확인.
- **JS 스레드 부하**: 프레임당 33관절 계산은 작지만, 성원 화면의 100ms 타이머·믹서 UI와 같은 스레드다. 카메라 탭에서 fps가 id403 A1보다 크게 낮으면 화면 갱신을 10Hz로 묶는다(`aggregate.publish_hz`와 같은 값).
- **의존성 버전**: Expo SDK 57·RN 0.86 위에서 CameraX 1.4.2·MediaPipe 1.0.0이 그대로 빌드되는지는 PR 3 첫 빌드에서 확인. `expo-image-picker`·`expo-video`와 CameraX 충돌 여부도 같이 본다.
- **스피커 출력 지연**: 사람이 듣는 소리는 `player.position`보다 늦다(특히 블루투스 스피커). 8카운트 창에는 영향이 작아 이번엔 보정하지 않는다.
- **외부 카메라(다음 설계)**: 영상은 Wi-Fi로 받아야 한다. 블루투스는 실효 1–2 Mbps라 640×480·15fps 영상(대략 3–5 Mbps)을 못 싣고, 관절 좌표 정도만 가능하다.
