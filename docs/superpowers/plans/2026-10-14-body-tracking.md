# 몸 사용 트래킹 EIGHT 이식 — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 성원의 연습 세션 화면에 카메라 탭을 붙여, 폰 전면 카메라 → MediaPipe → TypeScript로 옮긴 id403 트래킹 로직 → 곡의 8카운트에 맞춘 부위·높이 집계와 "안 가본 쪽" 제안을 보여주고, 세션 기록과 분석 탭에 남긴다.

**Architecture:** Kotlin Expo 모듈(`app/modules/pose-camera`)은 카메라 미리보기와 MediaPipe만 맡고 관절 좌표를 이벤트로 넘긴다. 판정·집계·제안은 React 없는 TypeScript(`app/src/tracking/`)에 있고, `LiveTrackingStore`가 모듈 이벤트와 StemPlayer 재생 위치를 묶어 카메라 탭(`app/src/components/tracking/`)에 넘긴다. 옮긴 로직은 id403 Python 파이프라인이 만든 정답 데이터로 검증한다.

**Tech Stack:** Expo SDK 57 · React Native 0.86 · TypeScript 6 · expo-modules-core(Kotlin) · CameraX 1.4.2 · MediaPipe tasks-vision 1.0.0 · react-native-svg · node:assert 테스트(`scripts/load-ts.cjs`) · 정답 데이터는 id403 Python 3.13 + numpy

**Spec:** `docs/superpowers/specs/2026-10-14-body-tracking-design.md` (이 레포). 기준 구현: `C:\Users\hotsu\id403` 커밋 `f49ddc3` (브랜치 `android-app`).

## Global Constraints

- **main에 push 금지.** 작업은 `body-tracking` 브랜치의 로컬 커밋만. push·PR은 태양이 승인할 때만. 클론 `C:\Users\hotsu\EIGHT`의 `.git/hooks/pre-push`가 main push를 막는다. `--no-verify` 금지.
- **Android만.** iOS 코드 없음. 웹(`npm run web`)에서는 카메라 탭이 안내 문구만 보이고 믹서는 그대로 동작해야 한다.
- `app/src/tracking/`의 파일은 React·React Native·Expo·`console`·`performance`를 쓰지 않는다. `scripts/load-ts.cjs`가 상대 경로 import만 허용하고, vm 샌드박스에 `Date`만 넣어 주기 때문이다. 타입은 `import type`으로 가져오고, 상대 import는 확장자 없이 같은 폴더의 `.ts` 파일을 가리킨다(`./types`, index 파일 금지).
- 임계값·시간 상수는 `app/src/tracking/config.ts`의 `DEFAULT_CONFIG`에만 둔다. id403 `config/default.yaml`과 공유하는 섹션(`pose`, `smoothing`, `calibration`, `features`, `aggregate`, `perf`, `feedback`)은 yaml과 **키·값이 똑같다**(snake_case). 정답 테스트가 이걸 검사한다. 앱 전용 값은 `app` 섹션에 둔다.
- 메시지 필드는 id403 `docs/message-schema.md` 그대로(snake_case): `UsageMessage`(type 없음), `status`, `feedback`, `pose`, `perf`.
- 제안 문장은 id403 `src/body_usage/feedback/phrases.py` 문장 그대로.
- 원칙: 점수·순위·처방 문구 금지, `underused`는 "안 가본 쪽"(점선)으로 표시, 빨간색(`C.err`) 금지, 영상 프레임 저장·전송 금지, 세션 기록에는 `SessionTracking`(집계 숫자)만 남긴다.
- `pose-camera` 이벤트는 Expo의 `Map<String, Any>`이라 null을 못 싣는다. 사람이 없으면 `image`·`world`는 **빈 배열**이다(스펙 §1.1의 null 대신).
- 성원 파일은 이 목록만 고친다: `src/screens/PlayerScreen.tsx`, `src/state/model.ts`, `src/state/validation.ts`, `src/app/analysis.tsx`, `package.json`, `package-lock.json`, `scripts/android.cjs`, `scripts/test-library.cjs`(테스트 추가만), `app/.gitignore`, `docs/FEATURE_STATUS.md`, `README.md`.
- 새 의존성은 `npx expo install <pkg>`로만 추가한다(AGENTS.md). 이번엔 `react-native-svg` 하나.
- 커밋 전: `npm run lint`, `npm run typecheck`, `npm run test:tracking`(Task 3부터), 건드린 영역의 기존 `test:*`.
- 커밋 메시지는 영어 명령형이고, 끝에 빈 줄과 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`를 단다.
- 명령은 PowerShell 기준이다. 따로 적지 않으면 작업 폴더는 `C:\Users\hotsu\EIGHT\app`이다. `node_modules`는 이미 설치돼 있다(`npm ci`). 없으면 `npm ci`.
- Android 빌드 환경: `$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"`(시스템 Java는 1.8), SDK는 `C:\Users\hotsu\AppData\Local\Android\Sdk`.

## Review Focus

스펙이 직접 말하지 않지만 실제 사용에서 먼저 깨질 만한 입력 다섯 가지와, 각각을 고정하는 테스트가 들어간 Task:

1. **곡이 끝나 처음으로 돌아가거나 반복 구간을 되감을 때** → 8카운트 창이 새로 시작하고 세션 누적은 이어져야 한다. → Task 6 "song end wraps to 0", "loop back".
2. **일시정지 중에도 계속 들어오는 프레임** → 집계·제안이 멈추고, 다시 재생하면 `recent` 창이 공백 없이 이어져야 한다. → Task 8 "paused" 테스트 두 개.
3. **사람이 화면에서 잠깐 나갔다 들어올 때(빈 포즈 이벤트)** → 관절 선이 지워지고 `tracking_ok`는 false. 다시 들어오면 재캘리브레이션 없이 이어진다. → 정답 `lost_and_found`(Task 9), Task 11 "pose cleared".
4. **예전 세션·백업(`tracking` 없음)과 망가진 `tracking` 값** → 예전 것은 통과하고 망가진 것은 거부한다. → Task 13.
5. **[춤 시작] 카운트다운 중 dock으로 직접 재생** → 자동 재생을 또 하지 않는다(`StemPlayer.play()` 재호출은 재생 위치를 되감는다). → Task 11 "external play cancels", Task 12 `startPlayback` 가드.

## 파일 구조

| 경로 (app/ 기준) | 책임 |
|---|---|
| `scripts/android.cjs` (수정) | Windows에서 JDK(`java.exe`)·`gradlew.bat` 찾기 |
| `../id403/tools/export_golden.py` (id403에 추가) | 합성 포즈 → Python 파이프라인 → 정답 데이터 `.json.gz` |
| `scripts/fixtures/tracking/*.json.gz` | 정답 데이터 8개(합성만) |
| `src/tracking/types.ts` | 포즈·결과·메시지·누적값·모듈 이벤트 타입 |
| `src/tracking/segments.ts` | 관절 번호, 부위, 관절 각도, 스켈레톤 선, `bySegment`/`byLevel` |
| `src/tracking/math.ts` | 벡터·median·percentile·`pyRound`(파이썬 반올림) |
| `src/tracking/config.ts` | `DEFAULT_CONFIG`, `withConfig`, `shareOptions`, `detectorJson` |
| `src/tracking/smoothing.ts` | One Euro 필터 |
| `src/tracking/features.ts` | 정규화, 관절 각도, 부위 활동, 다리 기하, 높이 |
| `src/tracking/calibration.ts` | 3초 캘리브레이션 |
| `src/tracking/tracker.ts` | waiting → calibrating → tracking, 프레임 결과 |
| `src/tracking/windows.ts` | 8카운트 창 전략(`rolling`/`eights`/`grid`), `planFor`, 박 번호 |
| `src/tracking/usage.ts` | 누적값, 비율·안 가본 쪽 계산, `UsageAccumulator` |
| `src/tracking/phrases.ts`, `feedback.ts` | 제안 문장, 제안 시점 |
| `src/tracking/pipeline.ts` | 트래커 → 누적기 → 제안, 재생 중일 때만 집계 |
| `src/tracking/perf.ts`, `session.ts` | 속도 측정, `LiveSession`(메시지 발행·저장값 내보내기) |
| `src/tracking/store.ts` | 모듈 이벤트 + 음악 위치 → 세션, 화면용 view(throttle) |
| `src/tracking/danceStart.ts` | [춤 시작] 카운트다운·캘리브레이션 상태 머신 |
| `src/tracking/overlay.ts` | 프레임 좌표 → 미리보기 박스 좌표(잘림·거울) |
| `src/tracking/insights.ts` | 안 가본 쪽 목록, 분석 탭 집계 |
| `src/tracking/validate.ts` | 저장된 `tracking` 형식 검사 |
| `modules/pose-camera/` | Kotlin Expo 모듈: CameraX 미리보기 + MediaPipe → `onPose` |
| `scripts/download-models.cjs` | lite 모델을 모듈 assets로 받기(git 제외) |
| `src/components/tracking/` | `CameraTab`, `SkeletonOverlay`, `BodyUsageBars`, `TrackingInsightCard` |
| `scripts/test-tracking.cjs`, `scripts/tracking/*.test.cjs` | 트래킹 테스트 실행기와 테스트 |
| `docs/TRACKING.md` (레포 루트 `docs/`) | 원칙·구조·메시지·명령·실기기 표 |

**PR 단계(push는 태양 승인 후):** PR 1 = Task 1, PR 2 = Task 2–9, PR 3 = Task 10–12, PR 4 = Task 13–15.

**시작 전 (스펙 §6):** 태양에게 확인한다. (1) 성원에게 고칠 성원 파일 목록(Global Constraints의 목록)을 공유했는지. 공유하지 않았으면 목록을 메시지 초안으로 만들어 태양에게 건네고, 답을 받은 뒤 시작한다. (2) 실기기 확인(Task 12–14)에 쓸 갤럭시를 USB로 연결할 수 있는지. 워치 연동은 이번 범위가 아니므로 성원의 서명 키는 필요 없다.

---

### Task 1: Windows에서 Android 빌드

**Files:**
- Modify: `app/scripts/android.cjs` (전체 교체)

**Interfaces:**
- Consumes: 없음
- Produces: `npm run android -- --check`, `npm run build:android`가 Windows에서 동작. 이후 Task의 실기기 빌드가 이걸 쓴다.

- [ ] **Step 1: 지금 실패하는지 확인**

```powershell
cd C:\Users\hotsu\EIGHT\app
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
node scripts/android.cjs --check
```
Expected: `Android 빌드에는 JDK 17 이상이 필요합니다. ...`로 종료 코드 1. 스크립트가 `bin/java`만 찾아서 `java.exe`를 못 보고, PATH의 Java 1.8로 떨어지기 때문이다.

- [ ] **Step 2: `scripts/android.cjs`를 아래로 교체**

```js
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const env = { ...process.env };
const win = process.platform === 'win32';
const javaBin = home => path.join(home, 'bin', win ? 'java.exe' : 'java');
const candidates = [env.JAVA_HOME, '/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home', '/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home', '/Applications/Android Studio.app/Contents/jbr/Contents/Home', 'C:\\Program Files\\Android\\Android Studio\\jbr'].filter(Boolean);
const major = bin => { const r = spawnSync(bin, ['-version'], { encoding: 'utf8' }); const m = `${r.stderr ?? ''}${r.stdout ?? ''}`.match(/version "(\d+)(?:\.(\d+))?/); return m ? Number(m[1] === '1' ? m[2] : m[1]) : 0; };
const jdk = candidates.find(p => fs.existsSync(javaBin(p)) && major(javaBin(p)) >= 17);
if (jdk) { env.JAVA_HOME = jdk; env.PATH = `${path.join(jdk, 'bin')}${path.delimiter}${env.PATH ?? ''}`; }
else if (major('java') < 17) { console.error('Android 빌드에는 JDK 17 이상이 필요합니다. JDK 설치 후 JAVA_HOME을 지정하세요.'); process.exit(1); }
const sdk = [env.ANDROID_HOME, env.ANDROID_SDK_ROOT, path.join(os.homedir(), 'Library/Android/sdk'), path.join(os.homedir(), 'Android/Sdk'), env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Android/Sdk')].filter(Boolean).find(p => fs.existsSync(path.join(p, 'platform-tools')));
if (sdk) { env.ANDROID_HOME = sdk; env.ANDROID_SDK_ROOT = sdk; env.PATH = `${path.join(sdk, 'platform-tools')}${path.delimiter}${env.PATH ?? ''}`; }
else if (!fs.existsSync(path.join(root, 'android/local.properties'))) { console.error('Android SDK를 찾지 못했습니다. Android Studio에서 SDK 설치 후 ANDROID_HOME을 지정하세요.'); process.exit(1); }
console.log(`Android 환경: Java ${major(jdk ? javaBin(jdk) : 'java')} · SDK ${sdk ?? 'local.properties'}`);
const args = process.argv.slice(2);
if (args.includes('--check')) process.exit(0);
const buildOnly = args.includes('--build-only');
const cli = path.join(path.dirname(require.resolve('expo/package.json')), 'bin/cli');
// Node refuses to spawn .bat files without a shell on Windows (CVE-2024-27980).
const child = buildOnly
  ? spawn(win ? 'gradlew.bat' : './gradlew', ['app:assembleDebug', '-x', 'lint', '-x', 'test', '--build-cache', '-PreactNativeDevServerPort=8081', '-PreactNativeArchitectures=arm64-v8a'], { cwd: path.join(root, 'android'), env, stdio: 'inherit', shell: win })
  : spawn(process.execPath, [cli, 'run:android', ...args], { cwd: root, env, stdio: 'inherit' });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
```

- [ ] **Step 3: 환경 확인이 통과하는지 확인**

```powershell
node scripts/android.cjs --check
```
Expected: `Android 환경: Java 17 이상(예: 21) · SDK C:\Users\hotsu\AppData\Local\Android\Sdk`, 종료 코드 0. `$env:JAVA_HOME`을 지워도(`Remove-Item Env:JAVA_HOME`) 후보 목록의 Android Studio 경로로 같은 결과가 나와야 한다.

- [ ] **Step 4: 성원 앱 그대로 APK 빌드 (도구 확인)**

```powershell
npx expo prebuild --platform android --no-install
npm run build:android
```
Expected: `BUILD SUCCESSFUL`, `android\app\build\outputs\apk\debug\app-debug.apk` 생성. 첫 빌드는 10–20분 걸릴 수 있다. `android/`는 git 제외 폴더다(`/app/android/`).

- [ ] **Step 5: lint·typecheck 후 커밋**

```powershell
npm run lint; npm run typecheck
git add scripts/android.cjs
git commit -m "Find the JDK and run Gradle on Windows in the Android build script" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: id403에서 정답 데이터 만들기

**Files:**
- Create: `C:\Users\hotsu\id403\tools\export_golden.py` (id403 레포, 브랜치 `golden-export`)
- Create: `app/scripts/fixtures/tracking/{still,arms_only,legs_only,occluded_arm,floor_low,arms_up_jump,lost_and_found,demo}.json.gz` (EIGHT)

**Interfaces:**
- Consumes: id403 `LivePipeline`, `tests/posegen.py`, `tools/fake_publisher.py`의 `SyntheticDancer`
- Produces: gzip JSON `{ name, fps, config: {pose, smoothing, calibration, features, aggregate, perf, feedback}, frames: [{t_ms, image?, world?, visibility?}], expected: [{result: FrameResult dict | null, messages: [...] | null}] }`. `image`·`world`는 33×[x,y,z], 사람이 없는 프레임은 `{t_ms}`만 있다. 파이프라인은 `stamp_ms = t_ms`로 돌린다. Task 9가 읽는다.

- [ ] **Step 1: id403에 브랜치 만들기**

```powershell
cd C:\Users\hotsu\id403
git switch -c golden-export
```

- [ ] **Step 2: `tools/export_golden.py` 작성**

```python
"""Export golden fixtures for the TypeScript port of this pipeline (EIGHT app, src/tracking/).

    python tools/export_golden.py --out C:/Users/hotsu/EIGHT/app/scripts/fixtures/tracking

Each scenario feeds synthetic PoseFrames through LivePipeline (config/default.yaml only, never
config/local.yaml) and records, per frame, the tracker's FrameResult and the tick's messages.
Inputs are rounded to 5 decimals before use, so both sides see identical numbers.
Synthetic poses only: the EIGHT repo is public, so never landmarks from real recordings.
"""

from __future__ import annotations

import argparse
import gzip
import json
import math
import sys
from collections.abc import Callable
from dataclasses import asdict
from pathlib import Path

import numpy as np
import yaml

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "src"), str(ROOT / "tests"), str(ROOT / "tools")]
from body_usage.config import DEFAULT_CONFIG  # noqa: E402
from body_usage.pipeline import LivePipeline  # noqa: E402
from body_usage.processing import segments as S  # noqa: E402
from body_usage.types import NUM_LANDMARKS, PoseFrame  # noqa: E402
from fake_publisher import SyntheticDancer  # noqa: E402
from posegen import frame, standing_image  # noqa: E402

SECTIONS = ("pose", "smoothing", "calibration", "features", "aggregate", "perf", "feedback")
CALIB_S = 4.0  # stand still first, like a dancer at session start
GROOVE = 2 * math.pi * 0.5  # 0.5 Hz

PoseFn = Callable[[int, np.random.Generator], PoseFrame | None]
MoveFn = Callable[[int, float, np.random.Generator], PoseFrame | None]


def stick(t_ms: int, rng: np.random.Generator, image: np.ndarray, visibility=None) -> PoseFrame:
    """Stick figure with detector jitter; world landmarks follow from the image."""
    return frame(t_ms, image + rng.normal(0, 0.002, image.shape), visibility)


def after_still(move: MoveFn) -> Callable[[], PoseFn]:
    def make() -> PoseFn:
        def pose(t_ms: int, rng: np.random.Generator) -> PoseFrame | None:
            t_s = t_ms / 1000
            if t_s < CALIB_S:
                return stick(t_ms, rng, standing_image())
            return move(t_ms, t_s - CALIB_S, rng)

        return pose

    return make


def still(t_ms, t, rng):
    return stick(t_ms, rng, standing_image())


def arms(t_ms, t, rng):
    img = standing_image()
    img[[S.L_ELBOW, S.L_WRIST, S.R_ELBOW, S.R_WRIST], 0] += 0.1 * math.sin(GROOVE * t)
    return stick(t_ms, rng, img)


def legs(t_ms, t, rng):
    img = standing_image()
    step = math.sin(GROOVE * t)
    img[[S.L_KNEE, S.L_ANKLE, S.L_FOOT], 1] -= 0.06 * max(step, 0.0)
    img[[S.R_KNEE, S.R_ANKLE, S.R_FOOT], 1] -= 0.06 * max(-step, 0.0)
    return stick(t_ms, rng, img)


def occluded_arm(t_ms, t, rng):
    img = standing_image()
    img[[S.L_ELBOW, S.L_WRIST, S.R_ELBOW, S.R_WRIST], 0] += 0.1 * math.sin(GROOVE * t)
    vis = np.ones(NUM_LANDMARKS)
    if int(t // 2) % 2 == 0:  # left arm hidden every other 2 s
        vis[[S.L_ELBOW, S.L_WRIST]] = 0.0
    return stick(t_ms, rng, img, vis)


def floor_low(t_ms, t, rng):
    img = standing_image(hip_y=0.7, shoulder_y=0.5, nose_y=0.4, wrist_y=0.7)
    img[[S.L_ELBOW, S.L_WRIST], 0] += 0.05 * math.sin(GROOVE * t)
    return stick(t_ms, rng, img)


def arms_up_jump(t_ms, t, rng):
    if int(t // 2) % 2 == 0:
        img = standing_image(wrist_y=0.05)
    else:  # whole body 0.1 up with tucked legs
        img = standing_image(hip_y=0.4, shoulder_y=0.2, nose_y=0.1, wrist_y=0.4, ankle_y=0.6)
    return stick(t_ms, rng, img)


def lost_and_found(t_ms, t, rng):
    if 6.0 <= t < 7.5:  # dancer out of view for 1.5 s
        return None
    return arms(t_ms, t, rng)


def demo() -> PoseFn:
    dancer = SyntheticDancer(seed=0)
    return lambda t_ms, rng: dancer.pose(t_ms, t_ms / 1000)


SCENARIOS: dict[str, tuple[float, int, Callable[[], PoseFn]]] = {  # name -> (s, fps, poses)
    "still": (8, 15, after_still(still)),
    "arms_only": (30, 15, after_still(arms)),
    "legs_only": (30, 15, after_still(legs)),
    "occluded_arm": (24, 15, after_still(occluded_arm)),
    "floor_low": (20, 15, after_still(floor_low)),
    "arms_up_jump": (20, 15, after_still(arms_up_jump)),
    "lost_and_found": (20, 15, after_still(lost_and_found)),
    "demo": (100, 10, demo),
}


def rounded(p: PoseFrame) -> PoseFrame:
    return PoseFrame(
        p.t_ms, np.round(p.image_lm, 5), np.round(p.world_lm, 5), np.round(p.visibility, 5)
    )


def run(name: str, seconds: float, fps: int, make: Callable[[], PoseFn], cfg: dict) -> dict:
    pipe = LivePipeline(cfg)
    results: list = []
    update = pipe.tracker.update

    def recording_update(t_ms, pose):
        res = update(t_ms, pose)
        results.append(res)
        return res

    pipe.tracker.update = recording_update
    poses, rng, dt = make(), np.random.default_rng(0), 1000 // fps
    frames, expected = [], []
    for i in range(int(seconds * fps)):
        t = i * dt
        raw = poses(t, rng)
        pose = rounded(raw) if raw is not None else None
        tick = pipe.step(t, pose, stamp_ms=t)
        res = results[-1]
        if pose is None:
            frames.append({"t_ms": t})
        else:
            frames.append(
                {
                    "t_ms": t,
                    "image": pose.image_lm.tolist(),
                    "world": pose.world_lm.tolist(),
                    "visibility": pose.visibility.tolist(),
                }
            )
        expected.append(
            {
                "result": asdict(res) if res is not None else None,
                "messages": tick.messages() if tick else None,
            }
        )
    config = {k: cfg[k] for k in SECTIONS}
    return {"name": name, "fps": fps, "config": config, "frames": frames, "expected": expected}


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--out", type=Path, required=True)
    a = p.parse_args()
    cfg = yaml.safe_load(DEFAULT_CONFIG.read_text(encoding="utf-8"))
    a.out.mkdir(parents=True, exist_ok=True)
    for name, (seconds, fps, make) in SCENARIOS.items():
        fx = run(name, seconds, fps, make, cfg)
        cues = [
            m for e in fx["expected"] for m in (e["messages"] or []) if m.get("type") == "feedback"
        ]
        data = json.dumps(fx, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        path = a.out / f"{name}.json.gz"
        path.write_bytes(gzip.compress(data, mtime=0))  # mtime=0: same input, same bytes
        kinds = ", ".join(f"{c['kind']}:{c['target']}" for c in cues)
        print(f"{name:15s} {len(fx['frames']):5d} frames {len(cues):3d} cues  {kinds}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 3: 실행**

```powershell
cd C:\Users\hotsu\id403
.venv\Scripts\python.exe tools\export_golden.py --out C:\Users\hotsu\EIGHT\app\scripts\fixtures\tracking
```
Expected: 8줄이 출력된다. `still`은 0 cues, `arms_only`는 `level_unexplored:low` 또는 `level_unexplored:high`로 시작하는 cue가 1개 이상, `demo`는 cue 3개 이상이고 그중 `explored`가 하나 이상 있다. 이 조건이 안 맞으면 시나리오가 제안 로직을 시험하지 못하는 것이니 멈추고 원인을 본다. 다시 실행해도 `.json.gz` 바이트가 같아야 한다(`git status`에 변화 없음).

- [ ] **Step 4: id403 검사 후 커밋 (id403 레포)**

```powershell
.venv\Scripts\ruff.exe format tools/export_golden.py
.venv\Scripts\ruff.exe check tools/export_golden.py
.venv\Scripts\python.exe -m pytest
git add tools/export_golden.py
git commit -m "Add golden fixture export for the TypeScript port" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: ruff 통과, pytest 전부 통과. id403은 push하지 않는다.

- [ ] **Step 5: 정답 데이터 커밋 (EIGHT)**

```powershell
cd C:\Users\hotsu\EIGHT\app
git add scripts/fixtures/tracking
git commit -m "Add golden fixtures from the id403 tracking pipeline" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 3: 트래킹 기초 — 타입, 부위, 수학, 설정, 테스트 실행기

**Files:**
- Create: `app/src/tracking/types.ts`, `app/src/tracking/segments.ts`, `app/src/tracking/math.ts`, `app/src/tracking/config.ts`
- Create: `app/scripts/test-tracking.cjs`, `app/scripts/tracking/helpers.cjs`, `app/scripts/tracking/basics.test.cjs`
- Modify: `app/package.json` (`scripts`에 `"test:tracking"` 추가)

**Interfaces:**
- Produces (types.ts): `NUM_LANDMARKS`, `Vec3`, `Landmarks`, `PoseFrame {tMs, image, world, visibility}`, `Segment`, `Level`, `WindowName`, `TrackerState`, `CueKind`, `CueTarget`, `FrameResult {tMs, detected, scores, observed, level}`, `UsageMessage`, `FeedbackCue`, `FeedbackMessage`, `StatusMessage`, `PoseMessage`, `Percentiles`, `PerfMessage`, `OutMessage`, `UsageTotals`, `SessionTracking`, `PoseEvent`
- Produces (segments.ts): 관절 번호 상수(`NOSE`, `L_EAR`…`R_FOOT`), `SEGMENTS`, `SEGMENT_NAMES`, `JOINT_ANGLES: {name, ids, segment}[]`, `LEVELS`, `SKELETON_EDGES`, `segmentOf(i)`, `bySegment(f)`, `byLevel(f)`
- Produces (math.ts): `EPS`, `sub`, `midpoint`, `dot`, `norm`, `mean`, `median`, `percentile`, `pyRound`
- Produces (config.ts): `LevelThresholds`, `TrackingConfig`, `DeepPartial`, `DEFAULT_CONFIG`, `withConfig(over, base?)`, `shareOptions(cfg)`, `detectorJson(cfg?)`
- Produces (tests): `npm run test:tracking`는 `scripts/tracking/*.test.cjs`를 이름순으로 실행하고 파일마다 `PASS: <file>`을 찍는다. `helpers.cjs`는 `N, S, standingImage, worldFromImage, frame, rng, jitter, close`를 내보낸다.

- [ ] **Step 1: 테스트 실행기와 도우미 작성**

`app/scripts/test-tracking.cjs`:
```js
// Runs every scripts/tracking/*.test.cjs: the pure TypeScript tracking logic in src/tracking/.
const fs = require('node:fs');
const path = require('node:path');
const dir = path.join(__dirname, 'tracking');
for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.test.cjs')).sort()) {
  require(path.join(dir, file));
  console.log(`PASS: ${file}`);
}
```

`app/scripts/tracking/helpers.cjs`:
```js
// Shared helpers for the tracking tests: id403 tests/posegen.py ported, a seeded RNG, approx checks.
const assert = require('node:assert/strict');
const S = require('../load-ts.cjs')('src/tracking/segments.ts');

const N = 33;

/** Standing figure. Defaults: torso 0.2, hip->ankle 0.4 (leg ratio 2.0). Image coords, y down. */
function standingImage({ hipY = 0.5, shoulderY = 0.3, ankleY = 0.9, noseY = 0.2, wristY = 0.5 } = {}) {
  const lm = Array.from({ length: N }, () => [0.5, 0.5, 0]);
  lm[S.NOSE] = [0.5, noseY, 0];
  lm[S.L_EAR][1] = lm[S.R_EAR][1] = noseY;
  lm[S.L_SHOULDER] = [0.55, shoulderY, 0];
  lm[S.R_SHOULDER] = [0.45, shoulderY, 0];
  lm[S.L_HIP] = [0.53, hipY, 0];
  lm[S.R_HIP] = [0.47, hipY, 0];
  lm[S.L_ELBOW][1] = lm[S.R_ELBOW][1] = (shoulderY + wristY) / 2;
  lm[S.L_WRIST] = [0.6, wristY, 0];
  lm[S.R_WRIST] = [0.4, wristY, 0];
  lm[S.L_KNEE][1] = lm[S.R_KNEE][1] = (hipY + ankleY) / 2;
  for (const i of [S.L_ANKLE, S.R_ANKLE, S.L_FOOT, S.R_FOOT]) lm[i][1] = ankleY;
  return lm;
}

/** Rough metric 3D: hip-centered, ~1.6 m tall figure. */
function worldFromImage(img) {
  const hip = [0, 1, 2].map(k => (img[S.L_HIP][k] + img[S.R_HIP][k]) / 2);
  return img.map(p => p.map((v, k) => (v - hip[k]) * 2));
}

function frame(tMs, image = standingImage(), visibility = Array(N).fill(1)) {
  return { tMs, image, world: worldFromImage(image), visibility };
}

/** Seeded RNG (mulberry32) with a Box-Muller normal. */
function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, normal: (sd = 1) => sd * Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next()) };
}

const jitter = (img, r, sd = 0.002) => img.map(p => p.map(v => v + r.normal(sd)));
const close = (a, b, tol = 1e-9, msg) => assert.ok(Math.abs(a - b) <= tol, msg ?? `${a} != ${b} (tol ${tol})`);

module.exports = { N, S, standingImage, worldFromImage, frame, rng, jitter, close };
```

`app/package.json`의 `scripts`에서 `"test:motion"` 줄 다음에 추가:
```json
    "test:tracking": "node scripts/test-tracking.cjs",
```

- [ ] **Step 2: 실패하는 테스트 작성** — `app/scripts/tracking/basics.test.cjs`

```js
const assert = require('node:assert/strict');
const load = require('../load-ts.cjs');
const { median, percentile, pyRound, norm, midpoint } = load('src/tracking/math.ts');
const { SEGMENT_NAMES, SEGMENTS, JOINT_ANGLES, SKELETON_EDGES, segmentOf, bySegment, byLevel } = load('src/tracking/segments.ts');
const { DEFAULT_CONFIG, withConfig, shareOptions, detectorJson } = load('src/tracking/config.ts');

// math: numpy-compatible helpers
assert.equal(median([3, 1, 2]), 2);
assert.equal(median([4, 1, 3, 2]), 2.5);
const tens = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
assert.equal(percentile(tens, 50), 55);
assert.equal(percentile(tens, 95), 95.5);
assert.equal(pyRound(0.125, 2), 0.12, 'exact ties go to the even neighbour, like Python round()');
assert.equal(pyRound(2.5, 0), 2);
assert.equal(pyRound(3.5, 0), 4);
assert.equal(pyRound(-2.5, 0), -2);
assert.equal(pyRound(0.123456, 4), 0.1235);
assert.equal(norm([3, 4, 0]), 5);
assert.deepEqual(midpoint([0, 0, 0], [2, 4, 6]), [1, 2, 3]);

// segments: disjoint landmark sets, the dancer's own left / right
const seen = new Set();
for (const s of SEGMENT_NAMES) for (const i of SEGMENTS[s]) { assert.ok(!seen.has(i), `landmark ${i} in two segments`); seen.add(i); }
assert.equal(JOINT_ANGLES.length, 8);
assert.equal(segmentOf(15), 'arm_l');
assert.equal(segmentOf(1), null, 'eye landmarks belong to no segment');
assert.ok(SKELETON_EDGES.every(([a, b]) => a < 33 && b < 33));
assert.deepEqual(Object.keys(bySegment(() => 0)), SEGMENT_NAMES);
assert.deepEqual(byLevel(l => l), { low: 'low', mid: 'mid', high: 'high' });

// config: deep overrides leave the defaults alone
const c = withConfig({ calibration: { duration_s: 1 } });
assert.equal(c.calibration.duration_s, 1);
assert.equal(c.calibration.noise_floor_multiplier, DEFAULT_CONFIG.calibration.noise_floor_multiplier);
assert.equal(DEFAULT_CONFIG.calibration.duration_s, 3);
assert.deepEqual(shareOptions(DEFAULT_CONFIG), { underusedRatio: 0.5, minObservedRatio: 0.5, idleActivity: 0.05 });
assert.equal(JSON.parse(detectorJson()).min_detection_confidence, 0.5);
```

- [ ] **Step 3: 실패 확인**

Run: `npm run test:tracking`
Expected: FAIL — `ENOENT ... src/tracking/math.ts` (아직 없는 파일).

- [ ] **Step 4: `app/src/tracking/types.ts` 작성**

```ts
// Shared tracking types. Message shapes follow docs/TRACKING.md (= id403 docs/message-schema.md):
// their keys stay snake_case because they are the contract with the hardware / projector.

export const NUM_LANDMARKS = 33; // MediaPipe Pose topology

export type Vec3 = [number, number, number];
export type Landmarks = Vec3[];

/** One person's pose in one frame. */
export type PoseFrame = {
  tMs: number;
  image: Landmarks; // x, y in [0, 1] image coords (y down), z relative depth
  world: Landmarks; // meters, origin at hip center
  visibility: number[]; // 0..1 per landmark
};

export type Segment = 'head' | 'torso' | 'arm_l' | 'arm_r' | 'leg_l' | 'leg_r';
export type Level = 'low' | 'mid' | 'high';
export type WindowName = '8count' | 'recent' | 'session';
export type TrackerState = 'waiting' | 'calibrating' | 'tracking';
export type CueKind = 'segment_unexplored' | 'level_unexplored' | 'explored';
export type CueTarget = Segment | 'low' | 'high';

/** One tracking-state frame. scores is null when activity can't be measured this frame. */
export type FrameResult = {
  tMs: number;
  detected: boolean;
  scores: Record<Segment, number> | null;
  observed: Record<Segment, boolean> | null;
  level: Level | null;
};

/** Usage shares for one window. The message without a `type` field. */
export type UsageMessage = {
  t: number;
  window: WindowName;
  segments: Record<Segment, number>;
  level: Record<Level, number>;
  current_level: Level | null;
  underused: Segment[];
  tracking_ok: boolean;
};
export type FeedbackCue = { t: number; kind: CueKind; target: CueTarget; text: string };
export type FeedbackMessage = { type: 'feedback' } & FeedbackCue;
export type StatusMessage = { type: 'status'; t: number; state: TrackerState; progress: number; session_s: number };
/** Landmarks for drawing: 33 x [x, y, visibility], image coords, not mirrored. Never video. */
export type PoseMessage = { type: 'pose'; t: number; aspect: number; lm: Vec3[] };
export type Percentiles = { p50: number | null; p95: number | null };
export type PerfMessage = {
  type: 'perf';
  t: number;
  source_fps: number;
  pose_fps: number;
  detect_rate: number;
  lat_ms: { capture_pose: Percentiles; pipeline: Percentiles };
  capture_from: string;
  model: string;
  delegate: string;
  errors: number;
};
export type OutMessage = UsageMessage | FeedbackMessage | StatusMessage | PoseMessage | PerfMessage;

/** Running sums behind the usage windows. Saved with the session; never landmarks (principle 3). */
export type UsageTotals = {
  frames: number;
  score: Record<Segment, number>; // activity sum over observed frames
  observed: Record<Segment, number>; // frames in which the segment was visible
  levels: Record<Level, number>; // frames per level
};
export type SessionTracking = { version: 1; trackedMs: number; totals: UsageTotals };

/** One `onPose` event from the pose-camera module. Landmarks and timing only, no video. */
export type PoseEvent = {
  tMs: number; // SystemClock.elapsedRealtime() when the frame arrived (camera clock)
  seq: number; // camera frame counter (source fps)
  ageMs: number; // ms since the frame arrived, when the event was sent
  emitWallMs: number; // System.currentTimeMillis() when the event was sent
  latencyMs: number; // frame -> pose result (perf capture_pose)
  captureFrom: string; // 'sensor' | 'analyzer': where latencyMs starts
  aspect: number; // frame width / height (0.75 for an upright 4:3 frame)
  image: number[]; // 33 x [x, y, visibility], image coords, not mirrored; empty = nobody in view
  world: number[]; // 33 x [x, y, z] meters, hip-centered; empty = nobody in view
};
```

- [ ] **Step 5: `app/src/tracking/segments.ts` 작성**

```ts
// Body segment definitions on the MediaPipe 33-landmark topology (id403 processing/segments.py).
// "left/right" = the dancer's own left / right (MediaPipe convention), not the screen side.
import type { Level, Segment } from './types';

export const NOSE = 0;
export const L_EAR = 7, R_EAR = 8;
export const L_SHOULDER = 11, R_SHOULDER = 12;
export const L_ELBOW = 13, R_ELBOW = 14;
export const L_WRIST = 15, R_WRIST = 16;
export const L_HIP = 23, R_HIP = 24;
export const L_KNEE = 25, R_KNEE = 26;
export const L_ANKLE = 27, R_ANKLE = 28;
export const L_FOOT = 31, R_FOOT = 32; // foot index (toe)

/** Landmarks whose motion counts toward each segment. Disjoint, so shares sum cleanly. */
export const SEGMENTS: Record<Segment, number[]> = {
  head: [NOSE, L_EAR, R_EAR],
  torso: [L_SHOULDER, R_SHOULDER, L_HIP, R_HIP],
  arm_l: [L_ELBOW, L_WRIST],
  arm_r: [R_ELBOW, R_WRIST],
  leg_l: [L_KNEE, L_ANKLE, L_FOOT],
  leg_r: [R_KNEE, R_ANKLE, R_FOOT],
};
export const SEGMENT_NAMES: Segment[] = ['head', 'torso', 'arm_l', 'arm_r', 'leg_l', 'leg_r'];
export const LEVELS: Level[] = ['low', 'mid', 'high'];

/** Joint angles (a, vertex, b) whose angular speed counts toward a segment. Same order as id403. */
export const JOINT_ANGLES: { name: string; ids: [number, number, number]; segment: Segment }[] = [
  { name: 'shoulder_l', ids: [L_HIP, L_SHOULDER, L_ELBOW], segment: 'arm_l' },
  { name: 'shoulder_r', ids: [R_HIP, R_SHOULDER, R_ELBOW], segment: 'arm_r' },
  { name: 'elbow_l', ids: [L_SHOULDER, L_ELBOW, L_WRIST], segment: 'arm_l' },
  { name: 'elbow_r', ids: [R_SHOULDER, R_ELBOW, R_WRIST], segment: 'arm_r' },
  { name: 'hip_l', ids: [L_SHOULDER, L_HIP, L_KNEE], segment: 'leg_l' },
  { name: 'hip_r', ids: [R_SHOULDER, R_HIP, R_KNEE], segment: 'leg_r' },
  { name: 'knee_l', ids: [L_HIP, L_KNEE, L_ANKLE], segment: 'leg_l' },
  { name: 'knee_r', ids: [R_HIP, R_KNEE, R_ANKLE], segment: 'leg_r' },
];

/** Lines of the stick figure drawn over the camera preview. */
export const SKELETON_EDGES: [number, number][] = [
  [L_SHOULDER, R_SHOULDER], [L_SHOULDER, L_ELBOW], [L_ELBOW, L_WRIST], [R_SHOULDER, R_ELBOW],
  [R_ELBOW, R_WRIST], [L_SHOULDER, L_HIP], [R_SHOULDER, R_HIP], [L_HIP, R_HIP], [L_HIP, L_KNEE],
  [L_KNEE, L_ANKLE], [L_ANKLE, L_FOOT], [R_HIP, R_KNEE], [R_KNEE, R_ANKLE], [R_ANKLE, R_FOOT],
];

export const segmentOf = (landmark: number): Segment | null =>
  SEGMENT_NAMES.find(s => SEGMENTS[s].includes(landmark)) ?? null;

export const bySegment = <T>(f: (s: Segment) => T): Record<Segment, T> =>
  Object.fromEntries(SEGMENT_NAMES.map(s => [s, f(s)])) as Record<Segment, T>;

export const byLevel = <T>(f: (l: Level) => T): Record<Level, T> =>
  Object.fromEntries(LEVELS.map(l => [l, f(l)])) as Record<Level, T>;
```

- [ ] **Step 6: `app/src/tracking/math.ts` 작성**

```ts
// Small vector / statistics helpers matching numpy, so results equal the id403 pipeline.
import type { Vec3 } from './types';

export const EPS = 1e-6;
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const midpoint = (a: Vec3, b: Vec3): Vec3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const norm = (a: Vec3): number => Math.sqrt(dot(a, a));
export const mean = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** numpy.percentile(xs, q) with the default linear method. */
export function percentile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  const pos = ((s.length - 1) * q) / 100, lo = Math.floor(pos), hi = Math.ceil(pos), t = pos - lo;
  const d = s[hi] - s[lo];
  return t >= 0.5 ? s[hi] - d * (1 - t) : s[lo] + d * t;
}

/** Python round(x, digits): exact ties go to the even neighbour (Math.round goes up). */
export function pyRound(x: number, digits: number): number {
  const m = 10 ** digits, y = x * m;
  return (Math.abs(y - Math.trunc(y)) === 0.5 ? 2 * Math.round(y / 2) : Math.round(y)) / m;
}
```

- [ ] **Step 7: `app/src/tracking/config.ts` 작성**

```ts
import type { Segment } from './types';

export type LevelThresholds = { low: number; high: number; arms_up_margin: number; jump_rise: number };

/**
 * Tracking thresholds. The sections shared with id403 config/default.yaml keep its keys and values
 * (the golden test checks them); `app` holds values that exist only in this app.
 * Values marked (tune) are starting guesses, as in default.yaml.
 */
export type TrackingConfig = {
  pose: { num_poses: number; min_detection_confidence: number; min_presence_confidence: number; min_tracking_confidence: number; visibility_threshold: number };
  smoothing: { enabled: boolean; min_cutoff: number; beta: number; d_cutoff: number; reset_after_s: number };
  calibration: { duration_s: number; noise_floor_multiplier: number; max_noise_floor: number };
  features: { weights: { speed: number; angle: number }; max_dt_s: number; level_thresholds: LevelThresholds };
  aggregate: {
    windows: { '8count_s': number; recent_s: number };
    underused_ratio: number; min_observed_ratio: number; idle_activity: number;
    tracking_window_s: number; tracking_min_rate: number; publish_hz: number;
  };
  perf: { window_s: number; publish_hz: number };
  feedback: {
    enabled: boolean; warmup_s: number; persist_s: number; global_cooldown_s: number; target_cooldown_s: number;
    explored_min_gap_s: number; explored_watch_s: number; level_min_share: number; level_explored_share: number;
    segment_explored_ratio: number; segment_targets: Segment[];
  };
  app: {
    back_jump_s: number; // music time going back more than this starts a new 8count window (loop, seek)
    countdown_s: number; // [춤 시작] countdown to walk back from the phone
    cue_show_s: number; // a suggestion stays on screen this long
    view_hz: number; // camera tab refresh rate
    min_tracked_s: number; // sessions tracked shorter than this stay out of the analysis card
  };
};

export const DEFAULT_CONFIG: TrackingConfig = {
  pose: { num_poses: 1, min_detection_confidence: 0.5, min_presence_confidence: 0.5, min_tracking_confidence: 0.5, visibility_threshold: 0.5 },
  smoothing: { enabled: true, min_cutoff: 1.0, beta: 0.05, d_cutoff: 1.0, reset_after_s: 0.5 }, // min_cutoff, beta (tune)
  calibration: { duration_s: 3.0, noise_floor_multiplier: 2.0, max_noise_floor: 0.5 }, // multiplier, cap (tune)
  features: {
    weights: { speed: 1.0, angle: 0.5 },
    max_dt_s: 0.25,
    level_thresholds: { low: 0.75, high: 1.05, arms_up_margin: 0.1, jump_rise: 0.15 }, // (tune)
  },
  aggregate: {
    windows: { '8count_s': 4.0, recent_s: 30.0 },
    underused_ratio: 0.5,
    min_observed_ratio: 0.5, // (tune)
    idle_activity: 0.05, // (tune)
    tracking_window_s: 1.0,
    tracking_min_rate: 0.6,
    publish_hz: 10,
  },
  perf: { window_s: 5.0, publish_hz: 1 },
  feedback: {
    enabled: true,
    warmup_s: 15, persist_s: 6, global_cooldown_s: 12, target_cooldown_s: 45, // (tune)
    explored_min_gap_s: 3, explored_watch_s: 60,
    level_min_share: 0.1, level_explored_share: 0.3, segment_explored_ratio: 0.6, // (tune)
    segment_targets: ['arm_l', 'arm_r', 'leg_l', 'leg_r'], // (tune) head / torso read as quiet too often
  },
  app: { back_jump_s: 0.2, countdown_s: 5, cue_show_s: 8, view_hz: 15, min_tracked_s: 30 },
};

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends unknown[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K] };

type Plain = Record<string, unknown>;
const isPlain = (v: unknown): v is Plain => !!v && typeof v === 'object' && !Array.isArray(v);
function merge(base: Plain, over: Plain): Plain {
  const out: Plain = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = isPlain(v) && isPlain(base[k]) ? merge(base[k] as Plain, v) : v;
  return out;
}

/** A config with some values changed (tests, tuning). Never mutates `base`. */
export const withConfig = (over: DeepPartial<TrackingConfig>, base: TrackingConfig = DEFAULT_CONFIG): TrackingConfig =>
  merge(base as unknown as Plain, over as Plain) as unknown as TrackingConfig;

export const shareOptions = (cfg: TrackingConfig) => ({
  underusedRatio: cfg.aggregate.underused_ratio,
  minObservedRatio: cfg.aggregate.min_observed_ratio,
  idleActivity: cfg.aggregate.idle_activity,
});

/** MediaPipe detector thresholds for the pose-camera module's `detectorJson` prop. */
export const detectorJson = (cfg: TrackingConfig = DEFAULT_CONFIG): string => JSON.stringify(cfg.pose);
```

- [ ] **Step 8: 통과 확인**

Run: `npm run test:tracking`
Expected: `PASS: basics.test.cjs`

- [ ] **Step 9: lint·typecheck 후 커밋**

```powershell
npm run lint; npm run typecheck
git add src/tracking scripts/test-tracking.cjs scripts/tracking package.json
git commit -m "Add tracking types, segments, math helpers and config" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: One Euro 필터와 특징 (정규화·관절 각도·부위 활동·높이)

**Files:**
- Create: `app/src/tracking/smoothing.ts`, `app/src/tracking/features.ts`
- Test: `app/scripts/tracking/features.test.cjs`

**Interfaces:**
- Consumes: Task 3의 `types`, `segments`, `math`, `config.LevelThresholds`
- Produces (smoothing.ts): `class OneEuroFilter(minCutoff=1, beta=0.05, dCutoff=1) { reset(); filter(x: number[], tS: number): number[] }`, `flatten(lm): number[]`, `unflatten(xs): Landmarks`
- Produces (features.ts): `visibleMask(pose, threshold): boolean[]`, `hipCenter`, `shoulderCenter`, `torsoLength(lm)`, `normalize(lm)`, `angleAt(a, v, b)`, `jointAngles(lm): Record<string, number>`, `Weights`, `segmentActivity(prevNorm, currNorm, prevAngles, currAngles, dtS, visible, weights, noiseFloor?) → {scores, observed}`, `LevelRef {legRatio, hipY, torsoImg}`, `legGeometry(image, visible): [hipY, legRatio, torso] | null`, `level(image, visible, ref, th): Level | null`

- [ ] **Step 1: 실패하는 테스트 작성** — `app/scripts/tracking/features.test.cjs` (id403 `test_smoothing.py`, `test_features.py`, `test_activity.py`, `test_level.py`를 옮긴 것)

```js
const assert = require('node:assert/strict');
const load = require('../load-ts.cjs');
const { OneEuroFilter } = load('src/tracking/smoothing.ts');
const F = load('src/tracking/features.ts');
const { SEGMENT_NAMES } = load('src/tracking/segments.ts');
const { N, S, standingImage, rng, close } = require('./helpers.cjs');

// --- One Euro filter
{
  const f = new OneEuroFilter();
  let y;
  for (let i = 0; i < 30; i++) y = f.filter(Array(99).fill(1), i / 30);
  y.forEach(v => close(v, 1));
}
{
  const r = rng(0), f = new OneEuroFilter(1.0, 0.0);
  const raw = Array.from({ length: 300 }, () => Array.from({ length: 99 }, () => r.normal(0.01)));
  const out = raw.map((x, i) => f.filter(x, i / 30));
  const sd = rows => { const v = rows.slice(30).flat(); const m = v.reduce((a, b) => a + b, 0) / v.length; return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length); };
  assert.ok(sd(out) < sd(raw) * 0.6, 'reduces jitter on a still signal');
}

// --- normalization and angles
function makePose(offset = [0, 0, 0], scale = 1) {
  const r = rng(0);
  const lm = Array.from({ length: N }, () => [r.normal(0.3), r.normal(0.3), r.normal(0.3)]);
  lm[S.L_HIP] = [-0.1, 0, 0];
  lm[S.R_HIP] = [0.1, 0, 0];
  lm[S.L_SHOULDER] = [-0.15, -0.5, 0];
  lm[S.R_SHOULDER] = [0.15, -0.5, 0];
  return lm.map(p => p.map((v, k) => v * scale + offset[k]));
}
{
  const n = F.normalize(makePose([3, 2, 1], 2.5));
  F.hipCenter(n).forEach(v => close(v, 0));
  close(F.torsoLength(n), 1);
  const a = F.normalize(makePose()), b = F.normalize(makePose([10, -4, 2], 0.3));
  a.forEach((p, i) => p.forEach((v, k) => close(v, b[i][k])));
  close(F.angleAt([1, 0, 0], [0, 0, 0], [0, 1, 0]), Math.PI / 2);
  const angles = F.jointAngles(makePose());
  assert.equal(Object.keys(angles).length, 8);
  Object.values(angles).forEach(v => assert.ok(v >= 0 && v <= Math.PI));
}

// --- segment activity
const SPEED = { speed: 1, angle: 0 }, ANGLE = { speed: 0, angle: 1 }, ALL = Array(N).fill(true);
const stillPose = () => { const r = rng(1); return Array.from({ length: N }, () => [r.normal(), r.normal(), r.normal()]); };
const zeroAngles = () => Object.fromEntries(['shoulder_l', 'shoulder_r', 'elbow_l', 'elbow_r', 'hip_l', 'hip_r', 'knee_l', 'knee_r'].map(k => [k, 1]));
const copy = p => p.map(q => [...q]);
const moved = (p, ids, dx) => p.map((q, i) => (ids.includes(i) ? [q[0] + dx, q[1], q[2]] : [...q]));
const hide = ids => ALL.map((v, i) => !ids.includes(i));
{
  const p = stillPose(), a = zeroAngles();
  const { scores, observed } = F.segmentActivity(p, copy(p), a, { ...a }, 1 / 30, ALL, SPEED);
  assert.deepEqual(Object.keys(scores), SEGMENT_NAMES);
  SEGMENT_NAMES.forEach(s => { assert.equal(scores[s], 0); assert.equal(observed[s], true); });
}
{
  const prev = stillPose();
  const { scores } = F.segmentActivity(prev, moved(prev, [S.L_ELBOW, S.L_WRIST], 0.1), {}, {}, 0.1, ALL, SPEED);
  close(scores.arm_l, 1);
  SEGMENT_NAMES.filter(s => s !== 'arm_l').forEach(s => assert.equal(scores[s], 0));
}
{
  const p = stillPose(), prevA = zeroAngles(), currA = { ...prevA, elbow_l: prevA.elbow_l + 0.2 };
  const { scores } = F.segmentActivity(p, copy(p), prevA, currA, 0.1, ALL, ANGLE);
  close(scores.arm_l, 1, 1e-9, 'shoulder 0 rad/s and elbow 2 rad/s average to 1');
  assert.equal(scores.arm_r, 0);
}
{
  const prev = stillPose(), floor = Object.fromEntries(SEGMENT_NAMES.map(s => [s, 0.4]));
  const { scores } = F.segmentActivity(prev, moved(prev, [S.L_ELBOW, S.L_WRIST], 0.1), {}, {}, 0.1, ALL, SPEED, floor);
  close(scores.arm_l, 0.6);
  assert.equal(scores.leg_l, 0);
}
{
  const prev = stillPose();
  const { scores, observed } = F.segmentActivity(prev, moved(prev, [S.L_ELBOW, S.L_WRIST], 5), {}, {}, 0.1, hide([S.L_ELBOW, S.L_WRIST]), SPEED);
  assert.equal(scores.arm_l, 0);
  assert.equal(observed.arm_l, false, 'occluded is not unused');
  assert.equal(observed.arm_r, true);
}
{
  const prev = stillPose();
  const curr = moved(moved(prev, [S.L_ELBOW], 0.1), [S.L_WRIST], 9);
  const { scores, observed } = F.segmentActivity(prev, curr, {}, {}, 0.1, hide([S.L_WRIST]), SPEED);
  close(scores.arm_l, 1);
  assert.equal(observed.arm_l, true);
}
{
  const p = stillPose(), prevA = zeroAngles(), currA = { ...prevA, elbow_l: prevA.elbow_l + 0.2 };
  const { scores } = F.segmentActivity(p, copy(p), prevA, currA, 0.1, hide([S.L_WRIST]), ANGLE);
  assert.equal(scores.arm_l, 0, 'an angle with a hidden landmark is skipped');
}

// --- body level
const REF = { legRatio: 2.0, hipY: 0.5, torsoImg: 0.2 };
const TH = { low: 0.75, high: 1.05, arms_up_margin: 0.1, jump_rise: 0.15 };
const level = (img, vis = ALL, ref = REF) => F.level(img, vis, ref, TH);
assert.equal(level(standingImage()), 'mid');
assert.equal(level(standingImage({ hipY: 0.7, shoulderY: 0.5, noseY: 0.4, wristY: 0.7 })), 'low');
assert.equal(level(standingImage({ wristY: 0.05 })), 'high');
assert.equal(level(standingImage({ hipY: 0.7, shoulderY: 0.5, noseY: 0.4, wristY: 0.2 })), 'low', 'sitting with arms up');
assert.equal(level(standingImage({ ankleY: 0.95 })), 'high', 'tiptoe');
assert.equal(level(standingImage({ hipY: 0.4, shoulderY: 0.2, noseY: 0.1, wristY: 0.4, ankleY: 0.6 })), 'high', 'tuck jump');
assert.equal(level(standingImage(), hide([S.L_ANKLE, S.R_ANKLE])), null);
assert.equal(level(standingImage(), ALL, null), null);
assert.equal(level(standingImage({ wristY: 0.05 }), hide([S.L_WRIST, S.R_WRIST])), 'mid', 'hidden wrists are not arms up');
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test:tracking`
Expected: `PASS: basics.test.cjs` 다음 `features.test.cjs`에서 FAIL (`ENOENT ... smoothing.ts`).

- [ ] **Step 3: `app/src/tracking/smoothing.ts` 작성**

```ts
// One Euro filter (Casiez et al., CHI 2012), element-wise over a flat array (id403 smoothing.py).
// Jitter on a still body would otherwise count as "using" that part, so this is core logic.
import type { Landmarks, Vec3 } from './types';

const alpha = (cutoff: number, dt: number) => 1 / (1 + 1 / (2 * Math.PI * cutoff) / dt);

export class OneEuroFilter {
  private xPrev: number[] | null = null;
  private dxPrev: number[] | null = null;
  private tPrev: number | null = null;

  constructor(readonly minCutoff = 1.0, readonly beta = 0.05, readonly dCutoff = 1.0) {}

  reset(): void {
    this.xPrev = this.dxPrev = this.tPrev = null;
  }

  filter(x: number[], tS: number): number[] {
    if (this.xPrev === null || this.dxPrev === null || this.tPrev === null) {
      this.xPrev = [...x];
      this.dxPrev = x.map(() => 0);
      this.tPrev = tS;
      return [...x];
    }
    const dt = Math.max(tS - this.tPrev, 1e-6), aD = alpha(this.dCutoff, dt);
    const out = new Array<number>(x.length), dxHat = new Array<number>(x.length);
    for (let i = 0; i < x.length; i++) {
      const dx = (x[i] - this.xPrev[i]) / dt;
      dxHat[i] = aD * dx + (1 - aD) * this.dxPrev[i];
      const tau = 1 / (2 * Math.PI * (this.minCutoff + this.beta * Math.abs(dxHat[i])));
      const a = 1 / (1 + tau / dt);
      out[i] = a * x[i] + (1 - a) * this.xPrev[i];
    }
    this.xPrev = out;
    this.dxPrev = dxHat;
    this.tPrev = tS;
    return [...out];
  }
}

export const flatten = (lm: Landmarks): number[] => lm.flatMap(p => [p[0], p[1], p[2]]);
export const unflatten = (xs: number[]): Landmarks =>
  Array.from({ length: xs.length / 3 }, (_, i) => [xs[3 * i], xs[3 * i + 1], xs[3 * i + 2]] as Vec3);
```

- [ ] **Step 4: `app/src/tracking/features.ts` 작성**

```ts
// Feature extraction: normalization, joint angles, segment activity, body level (id403 features.py).
import type { LevelThresholds } from './config';
import { EPS, dot, mean, midpoint, norm, sub } from './math';
import {
  JOINT_ANGLES, L_ANKLE, L_HIP, L_SHOULDER, L_WRIST, NOSE, R_ANKLE, R_HIP, R_SHOULDER, R_WRIST,
  SEGMENTS, SEGMENT_NAMES, bySegment,
} from './segments';
import type { Landmarks, Level, PoseFrame, Segment, Vec3 } from './types';

export const visibleMask = (pose: PoseFrame, threshold: number): boolean[] => pose.visibility.map(v => v >= threshold);

export const hipCenter = (lm: Landmarks): Vec3 => midpoint(lm[L_HIP], lm[R_HIP]);
export const shoulderCenter = (lm: Landmarks): Vec3 => midpoint(lm[L_SHOULDER], lm[R_SHOULDER]);
export const torsoLength = (lm: Landmarks): number => norm(sub(shoulderCenter(lm), hipCenter(lm)));

/** Hip-centered, scaled by torso length: removes distance, body size and travel, so only body-relative motion stays. */
export function normalize(lm: Landmarks): Landmarks {
  const scale = Math.max(torsoLength(lm), EPS), hip = hipCenter(lm);
  return lm.map(p => [(p[0] - hip[0]) / scale, (p[1] - hip[1]) / scale, (p[2] - hip[2]) / scale]);
}

/** Angle (radians, 0..pi) at `vertex` between rays to a and b. */
export function angleAt(a: Vec3, vertex: Vec3, b: Vec3): number {
  const v1 = sub(a, vertex), v2 = sub(b, vertex);
  const cos = dot(v1, v2) / Math.max(norm(v1) * norm(v2), EPS);
  return Math.acos(Math.min(1, Math.max(-1, cos)));
}

export const jointAngles = (lm: Landmarks): Record<string, number> =>
  Object.fromEntries(JOINT_ANGLES.map(j => [j.name, angleAt(lm[j.ids[0]], lm[j.ids[1]], lm[j.ids[2]])]));

export type Weights = { speed?: number; angle?: number };

/**
 * Per-segment activity for one frame step. `visible` = landmarks reliable in both frames.
 * score = w_speed * mean landmark speed + w_angle * mean joint angular speed - noise floor, clamped at 0.
 * observed[seg] is false when none of its landmarks are visible (occluded != unused, principle 4).
 */
export function segmentActivity(
  prevNorm: Landmarks, currNorm: Landmarks, prevAngles: Record<string, number>, currAngles: Record<string, number>,
  dtS: number, visible: boolean[], weights: Weights, noiseFloor?: Partial<Record<Segment, number>> | null,
): { scores: Record<Segment, number>; observed: Record<Segment, boolean> } {
  const wSpeed = weights.speed ?? 1.0, wAngle = weights.angle ?? 0.0;
  const speed = currNorm.map((p, i) => norm(sub(p, prevNorm[i])) / dtS);
  const angSpeed = bySegment<number[]>(() => []);
  for (const { name, ids, segment } of JOINT_ANGLES)
    if (name in prevAngles && name in currAngles && ids.every(i => visible[i]))
      angSpeed[segment].push(Math.abs(currAngles[name] - prevAngles[name]) / dtS);
  const useFloor = !!noiseFloor && Object.keys(noiseFloor).length > 0;
  const scores = bySegment(() => 0), observed = bySegment(() => false);
  for (const seg of SEGMENT_NAMES) {
    const vis = SEGMENTS[seg].filter(i => visible[i]);
    observed[seg] = vis.length > 0;
    if (!vis.length) continue;
    let score = wSpeed * mean(vis.map(i => speed[i]));
    if (angSpeed[seg].length) score += wAngle * mean(angSpeed[seg]);
    if (useFloor) score -= noiseFloor?.[seg] ?? 0;
    scores[seg] = Math.max(score, 0);
  }
  return { scores, observed };
}

/** Standing reference from calibration (image coords, y down). */
export type LevelRef = { legRatio: number; hipY: number; torsoImg: number };

/** [hipY, (ankleY - hipY) / torso, torso] in image coords, or null if not visible. */
export function legGeometry(image: Landmarks, visible: boolean[]): [number, number, number] | null {
  if (![L_HIP, R_HIP, L_SHOULDER, R_SHOULDER].every(i => visible[i])) return null;
  const ankles = [L_ANKLE, R_ANKLE].filter(i => visible[i]);
  if (!ankles.length) return null;
  const xy = image.map(p => [p[0], p[1], 0] as Vec3);
  const torso = torsoLength(xy);
  if (torso < EPS) return null;
  const hipY = hipCenter(xy)[1];
  return [hipY, (mean(ankles.map(i => xy[i][1])) - hipY) / torso, torso];
}

/**
 * Body level, null if it can't be judged. ratio = leg extent now / standing leg extent. In order:
 * hip risen > jump_rise * torso -> high; ratio < low -> low; wrist above nose by arms_up_margin * torso
 * or ratio > high (tiptoe) -> high; otherwise mid.
 */
export function level(image: Landmarks, visible: boolean[], ref: LevelRef | null, th: LevelThresholds): Level | null {
  const geo = legGeometry(image, visible);
  if (!ref || ref.legRatio < EPS || !geo) return null;
  const [hipY, legRatio, torso] = geo, ratio = legRatio / ref.legRatio;
  if (hipY < ref.hipY - th.jump_rise * ref.torsoImg) return 'high';
  if (ratio < th.low) return 'low';
  if (visible[NOSE]) {
    const wrists = [L_WRIST, R_WRIST].filter(i => visible[i]);
    const top = image[NOSE][1] - th.arms_up_margin * torso;
    if (wrists.length && Math.min(...wrists.map(i => image[i][1])) < top) return 'high';
  }
  if (ratio > th.high) return 'high';
  return 'mid';
}
```

- [ ] **Step 5: 통과 확인**

Run: `npm run test:tracking`
Expected: `PASS: basics.test.cjs`, `PASS: features.test.cjs`

- [ ] **Step 6: 커밋**

```powershell
npm run lint; npm run typecheck
git add src/tracking scripts/tracking
git commit -m "Add One Euro smoothing and pose features" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 캘리브레이션과 트래커

**Files:**
- Create: `app/src/tracking/calibration.ts`, `app/src/tracking/tracker.ts`
- Test: `app/scripts/tracking/tracker.test.cjs`

**Interfaces:**
- Consumes: Task 3–4
- Produces (calibration.ts): `CalibrationResult {noiseFloor, torsoLength, levelRef}`, `CalibratorOptions {durationS, noiseFloorMultiplier, maxNoiseFloor, visibilityThreshold}`, `class Calibrator { add(pose, rawActivity | null); progress; done; result() }`
- Produces (tracker.ts): `class BodyTracker(cfg: TrackingConfig) { state: TrackerState; calibration: CalibrationResult | null; progress; reset(); update(tMs, pose | null): FrameResult | null }`. `update`는 tracking 중에만 결과를 낸다(사람이 없으면 `detected: false`).

- [ ] **Step 1: 실패하는 테스트 작성** — `app/scripts/tracking/tracker.test.cjs` (id403 `test_calibration.py`, `test_tracker.py`)

```js
const assert = require('node:assert/strict');
const load = require('../load-ts.cjs');
const { Calibrator } = load('src/tracking/calibration.ts');
const { BodyTracker } = load('src/tracking/tracker.ts');
const { withConfig } = load('src/tracking/config.ts');
const { SEGMENT_NAMES } = load('src/tracking/segments.ts');
const { N, S, standingImage, frame, rng, jitter, close } = require('./helpers.cjs');

// --- calibration
const raw = armL => Object.fromEntries(SEGMENT_NAMES.map(s => [s, s === 'arm_l' ? armL : 0]));
const cal = (o = {}) => new Calibrator({ durationS: 3, noiseFloorMultiplier: 2, maxNoiseFloor: 0.5, visibilityThreshold: 0.5, ...o });
{
  const c = cal();
  c.add(frame(0), null);
  c.add(frame(1500), raw(0));
  assert.equal(c.done, false);
  close(c.progress, 0.5);
  c.add(frame(3000), raw(0));
  assert.equal(c.done, true);
  assert.equal(c.progress, 1);
}
{
  const c = cal({ durationS: 1, maxNoiseFloor: 10 });
  c.add(frame(0), null);
  [0.1, 0.1, 0.2, 0.1, 5.0].forEach((v, i) => c.add(frame(250 * (i + 1)), raw(v)));
  const floor = c.result().noiseFloor;
  close(floor.arm_l, 0.2, 1e-9, 'k x median: one twitch must not dominate');
  assert.equal(floor.leg_l, 0);
}
{
  const c = cal({ durationS: 1 });
  c.add(frame(0), null);
  c.add(frame(1000), raw(1));
  close(c.result().noiseFloor.arm_l, 0.5, 1e-9, 'capped when the dancer moved');
}
{
  const c = cal({ durationS: 1 });
  c.add(frame(0), null);
  c.add(frame(1000), raw(0));
  const ref = c.result().levelRef;
  assert.ok(ref);
  close(ref.legRatio, 2);
  close(ref.hipY, 0.5);
  close(ref.torsoImg, 0.2);
}
{
  const vis = Array(N).fill(1);
  for (const i of [S.L_ANKLE, S.R_ANKLE, S.L_FOOT, S.R_FOOT]) vis[i] = 0;
  const c = cal({ durationS: 1 });
  c.add(frame(0, standingImage(), vis), null);
  c.add(frame(1000, standingImage(), vis), raw(0));
  assert.equal(c.result().levelRef, null);
}

// --- tracker
const DT = 33;
const makeTracker = () => new BodyTracker(withConfig({ calibration: { duration_s: 1 } }));
function calibrate(tr, t0 = 0, r = null) {
  let t = t0;
  while (tr.state !== 'tracking') {
    tr.update(t, frame(t, r ? jitter(standingImage(), r) : standingImage()));
    t += DT;
  }
  return t;
}
{
  const tr = makeTracker();
  assert.equal(tr.state, 'waiting');
  assert.equal(tr.update(0, null), null);
  assert.equal(tr.update(0, frame(0)), null);
  assert.equal(tr.state, 'calibrating');
  assert.equal(tr.update(500, frame(500)), null);
  assert.ok(tr.progress > 0.4 && tr.progress < 0.6);
  const t = calibrate(tr, 533);
  assert.equal(tr.state, 'tracking');
  const res = tr.update(t, frame(t));
  assert.ok(res && res.detected);
}
{
  const tr = makeTracker();
  tr.update(0, frame(0));
  tr.update(300, frame(300));
  tr.update(1200, null); // gone 0.9 s > reset_after_s
  assert.equal(tr.state, 'waiting');
  assert.equal(tr.progress, 0);
}
{
  const tr = makeTracker();
  const res = tr.update(calibrate(tr), null);
  assert.ok(res);
  assert.equal(res.detected, false);
  assert.equal(res.scores, null);
}
{
  const tr = makeTracker();
  const t = calibrate(tr) + 1000; // 1 s gap > max_dt_s
  const res = tr.update(t, frame(t));
  assert.equal(res.detected, true);
  assert.equal(res.scores, null);
}
{
  const r = rng(0), tr = makeTracker();
  let t = calibrate(tr, 0, r);
  const totals = Object.fromEntries(SEGMENT_NAMES.map(s => [s, 0]));
  for (let i = 0; i < 90; i++) { // 3 s of a waving left arm under jitter
    const img = jitter(standingImage(), r);
    for (const k of [S.L_ELBOW, S.L_WRIST]) img[k][0] += 0.1 * Math.sin(i / 3);
    const res = tr.update(t, frame(t, img));
    t += DT;
    if (res.scores) for (const s of SEGMENT_NAMES) totals[s] += res.scores[s];
  }
  assert.equal(SEGMENT_NAMES.reduce((a, b) => (totals[b] > totals[a] ? b : a)), 'arm_l');
  assert.ok(totals.leg_l < 0.1 * totals.arm_l && totals.leg_r < 0.1 * totals.arm_l, 'still legs stay near zero');
}
{
  const tr = makeTracker();
  let t = calibrate(tr);
  assert.equal(tr.update(t, frame(t)).level, 'mid');
  const squat = standingImage({ hipY: 0.7, shoulderY: 0.5, noseY: 0.4, wristY: 0.7 });
  let res;
  for (let i = 0; i < 30; i++) { t += DT; res = tr.update(t, frame(t, squat)); } // held 1 s (smoothing lags)
  assert.equal(res.level, 'low');
}
{
  const tr = makeTracker();
  const t = calibrate(tr);
  tr.reset();
  assert.equal(tr.state, 'waiting');
  assert.equal(tr.update(t, frame(t)), null);
  assert.equal(tr.state, 'calibrating');
}
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test:tracking`
Expected: `tracker.test.cjs`에서 FAIL (`ENOENT ... calibration.ts`).

- [ ] **Step 3: `app/src/tracking/calibration.ts` 작성**

```ts
// Calibration: the dancer stands still for duration_s at session start (id403 calibration.py).
// Measures the per-segment noise floor (activity while still), torso length, and the standing
// leg geometry used as the reference for body level.
import { legGeometry, torsoLength, visibleMask, type LevelRef } from './features';
import { median } from './math';
import { SEGMENT_NAMES, bySegment } from './segments';
import type { PoseFrame, Segment } from './types';

export type CalibrationResult = { noiseFloor: Record<Segment, number>; torsoLength: number; levelRef: LevelRef | null };
export type CalibratorOptions = { durationS: number; noiseFloorMultiplier: number; maxNoiseFloor: number; visibilityThreshold: number };

export class Calibrator {
  private t0: number | null = null;
  private tLast: number | null = null;
  private raw = bySegment<number[]>(() => []);
  private torso: number[] = [];
  private geo: [number, number, number][] = [];

  constructor(private readonly o: CalibratorOptions) {}

  /** rawActivity = segment scores without a noise floor (null for the first frame). */
  add(pose: PoseFrame, rawActivity: Record<Segment, number> | null): void {
    if (this.t0 === null) this.t0 = pose.tMs;
    this.tLast = pose.tMs;
    if (rawActivity) for (const s of SEGMENT_NAMES) this.raw[s].push(rawActivity[s] ?? 0);
    this.torso.push(torsoLength(pose.world));
    const g = legGeometry(pose.image, visibleMask(pose, this.o.visibilityThreshold));
    if (g) this.geo.push(g);
  }

  get progress(): number {
    if (this.t0 === null || this.tLast === null) return 0;
    return Math.min((this.tLast - this.t0) / 1000 / this.o.durationS, 1);
  }

  get done(): boolean {
    return this.progress >= 1;
  }

  result(): CalibrationResult {
    const noiseFloor = bySegment(s => {
      const v = this.raw[s];
      return Math.min(v.length ? this.o.noiseFloorMultiplier * median(v) : 0, this.o.maxNoiseFloor);
    });
    const levelRef = this.geo.length
      ? { hipY: median(this.geo.map(g => g[0])), legRatio: median(this.geo.map(g => g[1])), torsoImg: median(this.geo.map(g => g[2])) }
      : null;
    return { noiseFloor, torsoLength: this.torso.length ? median(this.torso) : 0, levelRef };
  }
}
```

- [ ] **Step 4: `app/src/tracking/tracker.ts` 작성**

```ts
// Per-frame body tracking: smoothing -> calibration -> segment activity + level (id403 tracker.py).
// States: "waiting" (no dancer yet) -> "calibrating" (stand still) -> "tracking".
import { Calibrator, type CalibrationResult } from './calibration';
import type { TrackingConfig } from './config';
import { jointAngles, level, normalize, segmentActivity, visibleMask } from './features';
import { OneEuroFilter, flatten, unflatten } from './smoothing';
import type { FrameResult, Landmarks, PoseFrame, Segment, TrackerState } from './types';

type Prev = { tMs: number; norm: Landmarks; angles: Record<string, number>; visible: boolean[] };

export class BodyTracker {
  state: TrackerState = 'waiting';
  calibration: CalibrationResult | null = null;
  private calibrator!: Calibrator;
  private prev: Prev | null = null;
  private lastSeen: number | null = null;
  private worldFilter!: OneEuroFilter;
  private imageFilter!: OneEuroFilter;

  constructor(private readonly cfg: TrackingConfig) {
    this.reset();
  }

  get progress(): number {
    if (this.state === 'tracking') return 1;
    return this.state === 'calibrating' ? this.calibrator.progress : 0;
  }

  /** Recalibrate from scratch. */
  reset(): void {
    this.state = 'waiting';
    this.calibration = null;
    this.calibrator = this.newCalibrator();
    this.loseTrack();
  }

  /** Feed one frame (pose null = nobody detected). Returns a result only while tracking. */
  update(tMs: number, pose: PoseFrame | null): FrameResult | null {
    const sm = this.cfg.smoothing;
    if (!pose) {
      if (this.lastSeen !== null && tMs - this.lastSeen > 1000 * sm.reset_after_s) {
        this.loseTrack();
        if (this.state === 'calibrating') {
          this.state = 'waiting';
          this.calibrator = this.newCalibrator();
        }
      }
      return this.state === 'tracking' ? { tMs, detected: false, scores: null, observed: null, level: null } : null;
    }

    this.lastSeen = tMs;
    const tS = tMs / 1000;
    const visible = visibleMask(pose, this.cfg.pose.visibility_threshold);
    let norm = normalize(pose.world), image = pose.image;
    if (sm.enabled) {
      norm = unflatten(this.worldFilter.filter(flatten(norm), tS));
      image = unflatten(this.imageFilter.filter(flatten(image), tS));
    }
    const angles = jointAngles(norm);

    let scores: Record<Segment, number> | null = null, observed: Record<Segment, boolean> | null = null;
    const prev = this.prev;
    if (prev) {
      const dt = (tMs - prev.tMs) / 1000;
      if (dt > 0 && dt <= this.cfg.features.max_dt_s) {
        const both = visible.map((v, i) => v && prev.visible[i]);
        ({ scores, observed } = segmentActivity(prev.norm, norm, prev.angles, angles, dt, both, this.cfg.features.weights, this.calibration?.noiseFloor ?? null));
      }
    }
    this.prev = { tMs, norm, angles, visible };

    if (this.state === 'waiting') this.state = 'calibrating';
    if (this.state === 'calibrating') {
      this.calibrator.add(pose, scores);
      if (this.calibrator.done) {
        this.calibration = this.calibrator.result();
        this.state = 'tracking';
      }
      return null;
    }
    const lvl = level(image, visible, this.calibration?.levelRef ?? null, this.cfg.features.level_thresholds);
    return { tMs, detected: true, scores, observed, level: lvl };
  }

  private newCalibrator(): Calibrator {
    const c = this.cfg.calibration;
    return new Calibrator({ durationS: c.duration_s, noiseFloorMultiplier: c.noise_floor_multiplier, maxNoiseFloor: c.max_noise_floor, visibilityThreshold: this.cfg.pose.visibility_threshold });
  }

  private loseTrack(): void {
    const sm = this.cfg.smoothing;
    this.prev = null;
    this.lastSeen = null;
    this.worldFilter = new OneEuroFilter(sm.min_cutoff, sm.beta, sm.d_cutoff);
    this.imageFilter = new OneEuroFilter(sm.min_cutoff, sm.beta, sm.d_cutoff);
  }
}
```

- [ ] **Step 5: 통과 확인**

Run: `npm run test:tracking`
Expected: `PASS: basics`, `PASS: features`, `PASS: tracker`

- [ ] **Step 6: 커밋**

```powershell
npm run lint; npm run typecheck
git add src/tracking scripts/tracking
git commit -m "Add calibration and the body tracker" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 집계 창 — 곡의 8카운트, 최근, 세션

**Files:**
- Create: `app/src/tracking/windows.ts`, `app/src/tracking/usage.ts`
- Test: `app/scripts/tracking/usage.test.cjs`

**Interfaces:**
- Consumes: Task 3 (`types`, `segments`, `math`)
- Produces (windows.ts): `Eight {index, start, end}`(초, `analysis.eights`와 같은 모양), `EightPlan = {kind:'rolling', ms} | {kind:'eights', eights} | {kind:'grid', seconds, source:'tempo'|'fixed'}`, `INTRO = -1`, `eightKey(plan, musicT): number | null`, `countInEight(plan, musicT): number | null`(1–8), `planFor(eights, tempo, fixedSeconds): EightPlan`
- Produces (usage.ts): `emptyTotals()`, `addToTotals(t, r)`, `mergeTotals(a, b)`, `ShareOptions`, `Shares`, `snapshotFromTotals(totals, opts): Shares`(반올림 전 값), `AccumulatorOptions`, `class UsageAccumulator(opts, plan) { currentEightKey; reset(); setPlan(plan); add(r, activeMs, musicT?); snapshot(window, {activeMs, tMs}, stampMs?): UsageMessage; exportTotals(); importTotals(t) }`
- 시계 두 개: `activeMs`는 집계할 때만 흐르는 시계(`recent`·`rolling` 창), `tMs`는 카메라 시계(`tracking_ok`). id403과 같은 조건(항상 재생 중)에서는 둘의 차이가 상수라서 결과가 같다.
- 스펙과 다른 점: 화면의 "3 / 8" 박 번호는 8카운트 구간(`start`–`end`)을 8등분해서 계산한다. 스펙 §3은 성원의 `lastIndexAtOrBefore(analysis.beats, …)` 방식을 적었지만, 템포가 일정한 곡에서는 결과가 같고 BPM·4초 대체 계획에도 같은 함수를 쓸 수 있어서 이렇게 한다. 실기기에서 어긋나 보이면 beats 방식으로 바꾼다.

- [ ] **Step 1: 실패하는 테스트 작성** — `app/scripts/tracking/usage.test.cjs` (id403 `test_usage.py` + 새 동작)

```js
const assert = require('node:assert/strict');
const load = require('../load-ts.cjs');
const { UsageAccumulator, emptyTotals, snapshotFromTotals } = load('src/tracking/usage.ts');
const { planFor, eightKey, countInEight, INTRO } = load('src/tracking/windows.ts');
const { SEGMENT_NAMES } = load('src/tracking/segments.ts');
const { close } = require('./helpers.cjs');

const DT = 100;
const OPTS = { recentMs: 30000, underusedRatio: 0.5, minObservedRatio: 0.5, idleActivity: 0.05, trackingWindowMs: 1000, trackingMinRate: 0.6, backJumpS: 0.2 };
const acc = (plan = { kind: 'rolling', ms: 4000 }) => new UsageAccumulator(OPTS, plan);
function sample(tMs, { level = 'mid', unobserved = [], ...scores } = {}) {
  return {
    tMs, detected: true, level,
    scores: Object.fromEntries(SEGMENT_NAMES.map(s => [s, scores[s] ?? 0])),
    observed: Object.fromEntries(SEGMENT_NAMES.map(s => [s, !unobserved.includes(s)])),
  };
}
// id403-style feeding: the active clock equals the camera clock, no music.
function feed(a, t0, n, kw = {}) {
  for (let i = 0; i < n; i++) { const t = t0 + i * DT; a.add(sample(t, kw), t); }
  return t0 + n * DT;
}
const snap = (a, w, t, stamp) => a.snapshot(w, { activeMs: t, tMs: t }, stamp);

// --- id403 behaviour (rolling 4 s 8count)
{
  const a = acc(), t = feed(a, 0, 20, { arm_l: 1, arm_r: 1 }), m = snap(a, '8count', t);
  assert.equal(m.window, '8count');
  close(m.segments.arm_l, 0.5);
  close(m.segments.arm_r, 0.5);
}
{
  const a = acc();
  let t = feed(a, 0, 50, { leg_l: 1 });
  t = feed(a, t, 50, { arm_l: 1 });
  assert.equal(snap(a, '8count', t).segments.leg_l, 0, 'short window forgets old motion');
  close(snap(a, 'recent', t).segments.leg_l, 0.5);
  close(snap(a, 'session', t).segments.leg_l, 0.5);
}
{
  const a = acc();
  let t = feed(a, 0, 50, { leg_l: 1 });
  t = feed(a, t, 350, { arm_l: 1 }); // 35 s later
  assert.equal(snap(a, 'recent', t).segments.leg_l, 0);
  assert.ok(snap(a, 'session', t).segments.leg_l > 0);
}
{
  const a = acc(), m = snap(a, '8count', feed(a, 0, 20, { arm_l: 1, arm_r: 1, unobserved: ['leg_l'] }));
  assert.ok(!m.underused.includes('leg_l'), 'occluded part is not underused');
  assert.ok(m.underused.includes('leg_r'));
}
{
  const a = acc();
  let t = 0;
  for (let i = 0; i < 20; i++, t += DT) a.add(sample(t, { arm_l: 1, leg_l: 1, unobserved: i % 2 ? ['leg_l'] : [] }), t);
  const m = snap(a, '8count', t);
  close(m.segments.leg_l, m.segments.arm_l, 1e-9, 'occlusion does not dilute activity');
}
{
  const a = acc(), t = feed(a, 0, 20, { head: 1, torso: 1, arm_l: 1, arm_r: 1, leg_l: 0.4, leg_r: 0.6 });
  assert.deepEqual(snap(a, '8count', t).underused, ['leg_l'], '0.4/5 < 0.5/6 but 0.6/5 is not');
}
{
  const a = acc(), m = snap(a, '8count', feed(a, 0, 20, { arm_l: 0.01 }));
  SEGMENT_NAMES.forEach(s => assert.equal(m.segments[s], 0));
  assert.deepEqual(m.underused, [], 'idle body: nothing is underused');
}
{
  const a = acc();
  let t = feed(a, 0, 30, { level: 'mid', arm_l: 1 });
  t = feed(a, t, 10, { level: 'low', arm_l: 1 });
  const m = snap(a, '8count', t - DT);
  close(m.level.mid, 0.75);
  close(m.level.low, 0.25);
  assert.equal(m.level.high, 0);
  assert.equal(m.current_level, 'low');
}
{
  const a = acc(), t = feed(a, 0, 20, { arm_l: 1 });
  assert.equal(snap(a, '8count', t).tracking_ok, true);
  for (let i = 0; i < 8; i++) a.add({ tMs: t + i * DT, detected: false, scores: null, observed: null, level: null }, t + i * DT);
  assert.equal(snap(a, '8count', t + 8 * DT).tracking_ok, false);
}
{
  const a = acc();
  let t = feed(a, 0, 20, { arm_l: 1 });
  a.reset();
  t = feed(a, t, 20, { leg_r: 1 });
  assert.equal(snap(a, 'session', t).segments.arm_l, 0);
}
{
  const a = acc();
  assert.equal(snap(a, 'recent', feed(a, 0, 5, { arm_l: 1 }), 1_700_000_000_000).t, 1_700_000_000_000);
}

// --- window plans
{
  const p = planFor([{ index: 1, start: 4, end: 8 }, { index: 0, start: 0.5, end: 4 }], 120, 4);
  assert.equal(p.kind, 'eights');
  assert.deepEqual(p.eights.map(e => e.index), [0, 1], 'sorted by start');
  assert.equal(eightKey(p, 0.2), INTRO);
  assert.equal(eightKey(p, 0.5), 0);
  assert.equal(eightKey(p, 5), 1);
  assert.equal(eightKey(p, 99), 1, 'after the last eight: still the last one');
  assert.equal(countInEight(p, 0.2), null);
  assert.equal(countInEight(p, 0.5), 1);
  assert.equal(countInEight(p, 3.99), 8);
  assert.equal(countInEight(p, 6), 5);
  assert.deepEqual(planFor([], 120, 4), { kind: 'grid', seconds: 4, source: 'tempo' });
  assert.deepEqual(planFor(undefined, undefined, 4), { kind: 'grid', seconds: 4, source: 'fixed' });
  assert.deepEqual(planFor(null, 1000, 4), { kind: 'grid', seconds: 4, source: 'fixed' }, 'implausible BPM falls back');
  const g = planFor(null, 100, 4);
  close(g.seconds, 4.8);
  assert.equal(eightKey(g, 9.7), 2);
  assert.equal(countInEight(g, 5.41), 2);
  assert.equal(eightKey({ kind: 'rolling', ms: 4000 }, 3), null);
}

// --- 8count follows the song
{
  const a = acc(planFor([{ index: 0, start: 0, end: 4 }, { index: 1, start: 4, end: 8 }], null, 4));
  let t = 0;
  for (; t < 4000; t += DT) a.add(sample(t, { leg_l: 1 }), t, t / 1000);
  for (; t < 6000; t += DT) a.add(sample(t, { arm_l: 1 }), t, t / 1000);
  const m = snap(a, '8count', t);
  assert.equal(m.segments.leg_l, 0, 'only the current eight of the song');
  close(m.segments.arm_l, 1);
  assert.equal(a.currentEightKey, 1);
  close(snap(a, 'session', t).segments.leg_l, 0.5);
}
{
  // loop back: looping one eight (or seeking back) starts a new 8count window with the same index
  const a = acc(planFor([{ index: 0, start: 0, end: 4 }], null, 4));
  let t = 0;
  for (let i = 0; i < 35; i++, t += DT) a.add(sample(t, { leg_l: 1 }), t, i / 10);
  for (let i = 0; i < 10; i++, t += DT) a.add(sample(t, { arm_l: 1 }), t, i / 10);
  const m = snap(a, '8count', t);
  assert.equal(m.segments.leg_l, 0);
  close(m.segments.arm_l, 1);
}
{
  // song end wraps to 0 (StemPlayer onEnded): new window, the session keeps both
  const a = acc(planFor(null, 120, 4));
  let t = 0;
  for (let i = 0; i < 20; i++, t += DT) a.add(sample(t, { leg_l: 1 }), t, 60 + i / 10);
  for (let i = 0; i < 10; i++, t += DT) a.add(sample(t, { arm_l: 1 }), t, i / 10);
  assert.equal(snap(a, '8count', t).segments.leg_l, 0);
  close(snap(a, 'session', t).segments.leg_l, 0.6667, 1e-9);
}

// --- saved totals and the paused clock
{
  const a = acc();
  feed(a, 0, 20, { arm_l: 1 });
  const saved = a.exportTotals();
  assert.deepEqual([saved.frames, saved.observed.arm_l, saved.levels.mid], [20, 20, 20]);
  const b = acc();
  b.importTotals(saved);
  const m = snap(b, 'session', feed(b, 0, 20, { leg_l: 1 }));
  close(m.segments.arm_l, 0.5);
  close(m.segments.leg_l, 0.5);
  assert.equal(b.exportTotals().frames, 40);
  assert.deepEqual(snapshotFromTotals(emptyTotals(), OPTS).underused, []);
}
{
  // paused: no frames are added and the active clock stands still
  const a = acc();
  feed(a, 0, 100, { arm_l: 1 }); // active 0..9.9 s
  const m = a.snapshot('recent', { activeMs: 10000, tMs: 70000 }); // a minute later on the camera clock
  close(m.segments.arm_l, 1);
  assert.equal(m.tracking_ok, false, 'nobody counted in the last second of camera time');
}
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test:tracking`
Expected: `usage.test.cjs`에서 FAIL (`ENOENT ... usage.ts`).

- [ ] **Step 3: `app/src/tracking/windows.ts` 작성**

```ts
// Which 8count window a frame belongs to. In the app the window follows the song: the server's
// analysis.eights, else a BPM grid, else fixed 4 s steps. `rolling` = id403's "last 4 s" (golden test).

export type Eight = { index: number; start: number; end: number }; // seconds, like analysis.eights
export type EightPlan =
  | { kind: 'rolling'; ms: number }
  | { kind: 'eights'; eights: Eight[] }
  | { kind: 'grid'; seconds: number; source: 'tempo' | 'fixed' };

export const INTRO = -1; // before the song's first eight

function eightAt(eights: Eight[], t: number): Eight | null {
  let lo = 0, hi = eights.length - 1, found: Eight | null = null;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (eights[m].start <= t) { found = eights[m]; lo = m + 1; } else hi = m - 1;
  }
  return found;
}

const clampCount = (n: number) => Math.min(8, Math.max(1, n));

/** Key of the 8count window for a song position (null for rolling windows). */
export function eightKey(plan: EightPlan, musicT: number): number | null {
  if (plan.kind === 'rolling') return null;
  if (plan.kind === 'eights') return eightAt(plan.eights, musicT)?.index ?? INTRO;
  return Math.floor(Math.max(0, musicT) / plan.seconds);
}

/** Count 1..8 inside the current eight, or null (intro, rolling). */
export function countInEight(plan: EightPlan, musicT: number): number | null {
  if (plan.kind === 'rolling') return null;
  if (plan.kind === 'eights') {
    const e = eightAt(plan.eights, musicT);
    if (!e || e.end <= e.start) return null;
    return clampCount(Math.floor((musicT - e.start) / ((e.end - e.start) / 8)) + 1);
  }
  return clampCount(Math.floor((Math.max(0, musicT) % plan.seconds) / (plan.seconds / 8)) + 1);
}

/** The song's eights when the server analysed it, else 8 beats at its BPM, else fixed steps. */
export function planFor(eights: Eight[] | null | undefined, tempo: number | null | undefined, fixedSeconds: number): EightPlan {
  if (eights && eights.length) return { kind: 'eights', eights: [...eights].sort((a, b) => a.start - b.start) };
  if (typeof tempo === 'number' && Number.isFinite(tempo) && tempo >= 30 && tempo <= 300)
    return { kind: 'grid', seconds: (8 * 60) / tempo, source: 'tempo' };
  return { kind: 'grid', seconds: fixedSeconds, source: 'fixed' };
}
```

- [ ] **Step 4: `app/src/tracking/usage.ts` 작성**

```ts
// Usage windows: segment activity + level -> UsageMessage (id403 aggregate/usage.py).
// Windows: 8count (the song's current eight, or id403's rolling 4 s), recent (30 s of tracked time),
// session (everything, including totals restored from a saved session).
// A segment's activity is averaged over the frames where it was *observed*, so an occluded limb is
// neither diluted nor reported as unused (principle 4).
import { pyRound } from './math';
import { LEVELS, SEGMENT_NAMES, byLevel, bySegment } from './segments';
import { eightKey, type EightPlan } from './windows';
import type { FrameResult, Level, Segment, UsageMessage, UsageTotals, WindowName } from './types';

export const emptyTotals = (): UsageTotals => ({ frames: 0, score: bySegment(() => 0), observed: bySegment(() => 0), levels: byLevel(() => 0) });

export function addToTotals(t: UsageTotals, r: FrameResult): void {
  t.frames += 1;
  if (r.level) t.levels[r.level] += 1;
  if (!r.scores || !r.observed) return;
  for (const s of SEGMENT_NAMES) if (r.observed[s]) { t.observed[s] += 1; t.score[s] += r.scores[s] ?? 0; }
}

export const mergeTotals = (a: UsageTotals, b: UsageTotals): UsageTotals => ({
  frames: a.frames + b.frames,
  score: bySegment(s => a.score[s] + b.score[s]),
  observed: bySegment(s => a.observed[s] + b.observed[s]),
  levels: byLevel(l => a.levels[l] + b.levels[l]),
});

export type ShareOptions = { underusedRatio: number; minObservedRatio: number; idleActivity: number };
export type Shares = { segments: Record<Segment, number>; level: Record<Level, number>; underused: Segment[] };

/** Shares (unrounded) and underused parts. A part seen in fewer than min_observed_ratio of the frames is never underused. */
export function snapshotFromTotals(t: UsageTotals, o: ShareOptions): Shares {
  const rates = bySegment(s => (t.observed[s] ? t.score[s] / t.observed[s] : 0));
  const total = SEGMENT_NAMES.reduce((sum, s) => sum + rates[s], 0);
  let segments = bySegment(() => 0), underused: Segment[] = [];
  if (total >= o.idleActivity) {
    segments = bySegment(s => rates[s] / total);
    const limit = o.underusedRatio / SEGMENT_NAMES.length, minObs = o.minObservedRatio * t.frames;
    underused = SEGMENT_NAMES.filter(s => segments[s] < limit && t.observed[s] >= minObs);
  }
  const nLvl = LEVELS.reduce((sum, l) => sum + t.levels[l], 0);
  return { segments, level: byLevel(l => (nLvl ? t.levels[l] / nLvl : 0)), underused };
}

export type AccumulatorOptions = ShareOptions & { recentMs: number; trackingWindowMs: number; trackingMinRate: number; backJumpS: number };
type Sample = FrameResult & { activeMs: number };

export class UsageAccumulator {
  private samples: Sample[] = [];
  private session = emptyTotals();
  private base = emptyTotals(); // restored from a saved session
  private eight: { key: number | null; totals: UsageTotals } | null = null;
  private lastMusicT: number | null = null;

  constructor(private readonly o: AccumulatorOptions, private plan: EightPlan) {}

  get currentEightKey(): number | null {
    return this.eight?.key ?? null;
  }

  /** New session: forget everything, including restored totals. */
  reset(): void {
    this.samples = [];
    this.session = emptyTotals();
    this.base = emptyTotals();
    this.closeEight();
  }

  setPlan(plan: EightPlan): void {
    this.plan = plan;
    this.closeEight();
  }

  /** One tracked frame. activeMs = aggregation clock; musicT = song position (s) for song-aligned eights. */
  add(r: FrameResult, activeMs: number, musicT: number | null = null): void {
    this.samples.push({ ...r, activeMs });
    addToTotals(this.session, r);
    const keep = Math.max(this.o.recentMs, this.o.trackingWindowMs, this.plan.kind === 'rolling' ? this.plan.ms : 0);
    while (this.samples.length && this.samples[0].activeMs <= activeMs - keep) this.samples.shift();
    if (this.plan.kind !== 'rolling' && musicT !== null) {
      const key = eightKey(this.plan, musicT);
      const back = this.lastMusicT !== null && musicT < this.lastMusicT - this.o.backJumpS;
      if (!this.eight || this.eight.key !== key || back) this.eight = { key, totals: emptyTotals() };
      addToTotals(this.eight.totals, r);
      this.lastMusicT = musicT;
    }
  }

  snapshot(window: WindowName, now: { activeMs: number; tMs: number }, stampMs?: number): UsageMessage {
    const { segments, level, underused } = snapshotFromTotals(this.windowTotals(window, now.activeMs), this.o);
    const last = this.samples[this.samples.length - 1];
    return {
      t: stampMs ?? now.tMs,
      window,
      segments: bySegment(s => pyRound(segments[s], 4)),
      level: byLevel(l => pyRound(level[l], 4)),
      current_level: last ? last.level : null,
      underused,
      tracking_ok: this.trackingOk(now.tMs),
    };
  }

  exportTotals(): UsageTotals {
    return mergeTotals(this.base, this.session);
  }

  importTotals(t: UsageTotals): void {
    this.base = mergeTotals(emptyTotals(), t);
  }

  private closeEight(): void {
    this.eight = null;
    this.lastMusicT = null;
  }

  private windowTotals(window: WindowName, nowActiveMs: number): UsageTotals {
    if (window === 'session') return mergeTotals(this.base, this.session);
    if (window === '8count' && this.plan.kind !== 'rolling') return this.eight?.totals ?? emptyTotals();
    const span = window === 'recent' ? this.o.recentMs : this.plan.kind === 'rolling' ? this.plan.ms : 0;
    const t = emptyTotals();
    for (const s of this.samples) if (s.activeMs > nowActiveMs - span) addToTotals(t, s);
    return t;
  }

  /** Was the dancer detected steadily in the last tracking window of camera time? */
  private trackingOk(nowTMs: number): boolean {
    const recent = this.samples.filter(s => s.tMs > nowTMs - this.o.trackingWindowMs);
    if (!recent.length) return false;
    return recent.filter(s => s.detected).length / recent.length >= this.o.trackingMinRate;
  }
}
```

- [ ] **Step 5: 통과 확인**

Run: `npm run test:tracking`
Expected: `PASS:` basics, features, tracker, usage

- [ ] **Step 6: 커밋**

```powershell
npm run lint; npm run typecheck
git add src/tracking scripts/tracking
git commit -m "Add usage windows that follow the song's eights" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: 제안 문장과 제안 시점

**Files:**
- Create: `app/src/tracking/phrases.ts`, `app/src/tracking/feedback.ts`
- Test: `app/scripts/tracking/feedback.test.cjs`

**Interfaces:**
- Consumes: Task 3 (`types`, `segments`, `config.TrackingConfig['feedback']`)
- Produces (phrases.ts): `SEGMENT_LABELS`, `LEVEL_LABELS`, `label(target): string`, `class Phrasebook { text(kind, target) }`
- Produces (feedback.ts): `class FeedbackEngine(cfg: TrackingConfig['feedback']) { reset(); update(msg: UsageMessage, nowMs): FeedbackCue | null }`. `segment_targets`가 빈 배열이면 모든 부위가 대상이다.

- [ ] **Step 1: 실패하는 테스트 작성** — `app/scripts/tracking/feedback.test.cjs` (id403 `test_feedback.py`)

```js
const assert = require('node:assert/strict');
const load = require('../load-ts.cjs');
const { FeedbackEngine } = load('src/tracking/feedback.ts');
const { SEGMENT_NAMES } = load('src/tracking/segments.ts');

const CFG = {
  enabled: true, warmup_s: 15, persist_s: 6, global_cooldown_s: 12, target_cooldown_s: 45,
  explored_min_gap_s: 3, explored_watch_s: 60, level_min_share: 0.1, level_explored_share: 0.3,
  segment_explored_ratio: 1.0, segment_targets: [],
};
const EVEN = Object.fromEntries(SEGMENT_NAMES.map(s => [s, 1 / 6]));
const LEGS_STILL = { ...EVEN, leg_l: 0, leg_r: 0 };
const ALL_LEVELS = { low: 0.3, mid: 0.4, high: 0.3 };
const NO_LOW = { low: 0, mid: 0.8, high: 0.2 };
const usage = (window, { underused = [], segments = EVEN, level = ALL_LEVELS, tracking_ok = true } = {}) =>
  ({ t: 0, window, segments: { ...segments }, level: { ...level }, current_level: 'mid', underused: [...underused], tracking_ok });
/** scene(tS) -> [8count msg, recent msg]. Returns [[tS, cue]]. */
function run(engine, scene, untilS, stepMs = 100) {
  const cues = [];
  for (let t = 0; t <= untilS * 1000; t += stepMs)
    for (const msg of scene(t / 1000)) { const cue = engine.update(msg, t); if (cue) cues.push([t / 1000, cue]); }
  return cues;
}
const eng = (over = {}) => new FeedbackEngine({ ...CFG, ...over });
const legLQuiet = () => [usage('8count', { segments: LEGS_STILL }), usage('recent', { underused: ['leg_l'] })];
const times = cues => cues.map(([t]) => t);

assert.deepEqual(run(eng(), legLQuiet, 16).map(([t, c]) => [t, c.kind, c.target]), [[15, 'segment_unexplored', 'leg_l']], 'silent during warm-up');
assert.deepEqual(times(run(eng(), t => [usage('8count', { segments: LEGS_STILL }), usage('recent', { underused: t >= 20 ? ['leg_l'] : [] })], 30)), [26], 'condition must persist');
{
  const cues = run(eng(), () => [usage('8count', { segments: LEGS_STILL }), usage('recent', { underused: ['leg_l', 'leg_r'] })], 30);
  assert.deepEqual(times(cues), [15, 27], 'global cooldown');
  assert.deepEqual(new Set(cues.map(([, c]) => c.target)), new Set(['leg_l', 'leg_r']));
}
assert.deepEqual(times(run(eng(), legLQuiet, 70)), [15, 60], 'same part waits target cooldown');
assert.deepEqual(times(run(eng(), t => {
  const ok = !(t >= 10 && t < 12);
  return [usage('8count', { segments: LEGS_STILL, tracking_ok: ok }), usage('recent', { underused: ['leg_l'], tracking_ok: ok })];
}, 20)), [18], 'lost tracking silences and restarts persistence');
{
  const idle = Object.fromEntries(SEGMENT_NAMES.map(s => [s, 0]));
  assert.deepEqual(run(eng(), () => [usage('8count', { segments: idle }), usage('recent', { segments: idle, level: { low: 0 } })], 40), []);
}
assert.deepEqual(run(eng(), () => [usage('8count', { level: NO_LOW }), usage('recent', { level: NO_LOW })], 16).map(([, c]) => [c.kind, c.target]), [['level_unexplored', 'low']]);
assert.deepEqual(run(eng(), () => [usage('8count'), usage('recent', { level: { low: 0, mid: 0, high: 0 } })], 40), [], 'unjudged level is not unexplored');
assert.deepEqual(run(eng(), () => [usage('8count', { segments: LEGS_STILL, level: NO_LOW }), usage('recent', { underused: ['leg_l', 'leg_r'], level: NO_LOW })], 30).map(([t, c]) => [t, c.kind]),
  [[15, 'level_unexplored'], [27, 'segment_unexplored']], 'kinds alternate, level first');
assert.deepEqual(run(eng(), t => {
  const on = t >= 20;
  return [usage('8count', { segments: { ...EVEN, leg_l: on ? 0.2 : 0 } }), usage('recent', { underused: on ? [] : ['leg_l'] })];
}, 40).map(([t, c]) => [t, c.kind, c.target]), [[15, 'segment_unexplored', 'leg_l'], [20, 'explored', 'leg_l']]);
assert.deepEqual(run(eng(), t => {
  const on = t >= 16;
  return [usage('8count', { segments: { ...EVEN, leg_l: on ? 0.2 : 0 } }), usage('recent', { underused: on ? [] : ['leg_l'] })];
}, 25).map(([t, c]) => [t, c.kind]), [[15, 'segment_unexplored'], [18, 'explored']], 'explored waits a short gap');
assert.deepEqual(run(eng(), t => [usage('8count', { segments: { ...EVEN, leg_l: t >= 80 ? 0.2 : 0 } }), usage('recent', { underused: t < 16 ? ['leg_l'] : [] })], 90).map(([, c]) => c.kind),
  ['segment_unexplored'], 'explored after the watch window is not announced');
assert.deepEqual(run(eng(), t => {
  const on = t >= 20;
  return [usage('8count', { level: on ? { low: 0.5, mid: 0.5, high: 0 } : { low: 0, mid: 1, high: 0 } }), usage('recent', { level: on ? { low: 0.2, mid: 0.6, high: 0.2 } : { low: 0, mid: 0.8, high: 0.2 } })];
}, 30).map(([, c]) => [c.kind, c.target]), [['level_unexplored', 'low'], ['explored', 'low']]);
{
  const texts = run(eng(), legLQuiet, 70).map(([, c]) => c.text);
  assert.equal(texts.length, 2);
  assert.notEqual(texts[0], texts[1], 'texts rotate');
  assert.ok(texts.every(s => s.includes('왼다리')));
}
{
  const e = eng();
  assert.ok(run(e, legLQuiet, 16).length);
  e.reset();
  assert.equal(e.update(usage('recent', { underused: ['leg_l'] }), 100000), null, 'reset restarts warm-up');
}
assert.deepEqual(run(eng({ enabled: false }), legLQuiet, 40), []);
{
  const flat = { low: 0, mid: 1, high: 0 };
  const cues = run(eng(), () => [usage('8count', { segments: { ...EVEN, head: 0, leg_r: 0 }, level: flat }), usage('recent', { underused: ['head', 'leg_r'], level: flat })], 30);
  assert.deepEqual(cues.map(([, c]) => c.target), ['low', 'leg_r'], 'ties: low first, then limbs');
}
{
  const cues = run(eng({ segment_targets: ['arm_l', 'arm_r', 'leg_l', 'leg_r'] }), () => [usage('8count', { segments: { ...EVEN, head: 0, leg_l: 0 } }), usage('recent', { underused: ['head', 'leg_l'] })], 70);
  assert.deepEqual(new Set(cues.map(([, c]) => c.target)), new Set(['leg_l']), 'only configured parts');
}
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test:tracking`
Expected: `feedback.test.cjs`에서 FAIL (`ENOENT ... feedback.ts`).

- [ ] **Step 3: `app/src/tracking/phrases.ts` 작성**

```ts
// Korean cue phrases (id403 feedback/phrases.py): an observation + an open suggestion, never how to move.
// Comma phrasing avoids Korean particle agreement (이/가, 을/를) with the inserted label.
import type { CueKind, CueTarget, Segment } from './types';

export const SEGMENT_LABELS: Record<Segment, string> = { head: '머리', torso: '몸통', arm_l: '왼팔', arm_r: '오른팔', leg_l: '왼다리', leg_r: '오른다리' };
export const LEVEL_LABELS: Record<'low' | 'high', string> = { low: '낮은 높이', high: '높은 곳' };

const TEMPLATES: Record<string, string[]> = {
  segment_unexplored: ['{name}, 아직 조용해요. 한번 깨워볼까요?', '{name} 쪽은 아직 안 가봤어요. 한번 써볼까요?', '{name}, 이번 에잇에 한번 써볼까요?'],
  'level_unexplored:low': ['낮은 높이는 아직 안 가봤어요. 한번 내려가볼까요?', '바닥 가까이, 한번 가볼까요?'],
  'level_unexplored:high': ['높은 곳은 아직 비어 있어요. 한번 올라가볼까요?', '위쪽 공간, 한번 써볼까요?'],
  'explored:segment': ['{name}, 움직이기 시작했어요', '{name}, 새로 열렸어요'],
  'explored:low': ['낮은 높이, 가봤네요', '바닥 가까이, 다녀왔네요'],
  'explored:high': ['높은 곳, 가봤네요', '위쪽 공간, 열렸네요'],
};

export const label = (target: CueTarget): string =>
  target in SEGMENT_LABELS ? SEGMENT_LABELS[target as Segment] : LEVEL_LABELS[target as 'low' | 'high'] ?? target;

/** Rotates through the templates of each kind so repeated cues don't sound canned. */
export class Phrasebook {
  private next = new Map<string, number>();

  text(kind: CueKind, target: CueTarget): string {
    const key = kind === 'segment_unexplored' ? kind : kind === 'explored' && target in SEGMENT_LABELS ? 'explored:segment' : `${kind}:${target}`;
    const options = TEMPLATES[key], i = this.next.get(key) ?? 0;
    this.next.set(key, i + 1);
    return options[i % options.length].replace('{name}', label(target));
  }
}
```

- [ ] **Step 4: `app/src/tracking/feedback.ts` 작성**

```ts
// Decides *when* to say *what*: UsageMessage stream -> occasional FeedbackCue (id403 feedback/engine.py).
// Unexplored parts / levels are judged on the "recent" window and must hold for persist_s; "explored" is
// judged on the "8count" window so the dancer hears it within seconds. Warm-up, cooldowns and silence while
// tracking is lost or the body is idle keep it from nagging. Time comes only from nowMs.
import type { TrackingConfig } from './config';
import { Phrasebook } from './phrases';
import { SEGMENT_NAMES } from './segments';
import type { CueKind, CueTarget, FeedbackCue, Level, Segment, UsageMessage } from './types';

const SEGMENT = 'segment_unexplored', LEVEL = 'level_unexplored';
type Unexplored = typeof SEGMENT | typeof LEVEL;
const CUED_LEVELS = ['low', 'high'] as const; // mid is everyone's default; not suggested
// Tie-break when shares are equal: levels first (low before high), then limbs before head / torso.
const TIE_ORDER: CueTarget[] = ['low', 'high', 'leg_l', 'leg_r', 'arm_l', 'arm_r', 'torso', 'head'];

const keyOf = (kind: Unexplored, target: CueTarget) => `${kind}|${target}`;
const parse = (key: string) => {
  const [kind, target] = key.split('|');
  return { kind: kind as Unexplored, target: target as CueTarget };
};
const shareOf = (msg: UsageMessage, key: string) => {
  const { kind, target } = parse(key);
  return kind === SEGMENT ? msg.segments[target as Segment] ?? 0 : msg.level[target as Level] ?? 0;
};
const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);

export class FeedbackEngine {
  private start: number | null = null;
  private since = new Map<string, number>(); // unexplored condition -> first seen
  private lastCue: number | null = null;
  private lastKind: Unexplored | null = null; // for alternation
  private targetLast = new Map<CueTarget, number>();
  private watch = new Map<string, number>(); // cued condition -> cue time (insertion order matters)
  private phrases = new Phrasebook();
  private readonly segmentExploredShare: number;
  private readonly targets: Set<Segment>;

  constructor(private readonly cfg: TrackingConfig['feedback']) {
    this.segmentExploredShare = cfg.segment_explored_ratio / SEGMENT_NAMES.length;
    this.targets = new Set(cfg.segment_targets.length ? cfg.segment_targets : SEGMENT_NAMES);
  }

  reset(): void {
    this.start = null;
    this.since.clear();
    this.lastCue = null;
    this.lastKind = null;
    this.targetLast.clear();
    this.watch.clear();
    this.phrases = new Phrasebook();
  }

  update(msg: UsageMessage, nowMs: number): FeedbackCue | null {
    if (!this.cfg.enabled) return null;
    if (this.start === null) this.start = nowMs;
    if (msg.window === 'recent') return this.unexplored(msg, nowMs, this.start);
    if (msg.window === '8count') return this.explored(msg, nowMs);
    return null;
  }

  private unexplored(msg: UsageMessage, now: number, start: number): FeedbackCue | null {
    if (!msg.tracking_ok || sum(msg.segments) <= 0) {
      this.since.clear();
      return null;
    }
    const holding = msg.underused.filter(s => this.targets.has(s)).map(s => keyOf(SEGMENT, s));
    if (sum(msg.level) > 0) // level judged at all
      for (const lv of CUED_LEVELS) if ((msg.level[lv] ?? 0) < this.cfg.level_min_share) holding.push(keyOf(LEVEL, lv));
    this.since = new Map(holding.map(k => [k, this.since.get(k) ?? now]));

    const ms = (s: number) => 1000 * s;
    if (now - start < ms(this.cfg.warmup_s) || !this.gapOk(now, ms(this.cfg.global_cooldown_s))) return null;
    const targetCd = ms(this.cfg.target_cooldown_s);
    const ready = [...this.since]
      .filter(([k, t0]) => now - t0 >= ms(this.cfg.persist_s) && now - (this.targetLast.get(parse(k).target) ?? -targetCd) >= targetCd)
      .map(([k]) => k);
    if (!ready.length) return null;

    const prefer: Unexplored = this.lastKind === LEVEL ? SEGMENT : LEVEL; // alternate, level first
    const preferred = ready.filter(k => parse(k).kind === prefer);
    const group = preferred.length ? preferred : ready;
    const rank = (k: string): [number, number] => [shareOf(msg, k), TIE_ORDER.indexOf(parse(k).target)];
    const best = group.reduce((a, b) => {
      const [sa, ta] = rank(a), [sb, tb] = rank(b);
      return sb < sa || (sb === sa && tb < ta) ? b : a;
    });
    const { kind, target } = parse(best);
    this.lastKind = kind;
    this.targetLast.set(target, now);
    this.watch.set(best, now);
    this.since.delete(best);
    return this.emit(kind, target, now);
  }

  private explored(msg: UsageMessage, now: number): FeedbackCue | null {
    const watchMs = 1000 * this.cfg.explored_watch_s;
    this.watch = new Map([...this.watch].filter(([, t]) => now - t <= watchMs));
    if (!msg.tracking_ok || !this.gapOk(now, 1000 * this.cfg.explored_min_gap_s)) return null;
    for (const key of [...this.watch.keys()]) {
      const { kind, target } = parse(key);
      const reached = kind === SEGMENT
        ? (msg.segments[target as Segment] ?? 0) >= this.segmentExploredShare
        : (msg.level[target as Level] ?? 0) >= this.cfg.level_explored_share;
      if (reached) {
        this.watch.delete(key);
        return this.emit('explored', target, now);
      }
    }
    return null;
  }

  private gapOk(now: number, gapMs: number): boolean {
    return this.lastCue === null || now - this.lastCue >= gapMs;
  }

  private emit(kind: CueKind, target: CueTarget, now: number): FeedbackCue {
    this.lastCue = now;
    return { t: now, kind, target, text: this.phrases.text(kind, target) };
  }
}
```

- [ ] **Step 5: 통과 확인**

Run: `npm run test:tracking`
Expected: `PASS:` basics, feedback, features, tracker, usage

- [ ] **Step 6: 커밋**

```powershell
npm run lint; npm run typecheck
git add src/tracking scripts/tracking
git commit -m "Add the suggestion phrases and feedback engine" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: 파이프라인, 속도 측정, LiveSession

**Files:**
- Create: `app/src/tracking/pipeline.ts`, `app/src/tracking/perf.ts`, `app/src/tracking/session.ts`
- Test: `app/scripts/tracking/pipeline.test.cjs`, `app/scripts/tracking/perf.test.cjs`, `app/scripts/tracking/session.test.cjs`

**Interfaces:**
- Consumes: Task 3–7
- Produces (pipeline.ts): `WINDOWS`, `Tick {status, usage, cue}`, `tickMessages(tick): OutMessage[]`, `StepContext {playing, musicT}`, `ALWAYS_PLAYING`, `class LivePipeline(cfg, plan = rolling 8count_s) { tracker; accumulator; engine; activeMs; reset(); recalibrate(); setPlan(plan); step(tMs, pose, ctx = ALWAYS_PLAYING, stampMs?): Tick | null }`
- Produces (perf.ts): `class PerfMeter(windowS=5, model='', delegate='cpu', captureFrom='read') { model; delegate; captureFrom; add(tMs, detected, captureMs, pipelineMs, sourceFrames?); addError(tMs); reset(); snapshot(nowMs, stampMs): PerfMessage }`
- Produces (session.ts): `SessionOptions {model?, delegate?, captureFrom?, clockMs?, perfNowMs?, plan?}`, `FrameExtra {captureMs?, sourceFrames?}`, `poseMessage(pose, aspect, stampMs)`, `class LiveSession(cfg, publish?, opts?) { pipeline; perf; lastTick; lastCue; reset(); recalibrate(); setPlan(plan); setEngine(model, delegate); recordError(tMs); step(tMs, pose, aspect, ctx?, extra?): Tick | null; exportTracking(): SessionTracking; importTracking(s) }`
- id403과 다른 점 두 가지: `recalibrate()`는 트래커만 초기화하고 누적은 유지한다. `setEngine`으로 delegate가 바뀌면 새 세션(`reset`)이 아니라 `recalibrate()`를 한다(이 앱의 세션은 성원 세션 기록 단위라서). 클라이언트 명령(`poll`)은 없다.

- [ ] **Step 1: 실패하는 테스트 작성**

`app/scripts/tracking/pipeline.test.cjs` (id403 `test_pipeline.py` + 일시정지):
```js
const assert = require('node:assert/strict');
const load = require('../load-ts.cjs');
const { LivePipeline, tickMessages } = load('src/tracking/pipeline.ts');
const { withConfig } = load('src/tracking/config.ts');
const { S, standingImage, frame, rng, jitter } = require('./helpers.cjs');

const DT = 33, STAMP = 1_700_000_000_000;
const CFG = withConfig({ calibration: { duration_s: 1 } });
function armsOnly(i, r) {
  const img = jitter(standingImage(), r);
  for (const k of [S.L_ELBOW, S.L_WRIST, S.R_ELBOW, S.R_WRIST]) img[k][0] += 0.1 * Math.sin(i / 3);
  return img;
}
{
  const p = new LivePipeline(CFG), tick = p.step(0, null, undefined, STAMP);
  assert.deepEqual(tickMessages(tick).map(m => m.type), ['status']);
  assert.equal(tick.status.state, 'waiting');
  assert.equal(tick.status.t, STAMP);
  assert.equal(p.step(50, null, undefined, STAMP), null, '10 Hz: next tick at 100 ms');
  assert.notEqual(p.step(100, null, undefined, STAMP), null);
}
{
  const p = new LivePipeline(CFG);
  let tick = null;
  for (let t = 0; t <= 1500; t += DT) tick = p.step(t, frame(t), undefined, STAMP) ?? tick;
  assert.equal(tick.status.state, 'tracking');
  assert.equal(tick.status.progress, 1);
  assert.ok(tick.status.session_s > 0);
  assert.deepEqual(tickMessages(tick).filter(m => !('type' in m)).map(m => m.window), ['8count', 'recent', 'session']);
}
{
  const p = new LivePipeline(CFG);
  let t = 0;
  for (; t <= 1500; t += DT) p.step(t, frame(t), undefined, STAMP);
  p.reset();
  const tick = p.step(t + 200, null, undefined, STAMP);
  assert.equal(tick.status.state, 'waiting');
  assert.equal(tick.status.session_s, 0);
  assert.deepEqual(tick.usage, {});
}
{
  const r = rng(0), p = new LivePipeline(CFG), cues = [];
  for (let i = 0; i < Math.floor(45000 / DT); i++) {
    const t = i * DT, tick = p.step(t, frame(t, armsOnly(i, r)), undefined, STAMP);
    if (tick && tick.cue) cues.push(tick.cue);
  }
  assert.ok(cues.length, 'no cue in 45 s of arms-only dancing');
  assert.ok(cues.every(c => c.t === STAMP));
  assert.equal(cues[0].kind, 'level_unexplored', 'standing the whole time: low / high unexplored');
  const parts = cues.filter(c => c.kind === 'segment_unexplored').map(c => c.target);
  assert.ok(parts.length && parts.every(x => ['head', 'torso', 'leg_l', 'leg_r'].includes(x)));
}
{
  // paused: frames keep the tracker alive, but nothing is aggregated or suggested
  const r = rng(0), p = new LivePipeline(CFG), paused = { playing: false, musicT: 12 };
  let tick = null, cues = 0;
  for (let i = 0, t = 0; t <= 40000; i++, t += DT) {
    tick = p.step(t, frame(t, armsOnly(i, r)), paused, STAMP) ?? tick;
    if (tick && tick.cue) cues++;
  }
  assert.equal(tick.status.state, 'tracking', 'calibrates while paused');
  assert.equal(p.activeMs, 0);
  assert.equal(cues, 0);
  assert.equal(tick.usage.recent.tracking_ok, false);
  assert.equal(p.accumulator.exportTotals().frames, 0);
}
{
  // paused stretch: play -> pause -> play, the active clock skips the pause
  const p = new LivePipeline(CFG);
  let t = 0;
  for (; t <= 1500; t += DT) p.step(t, frame(t));
  const before = p.activeMs;
  for (let k = 0; k < 30; k++, t += DT) p.step(t, frame(t), { playing: false, musicT: 3 });
  p.step(t, frame(t));
  t += DT;
  p.step(t, frame(t));
  assert.equal(p.activeMs, before + DT, 'only the step after resuming counts');
}
```

`app/scripts/tracking/perf.test.cjs` (id403 `test_perf.py`):
```js
const assert = require('node:assert/strict');
const { PerfMeter } = require('../load-ts.cjs')('src/tracking/perf.ts');
const { close } = require('./helpers.cjs');

function feed(m, n, { dtMs = 40, detected = true, capture = 30, pipeline = 2, sourceStep = 1 } = {}) {
  for (let i = 0; i < n; i++) {
    const det = typeof detected === 'function' ? detected(i) : detected;
    const cap = typeof capture === 'function' ? capture(i) : capture;
    m.add(i * dtMs, det, cap, pipeline, sourceStep ? (i + 1) * sourceStep : null);
  }
}
{
  const m = new PerfMeter(5, 'lite', 'gpu', 'sensor');
  feed(m, 101); // 25 fps for 4 s
  const msg = m.snapshot(4000, 123);
  assert.equal(msg.type, 'perf');
  assert.equal(msg.t, 123);
  close(msg.pose_fps, 25);
  close(msg.source_fps, 25);
  assert.equal(msg.detect_rate, 1);
  assert.deepEqual(msg.lat_ms, { capture_pose: { p50: 30, p95: 30 }, pipeline: { p50: 2, p95: 2 } });
  assert.deepEqual([msg.model, msg.delegate, msg.capture_from, msg.errors], ['lite', 'gpu', 'sensor', 0]);
}
{
  const m = new PerfMeter();
  feed(m, 101, { sourceStep: 2 });
  const msg = m.snapshot(4000, 0);
  close(msg.pose_fps, 25);
  close(msg.source_fps, 50, 1e-9, 'camera fps counts source frames');
}
{
  const m = new PerfMeter();
  feed(m, 51, { sourceStep: null });
  close(m.snapshot(2000, 0).source_fps, 25);
}
{
  const m = new PerfMeter();
  feed(m, 10, { detected: i => i % 2 === 0, capture: i => 10 * (i + 1) });
  const msg = m.snapshot(400, 0);
  assert.equal(msg.detect_rate, 0.5);
  assert.deepEqual(msg.lat_ms.capture_pose, { p50: 55, p95: 95.5 });
}
{
  const m = new PerfMeter();
  feed(m, 5, { capture: null });
  assert.deepEqual(m.snapshot(200, 0).lat_ms.capture_pose, { p50: null, p95: null });
}
{
  const m = new PerfMeter(5);
  feed(m, 26);
  m.addError(500);
  assert.equal(m.snapshot(1000, 0).errors, 1);
  const msg = m.snapshot(9000, 0);
  assert.deepEqual([msg.pose_fps, msg.detect_rate, msg.errors], [0, 0, 0]);
}
{
  const m = new PerfMeter();
  feed(m, 10);
  m.addError(100);
  m.reset();
  const msg = m.snapshot(400, 0);
  assert.deepEqual([msg.pose_fps, msg.errors], [0, 0]);
}
```

`app/scripts/tracking/session.test.cjs` (id403 `test_session.py` + 저장값):
```js
const assert = require('node:assert/strict');
const load = require('../load-ts.cjs');
const { LiveSession } = load('src/tracking/session.ts');
const { withConfig } = load('src/tracking/config.ts');
const { frame } = require('./helpers.cjs');

const DT = 33, STAMP = 1_700_000_000_000;
const CFG = withConfig({ calibration: { duration_s: 1 } });
const make = (out, o = {}) => new LiveSession(CFG, m => out.push(m), { clockMs: () => STAMP, ...o });
const kinds = msgs => msgs.map(m => m.type ?? 'usage');
const last = (out, kind) => out.filter(m => m.type === kind).at(-1);
function run(s, untilMs) {
  let t = 0;
  for (; t <= untilMs; t += DT) s.step(t, frame(t), 0.75, undefined, { captureMs: 30, sourceFrames: Math.floor(t / DT) + 1 });
  return t;
}
{
  const out = [];
  make(out).step(0, frame(0), 0.75, undefined, { captureMs: 30, sourceFrames: 1 });
  assert.deepEqual(kinds(out), ['pose', 'status', 'perf']);
  assert.equal(out[0].aspect, 0.75);
  assert.equal(out[0].lm.length, 33);
  assert.ok(out.every(m => m.t === STAMP));
}
{
  const out = [];
  make(out).step(0, null, null);
  assert.deepEqual(kinds(out), ['status', 'perf'], 'no pose message without a person');
}
{
  const out = [], s = make(out);
  run(s, 3000);
  assert.equal(s.lastTick.status.state, 'tracking');
  assert.equal(kinds(out).filter(k => k === 'perf').length, 3, 'perf at t = 0, 1023, 2046');
  assert.deepEqual(new Set(out.filter(m => !m.type).map(m => m.window)), new Set(['8count', 'recent', 'session']));
  const perf = last(out, 'perf');
  assert.equal(perf.lat_ms.capture_pose.p50, 30);
  assert.ok(perf.pose_fps > 25);
}
{
  const out = [], s = make(out), t = run(s, 1500);
  s.reset();
  s.step(t + 200, null, null);
  assert.equal(last(out, 'status').state, 'waiting');
  assert.equal(s.lastCue, null);
}
{
  const s = make([]);
  run(s, 3000);
  const before = s.exportTracking();
  assert.ok(before.totals.frames > 0 && before.trackedMs > 0);
  s.recalibrate();
  assert.equal(s.pipeline.tracker.state, 'waiting');
  assert.deepEqual(s.exportTracking().totals, before.totals, 'recalibrating keeps the session totals');
}
{
  const out = [], s = make(out, { model: 'lite', delegate: 'gpu' }), t = run(s, 1500);
  s.setEngine('lite', 'gpu');
  assert.equal(s.pipeline.tracker.state, 'tracking', 'same engine: nothing changes');
  s.setEngine('lite', 'cpu');
  assert.equal(s.pipeline.tracker.state, 'waiting', 'a new delegate recalibrates');
  s.step(t + 2000, null, null);
  const perf = last(out, 'perf');
  assert.deepEqual([perf.model, perf.delegate], ['lite', 'cpu']);
}
assert.ok(new LiveSession(CFG).step(0, frame(0), 0.75), 'runs without a publisher');
{
  // a resumed practice session continues its totals
  const s = make([]);
  run(s, 3000);
  const saved = s.exportTracking();
  const s2 = make([]);
  s2.importTracking(saved);
  run(s2, 3000);
  const again = s2.exportTracking();
  assert.equal(again.totals.frames, 2 * saved.totals.frames);
  assert.equal(again.trackedMs, 2 * saved.trackedMs);
}
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test:tracking`
Expected: `perf.test.cjs`에서 FAIL (`ENOENT ... perf.ts`). 다른 두 파일도 같은 이유로 실패한다.

- [ ] **Step 3: `app/src/tracking/perf.ts` 작성**

```ts
// Loop speed meter -> perf message: fps, detection rate, latency percentiles (id403 perf.py).
// Time comes in as arguments (frame time tMs), so tests drive it without a clock.
import { percentile, pyRound } from './math';
import type { Percentiles, PerfMessage } from './types';

type Sample = { tMs: number; detected: boolean; captureMs: number | null; pipelineMs: number; sourceFrames: number | null };

const percentiles = (xs: number[]): Percentiles =>
  xs.length ? { p50: pyRound(percentile(xs, 50), 1), p95: pyRound(percentile(xs, 95), 1) } : { p50: null, p95: null };

export class PerfMeter {
  private samples: Sample[] = [];
  private errors: number[] = [];

  constructor(public windowS = 5.0, public model = '', public delegate = 'cpu', public captureFrom = 'read') {}

  /** One frame through the pipeline. sourceFrames = the camera's running frame counter. */
  add(tMs: number, detected: boolean, captureMs: number | null, pipelineMs: number, sourceFrames: number | null = null): void {
    this.samples.push({ tMs, detected, captureMs, pipelineMs, sourceFrames });
    this.trim(tMs);
  }

  /** A frame dropped because processing failed. */
  addError(tMs: number): void {
    this.errors.push(tMs);
    this.trim(tMs);
  }

  reset(): void {
    this.samples = [];
    this.errors = [];
  }

  snapshot(nowMs: number, stampMs: number): PerfMessage {
    this.trim(nowMs);
    const s = this.samples;
    let poseFps = 0, sourceFps = 0;
    const detectRate = s.length ? s.filter(x => x.detected).length / s.length : 0;
    if (s.length >= 2) {
      const spanS = (s[s.length - 1].tMs - s[0].tMs) / 1000;
      if (spanS > 0) {
        poseFps = (s.length - 1) / spanS;
        const first = s[0].sourceFrames, last = s[s.length - 1].sourceFrames;
        sourceFps = first !== null && last !== null ? (last - first) / spanS : poseFps;
      }
    }
    const captures = s.flatMap(x => (x.captureMs === null ? [] : [x.captureMs]));
    return {
      type: 'perf',
      t: stampMs,
      source_fps: pyRound(sourceFps, 1),
      pose_fps: pyRound(poseFps, 1),
      detect_rate: pyRound(detectRate, 3),
      lat_ms: { capture_pose: percentiles(captures), pipeline: percentiles(s.map(x => x.pipelineMs)) },
      capture_from: this.captureFrom,
      model: this.model,
      delegate: this.delegate,
      errors: this.errors.length,
    };
  }

  private trim(nowMs: number): void {
    const cut = nowMs - 1000 * this.windowS;
    while (this.samples.length && this.samples[0].tMs <= cut) this.samples.shift();
    while (this.errors.length && this.errors[0] <= cut) this.errors.shift();
  }
}
```

- [ ] **Step 4: `app/src/tracking/pipeline.ts` 작성**

```ts
// Live pipeline: PoseFrame stream -> status / usage / feedback (id403 pipeline.py).
//   tracker (smoothing, calibration, activity, level) -> accumulator (windows) -> feedback engine
// Aggregation and suggestions run only while the music plays (ctx.playing). The tracker keeps running,
// so the camera tab still shows the dancer and can calibrate while paused.
import type { TrackingConfig } from './config';
import { FeedbackEngine } from './feedback';
import { pyRound } from './math';
import { BodyTracker } from './tracker';
import { UsageAccumulator } from './usage';
import type { EightPlan } from './windows';
import type { FeedbackCue, OutMessage, PoseFrame, StatusMessage, UsageMessage, WindowName } from './types';

export const WINDOWS: WindowName[] = ['8count', 'recent', 'session'];
export type Tick = { status: StatusMessage; usage: Partial<Record<WindowName, UsageMessage>>; cue: FeedbackCue | null };
export type StepContext = { playing: boolean; musicT: number | null };
export const ALWAYS_PLAYING: StepContext = { playing: true, musicT: null };

/** In send order: status, usage windows, then the cue (if any). */
export function tickMessages(tick: Tick): OutMessage[] {
  const out: OutMessage[] = [tick.status];
  for (const w of WINDOWS) {
    const u = tick.usage[w];
    if (u) out.push(u);
  }
  if (tick.cue) out.push({ type: 'feedback', ...tick.cue });
  return out;
}

export class LivePipeline {
  readonly tracker: BodyTracker;
  readonly accumulator: UsageAccumulator;
  readonly engine: FeedbackEngine;
  private readonly publishMs: number;
  private nextPub: number | null = null;
  private sessionStart: number | null = null;
  private active = 0; // aggregation clock: advances only between frames aggregated back to back
  private lastAggT: number | null = null;

  constructor(cfg: TrackingConfig, plan: EightPlan = { kind: 'rolling', ms: 1000 * cfg.aggregate.windows['8count_s'] }) {
    const agg = cfg.aggregate;
    this.tracker = new BodyTracker(cfg);
    this.accumulator = new UsageAccumulator({
      recentMs: 1000 * agg.windows.recent_s,
      underusedRatio: agg.underused_ratio,
      minObservedRatio: agg.min_observed_ratio,
      idleActivity: agg.idle_activity,
      trackingWindowMs: 1000 * agg.tracking_window_s,
      trackingMinRate: agg.tracking_min_rate,
      backJumpS: cfg.app.back_jump_s,
    }, plan);
    this.engine = new FeedbackEngine(cfg.feedback);
    this.publishMs = 1000 / agg.publish_hz;
  }

  get activeMs(): number {
    return this.active;
  }

  /** New session: recalibrate, forget usage, restart the feedback warm-up. */
  reset(): void {
    this.tracker.reset();
    this.accumulator.reset();
    this.engine.reset();
    this.sessionStart = null;
    this.active = 0;
    this.lastAggT = null;
  }

  /** Recalibrate only; the session's usage stays. */
  recalibrate(): void {
    this.tracker.reset();
    this.lastAggT = null;
  }

  setPlan(plan: EightPlan): void {
    this.accumulator.setPlan(plan);
  }

  step(tMs: number, pose: PoseFrame | null, ctx: StepContext = ALWAYS_PLAYING, stampMs?: number): Tick | null {
    const res = this.tracker.update(tMs, pose);
    if (res && ctx.playing) {
      if (this.sessionStart === null) this.sessionStart = tMs;
      if (this.lastAggT !== null) this.active += tMs - this.lastAggT;
      this.lastAggT = tMs;
      this.accumulator.add(res, this.active, ctx.musicT);
    } else {
      this.lastAggT = null; // a pause (or no tracking) does not count as tracked time
    }

    if (this.nextPub !== null && tMs < this.nextPub) return null;
    this.nextPub = tMs + this.publishMs;
    const stamp = stampMs ?? Date.now();
    const tracking = this.tracker.state === 'tracking', start = this.sessionStart;
    const status: StatusMessage = {
      type: 'status',
      t: stamp,
      state: this.tracker.state,
      progress: pyRound(this.tracker.progress, 3),
      session_s: pyRound(tracking && start !== null ? (tMs - start) / 1000 : 0, 1),
    };
    const tick: Tick = { status, usage: {}, cue: null };
    if (tracking)
      for (const w of WINDOWS) {
        const msg = this.accumulator.snapshot(w, { activeMs: this.active, tMs }, stamp);
        tick.usage[w] = msg;
        if (!ctx.playing) continue;
        const cue = this.engine.update(msg, tMs);
        if (cue && !tick.cue) tick.cue = { ...cue, t: stamp };
      }
    return tick;
  }
}
```

- [ ] **Step 5: `app/src/tracking/session.ts` 작성**

```ts
// One live session: frame in -> every outgoing message (id403 session.py, without client commands).
//   pose message -> LivePipeline (status / usage / feedback) -> perf (1 Hz)
// The app keeps one per practice session; exportTracking() is what gets saved with it.
import type { TrackingConfig } from './config';
import { pyRound } from './math';
import { PerfMeter } from './perf';
import { ALWAYS_PLAYING, LivePipeline, tickMessages, type StepContext, type Tick } from './pipeline';
import type { EightPlan } from './windows';
import type { FeedbackCue, OutMessage, PoseFrame, PoseMessage, SessionTracking } from './types';

export type SessionOptions = {
  model?: string;
  delegate?: string;
  captureFrom?: string;
  clockMs?: () => number; // message timestamps (epoch ms)
  perfNowMs?: () => number; // pipeline step timing (performance.now in the app)
  plan?: EightPlan;
};
export type FrameExtra = { captureMs?: number | null; sourceFrames?: number | null };

/** Landmarks for drawing. Never video (principle 3). */
export const poseMessage = (pose: PoseFrame, aspect: number, stampMs: number): PoseMessage => ({
  type: 'pose',
  t: stampMs,
  aspect: pyRound(aspect, 3),
  lm: pose.image.map((p, i) => [pyRound(p[0], 3), pyRound(p[1], 3), pyRound(pose.visibility[i], 3)]),
});

export class LiveSession {
  readonly pipeline: LivePipeline;
  readonly perf: PerfMeter;
  lastTick: Tick | null = null;
  lastCue: FeedbackCue | null = null;
  private readonly perfEveryMs: number;
  private nextPerf: number | null = null;
  private trackedBase = 0;
  private readonly clock: () => number;
  private readonly perfNow: () => number;

  constructor(cfg: TrackingConfig, private readonly publish: (m: OutMessage) => void = () => {}, o: SessionOptions = {}) {
    this.pipeline = new LivePipeline(cfg, o.plan);
    this.perf = new PerfMeter(cfg.perf.window_s, o.model ?? '', o.delegate ?? 'cpu', o.captureFrom ?? 'analyzer');
    this.perfEveryMs = 1000 / cfg.perf.publish_hz;
    this.clock = o.clockMs ?? (() => Date.now());
    this.perfNow = o.perfNowMs ?? (() => Date.now());
  }

  /** New session: recalibrate and forget usage, including imported totals. */
  reset(): void {
    this.pipeline.reset();
    this.lastTick = this.lastCue = null;
    this.trackedBase = 0;
  }

  /** Measure the standing pose again; the session's totals stay. */
  recalibrate(): void {
    this.pipeline.recalibrate();
  }

  setPlan(plan: EightPlan): void {
    this.pipeline.setPlan(plan);
  }

  /** Model / delegate changed (GPU fallback): relabel perf and recalibrate, since tracking changes with it. */
  setEngine(model: string, delegate: string): void {
    if (model === this.perf.model && delegate === this.perf.delegate) return;
    this.perf.model = model;
    this.perf.delegate = delegate;
    this.perf.reset();
    this.recalibrate();
  }

  recordError(tMs: number): void {
    this.perf.addError(tMs);
  }

  /** Feed one frame (pose null = nobody detected). aspect = frame width / height. */
  step(tMs: number, pose: PoseFrame | null, aspect: number | null, ctx: StepContext = ALWAYS_PLAYING, extra: FrameExtra = {}): Tick | null {
    const stamp = this.clock();
    if (pose && aspect) this.publish(poseMessage(pose, aspect, stamp));
    const t0 = this.perfNow();
    const tick = this.pipeline.step(tMs, pose, ctx, stamp);
    this.perf.add(tMs, pose !== null, extra.captureMs ?? null, this.perfNow() - t0, extra.sourceFrames ?? null);
    if (tick) {
      this.lastTick = tick;
      if (tick.cue) this.lastCue = tick.cue;
      for (const m of tickMessages(tick)) this.publish(m);
    }
    if (this.nextPerf === null || tMs >= this.nextPerf) {
      this.nextPerf = tMs + this.perfEveryMs;
      this.publish(this.perf.snapshot(tMs, stamp));
    }
    return tick;
  }

  /** What gets saved with the practice session: tracked time and running sums, never landmarks. */
  exportTracking(): SessionTracking {
    return { version: 1, trackedMs: Math.round(this.trackedBase + this.pipeline.activeMs), totals: this.pipeline.accumulator.exportTotals() };
  }

  /** Continue a saved session's totals (resume). Call before the first frame. */
  importTracking(saved: SessionTracking): void {
    this.pipeline.accumulator.importTotals(saved.totals);
    this.trackedBase = saved.trackedMs;
  }
}
```

- [ ] **Step 6: 통과 확인**

Run: `npm run test:tracking`
Expected: `PASS:` basics, feedback, features, perf, pipeline, session, tracker, usage

- [ ] **Step 7: 커밋**

```powershell
npm run lint; npm run typecheck
git add src/tracking scripts/tracking
git commit -m "Add the live pipeline, perf meter and session" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: id403 정답 데이터와 비교

**Files:**
- Test: `app/scripts/tracking/golden.test.cjs`
- 사용: `app/scripts/fixtures/tracking/*.json.gz` (Task 2)

**Interfaces:**
- Consumes: `LivePipeline`(기본 `rolling` 4 s 계획, `ALWAYS_PLAYING`), `tickMessages`, `DEFAULT_CONFIG`
- Produces: 없음(검증만). 이 테스트가 통과해야 PR 2를 연다.

- [ ] **Step 1: 테스트 작성** — `app/scripts/tracking/golden.test.cjs`

```js
// Parity with the id403 Python pipeline: same frames in -> same tracker results and messages out.
// Fixtures: scripts/fixtures/tracking/*.json.gz, made by id403 tools/export_golden.py (synthetic poses only).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const load = require('../load-ts.cjs');
const { LivePipeline, tickMessages } = load('src/tracking/pipeline.ts');
const { DEFAULT_CONFIG } = load('src/tracking/config.ts');

const dir = path.join(__dirname, '..', 'fixtures', 'tracking');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json.gz')).sort();
assert.equal(files.length, 8, `expected 8 fixtures in ${dir}`);

// Message numbers are rounded on both sides (Python round() vs pyRound): allow one unit in the last place.
// Everything else (tracker scores) must agree to 1e-6 relative.
const TOL = { segments: 1.5e-4, level: 1.5e-4, progress: 1.5e-3, session_s: 0.15 };
function compare(actual, expected, where, key = '') {
  if (typeof expected === 'number') {
    assert.equal(typeof actual, 'number', `${where}: expected a number, got ${JSON.stringify(actual)}`);
    const tol = TOL[key] ?? Math.max(1e-9, 1e-6 * Math.abs(expected));
    assert.ok(Math.abs(actual - expected) <= tol, `${where}: ${actual} vs python ${expected}`);
  } else if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual) && actual.length === expected.length, `${where}: ${JSON.stringify(actual)} vs python ${JSON.stringify(expected)}`);
    expected.forEach((e, i) => compare(actual[i], e, `${where}[${i}]`, key));
  } else if (expected !== null && typeof expected === 'object') {
    assert.ok(actual !== null && typeof actual === 'object', `${where}: got ${JSON.stringify(actual)}`);
    assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), `${where}: keys`);
    for (const k of Object.keys(expected)) compare(actual[k], expected[k], `${where}.${k}`, k in TOL ? k : key);
  } else {
    assert.equal(actual, expected, where);
  }
}
const toPython = r => r && { t_ms: r.tMs, detected: r.detected, scores: r.scores, observed: r.observed, level: r.level };

for (const file of files) {
  const fx = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, file))).toString('utf8'));
  for (const [section, values] of Object.entries(DEFAULT_CONFIG)) {
    if (section === 'app') continue;
    for (const [k, v] of Object.entries(values))
      assert.deepEqual(v, fx.config[section][k], `${fx.name}: config ${section}.${k} differs from id403 default.yaml`);
  }
  const p = new LivePipeline(DEFAULT_CONFIG);
  const update = p.tracker.update.bind(p.tracker);
  let result = null;
  p.tracker.update = (t, pose) => (result = update(t, pose));
  fx.frames.forEach((f, i) => {
    const pose = f.image ? { tMs: f.t_ms, image: f.image, world: f.world, visibility: f.visibility } : null;
    const tick = p.step(f.t_ms, pose, undefined, f.t_ms);
    const where = `${fx.name} frame ${i} (t=${f.t_ms} ms)`;
    compare(toPython(result), fx.expected[i].result, `${where} result`);
    compare(tick && tickMessages(tick), fx.expected[i].messages, `${where} messages`);
  });
}
```

- [ ] **Step 2: 실행**

Run: `npm run test:tracking`
Expected: `PASS: golden.test.cjs` 포함 전부 통과.

실패하면 메시지에 첫 번째로 어긋난 프레임과 필드가 나온다. 이때 할 일:
1. 어긋난 값이 tracker `result.scores`면 같은 프레임의 Python 계산을 id403에서 다시 찍어 보고(`tools/export_golden.py`의 `run`에 print 추가, 커밋하지 않음), 연산 순서가 다른 TS 함수를 고친다.
2. `underused`·`current_level`·제안 같은 이산 값만 다르고 바로 앞의 숫자가 경계값에 아주 가까우면(차이 < 1e-9), 그 시나리오와 프레임을 태양에게 보고한다. 허용 오차를 혼자 늘리지 않는다.
3. 설정 검사가 실패하면 `config.ts`를 id403 `config/default.yaml`에 맞춘다(반대로 고치지 않는다).

- [ ] **Step 3: 커밋 (PR 2 지점)**

```powershell
npm run lint; npm run typecheck
git add scripts/tracking/golden.test.cjs
git commit -m "Check the TypeScript tracking against id403 golden fixtures" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
여기까지가 PR 2다. push·PR은 태양이 승인할 때만 한다.

---

### Task 10: `pose-camera` Expo 모듈 (Kotlin)

**Files:**
- Create: `app/modules/pose-camera/expo-module.config.json`
- Create: `app/modules/pose-camera/index.ts`
- Create: `app/modules/pose-camera/android/build.gradle`
- Create: `app/modules/pose-camera/android/src/main/AndroidManifest.xml`
- Create: `app/modules/pose-camera/android/src/main/java/expo/modules/posecamera/{FrameSource,FrontCameraSource,PoseEngine,PoseCameraView,PoseCameraModule}.kt`
- Create: `app/scripts/download-models.cjs`
- Modify: `app/package.json` (`"models"` 스크립트), `app/.gitignore` (모델 폴더)

**Interfaces:**
- Consumes: `PoseEvent` 타입(Task 3 `src/tracking/types.ts`), `detectorJson()`(Task 3)
- Produces: `import PoseCameraView from '../../../modules/pose-camera'` — Android에서는 컴포넌트, 그 밖에서는 `null`. props `{active: boolean; model: 'lite'; detectorJson: string; onPose?(e: {nativeEvent: PoseEvent}); onEngine?(e: {nativeEvent: {model, delegate}}); onError?(e: {nativeEvent: {message}})} & ViewProps`
- id403 `android/app/src/main/java/com/id403/lighttrace/{camera,pose}/`를 옮긴다. 바뀌는 점: 패키지명, 미리보기(Preview) use case 추가, `unbindAll()` 대신 자기 use case만 unbind, 모델은 assets를 직접 버퍼로 읽음(APK 압축 여부와 무관), 결과는 Expo 이벤트로 보냄.

- [ ] **Step 1: 모델 다운로드 스크립트와 git 제외**

`app/scripts/download-models.cjs`:
```js
// Downloads the MediaPipe pose model into the pose-camera module's assets (git-ignored, public repo).
const fs = require('node:fs');
const path = require('node:path');
const URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task';
const dest = path.join(__dirname, '..', 'modules', 'pose-camera', 'android', 'src', 'main', 'assets', 'models', 'pose_landmarker_lite.task');

(async () => {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return console.log(`[skip] ${path.relative(process.cwd(), dest)}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`${URL}: HTTP ${res.status}`);
  const tmp = `${dest}.part`;
  fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
  fs.renameSync(tmp, dest);
  console.log(`[ok] ${path.relative(process.cwd(), dest)} (${fs.statSync(dest).size} bytes)`);
})().catch(e => { console.error(e.message); process.exit(1); });
```

`app/package.json`의 `scripts`에 추가: `"models": "node scripts/download-models.cjs",`

`app/.gitignore` 끝에 추가:
```
# MediaPipe models (downloaded by `npm run models`)
/modules/pose-camera/android/src/main/assets/models/
```

Run: `npm run models`
Expected: `[ok] modules\pose-camera\android\src\main\assets\models\pose_landmarker_lite.task (약 5.5 MB)`. `git status`에 모델 파일이 나오지 않아야 한다.

- [ ] **Step 2: 모듈 설정과 Gradle**

`app/modules/pose-camera/expo-module.config.json`:
```json
{"platforms":["android"],"android":{"modules":["expo.modules.posecamera.PoseCameraModule"]}}
```

`app/modules/pose-camera/android/build.gradle`:
```groovy
plugins {
  id 'com.android.library'
  id 'expo-module-gradle-plugin'
}
group = 'com.systemdesign'
version = '0.1.0'
android {
  namespace 'expo.modules.posecamera'
  defaultConfig { versionCode 1; versionName '0.1.0' }
}
dependencies {
  def camerax = '1.4.2'
  implementation "androidx.camera:camera-core:$camerax"
  implementation "androidx.camera:camera-camera2:$camerax"
  implementation "androidx.camera:camera-lifecycle:$camerax"
  implementation "androidx.camera:camera-view:$camerax"
  implementation 'com.google.mediapipe:tasks-vision:1.0.0'
}
// The pose model is downloaded, never committed (public repo).
def poseModel = file('src/main/assets/models/pose_landmarker_lite.task')
tasks.named('preBuild') {
  doFirst {
    if (!poseModel.exists()) throw new GradleException("Missing ${poseModel}. Run in app/: npm run models")
  }
}
```

`app/modules/pose-camera/android/src/main/AndroidManifest.xml`:
```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <uses-permission android:name="android.permission.CAMERA" />
</manifest>
```

- [ ] **Step 3: 카메라 소스** — `FrameSource.kt`, `FrontCameraSource.kt` (경로: `app/modules/pose-camera/android/src/main/java/expo/modules/posecamera/`)

`FrameSource.kt`:
```kotlin
package expo.modules.posecamera

import android.graphics.Bitmap
import androidx.camera.core.Preview
import androidx.lifecycle.LifecycleOwner

/**
 * One upright, un-mirrored camera frame. tMs = SystemClock.elapsedRealtime() when the app got
 * it; sensorMs = the camera's own timestamp in ms (its time base may differ, see PoseEngine).
 */
class Frame(val bitmap: Bitmap, val tMs: Long, val sensorMs: Double, val seq: Long)

/**
 * Where frames come from: the phone's front camera now, the amp hardware's camera later.
 * Only this part changes with the camera; pose and tracking stay the same.
 */
interface FrameSource {
    /** Start delivering frames; [onFrame] runs on the source's own thread. [preview] shows the camera on screen, if the source can. */
    fun start(owner: LifecycleOwner, preview: Preview.SurfaceProvider?, onFrame: (Frame) -> Unit)

    fun stop()
}
```

`FrontCameraSource.kt`:
```kotlin
package expo.modules.posecamera

import android.content.Context
import android.os.SystemClock
import android.util.Log
import android.util.Size
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.core.UseCase
import androidx.camera.core.resolutionselector.AspectRatioStrategy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import java.util.concurrent.Executors

/**
 * The phone's front camera through CameraX: ~640x480 RGBA, rotated upright, never mirrored, plus an
 * on-screen preview at the same 4:3 ratio so the skeleton lines up with it.
 * Frames are handed on and never stored (principle 3).
 */
class FrontCameraSource(private val context: Context) : FrameSource {
    private val executor = Executors.newSingleThreadExecutor { Thread(it, "camera") }
    @Volatile private var running = false
    private var provider: ProcessCameraProvider? = null
    private var useCases: List<UseCase> = emptyList()
    private var seq = 0L

    override fun start(owner: LifecycleOwner, preview: Preview.SurfaceProvider?, onFrame: (Frame) -> Unit) {
        running = true
        val future = ProcessCameraProvider.getInstance(context)
        future.addListener({
            if (!running) return@addListener // stopped before the provider was ready
            val selector = ResolutionSelector.Builder()
                .setAspectRatioStrategy(AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY)
                .setResolutionStrategy(
                    ResolutionStrategy(Size(640, 480), ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER),
                )
                .build()
            val analysis = ImageAnalysis.Builder()
                .setResolutionSelector(selector)
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
                .setOutputImageRotationEnabled(true)
                .build()
            analysis.setAnalyzer(executor) { image ->
                val tMs = SystemClock.elapsedRealtime()
                val sensorMs = image.imageInfo.timestamp / 1e6
                val bitmap = image.toBitmap()
                image.close()
                onFrame(Frame(bitmap, tMs, sensorMs, ++seq))
            }
            val cases = listOfNotNull(
                preview?.let { surface -> Preview.Builder().setResolutionSelector(selector).build().also { it.setSurfaceProvider(surface) } },
                analysis,
            )
            try {
                val p = future.get()
                p.bindToLifecycle(owner, CameraSelector.DEFAULT_FRONT_CAMERA, *cases.toTypedArray())
                provider = p
                useCases = cases
            } catch (e: Exception) {
                Log.e(TAG, "front camera failed to start", e)
            }
        }, ContextCompat.getMainExecutor(context))
    }

    /** Main thread only (CameraX unbind). */
    override fun stop() {
        running = false
        useCases.filterIsInstance<ImageAnalysis>().forEach { it.clearAnalyzer() }
        if (useCases.isNotEmpty()) provider?.unbind(*useCases.toTypedArray()) // only ours, never unbindAll()
        provider = null
        useCases = emptyList()
        executor.shutdown()
    }

    companion object {
        private const val TAG = "FrontCamera"
    }
}
```

- [ ] **Step 4: 자세 엔진** — `PoseEngine.kt` (id403 `PoseEngine.kt` + 모델 버퍼 로딩)

```kotlin
package expo.modules.posecamera

import android.content.Context
import android.os.SystemClock
import android.util.Log
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.framework.image.MPImage
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.core.Delegate
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarker
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarkerResult
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.Executors
import org.json.JSONObject

/** Detector thresholds from src/tracking/config.ts `pose` (the view's detectorJson prop). */
data class PoseOptions(
    val numPoses: Int,
    val minDetection: Float,
    val minPresence: Float,
    val minTracking: Float,
) {
    companion object {
        fun fromJson(json: String): PoseOptions {
            val o = JSONObject(json)
            return PoseOptions(
                numPoses = o.optInt("num_poses", 1),
                minDetection = o.optDouble("min_detection_confidence", 0.5).toFloat(),
                minPresence = o.optDouble("min_presence_confidence", 0.5).toFloat(),
                minTracking = o.optDouble("min_tracking_confidence", 0.5).toFloat(),
            )
        }
    }
}

/** One result. Flat landmark arrays (33*3, 33*3, 33), null when nobody is in view. */
class PoseResult(
    val tMs: Long,
    val captureMs: Double,
    val captureFrom: String,
    val sourceFrames: Long,
    val aspect: Float,
    val image: FloatArray?,
    val world: FloatArray?,
    val visibility: FloatArray?,
)

/**
 * MediaPipe Pose Landmarker (LIVE_STREAM), GPU first and CPU when the GPU delegate fails.
 * At most one frame is in flight: frames arriving while busy are dropped, so latency never piles
 * up (the drop shows as source_fps > pose_fps in the perf message).
 */
class PoseEngine(
    private val context: Context,
    val model: String,
    private val options: PoseOptions,
    private val onResult: (PoseResult) -> Unit,
    private val onDelegateChanged: (String) -> Unit,
) {
    @Volatile var delegate = "gpu"
        private set

    private val control = Executors.newSingleThreadExecutor { Thread(it, "pose-control") }
    private val pending = HashMap<Long, Frame>() // MediaPipe timestamp -> frame, for latency
    private var landmarker: PoseLandmarker? = null
    private var lastTs = -1L
    private var busySince = 0L
    private var gotResult = false
    private var closed = false

    init {
        landmarker = build(Delegate.GPU)
            ?: build(Delegate.CPU)?.also { delegate = "cpu" }
            ?: throw IllegalStateException("PoseLandmarker failed to start on GPU and CPU")
    }

    /** Called on the camera thread for every frame. */
    fun detect(frame: Frame) {
        val lm: PoseLandmarker
        val ts: Long
        synchronized(this) {
            lm = landmarker ?: return
            val now = SystemClock.elapsedRealtime()
            if (busySince != 0L && now - busySince < STALL_MS) return // busy: drop this frame
            ts = if (frame.tMs <= lastTs) lastTs + 1 else frame.tMs // must strictly increase
            lastTs = ts
            busySince = now
            pending[ts] = frame
            if (pending.size > MAX_PENDING) pending.keys.sorted().take(pending.size - MAX_PENDING).forEach { pending.remove(it) }
        }
        try {
            lm.detectAsync(BitmapImageBuilder(frame.bitmap).build(), ts)
        } catch (e: RuntimeException) { // closed meanwhile, or a bad frame
            Log.w(TAG, "detectAsync failed", e)
            synchronized(this) {
                busySince = 0L
                pending.remove(ts)
            }
        }
    }

    fun close() {
        val lm = synchronized(this) {
            closed = true
            pending.clear()
            landmarker.also { landmarker = null }
        }
        // Outside the lock: close() waits for in-flight results, and their callback takes the lock.
        lm?.close()
        control.shutdown()
    }

    /** The model as a direct buffer: works whether or not the APK compresses the asset. */
    private fun modelBuffer(): ByteBuffer {
        val bytes = context.assets.open("models/pose_landmarker_$model.task").use { it.readBytes() }
        return ByteBuffer.allocateDirect(bytes.size).order(ByteOrder.nativeOrder()).apply {
            put(bytes)
            rewind()
        }
    }

    private fun build(d: Delegate): PoseLandmarker? = try {
        val base = BaseOptions.builder()
            .setModelAssetBuffer(modelBuffer())
            .setDelegate(d)
            .build()
        val opts = PoseLandmarker.PoseLandmarkerOptions.builder()
            .setBaseOptions(base)
            .setRunningMode(RunningMode.LIVE_STREAM)
            .setNumPoses(options.numPoses)
            .setMinPoseDetectionConfidence(options.minDetection)
            .setMinPosePresenceConfidence(options.minPresence)
            .setMinTrackingConfidence(options.minTracking)
            .setOutputSegmentationMasks(false)
            .setResultListener { result: PoseLandmarkerResult, input: MPImage -> handleResult(result, input) }
            .setErrorListener { e: RuntimeException -> handleError(e) }
            .build()
        PoseLandmarker.createFromOptions(context, opts)
    } catch (e: Exception) {
        Log.w(TAG, "PoseLandmarker ($d) failed to start", e)
        null
    }

    private fun handleResult(result: PoseLandmarkerResult, input: MPImage) {
        val ts = result.timestampMs()
        val frame: Frame
        synchronized(this) {
            busySince = 0L
            gotResult = true
            frame = pending.remove(ts) ?: return
            pending.keys.filter { it < ts }.forEach { pending.remove(it) } // dropped by MediaPipe
        }
        val now = SystemClock.elapsedRealtimeNanos() / 1e6
        // The sensor timestamp counts only if it is on the elapsedRealtime base (lag 0..500 ms).
        val fromSensor = frame.tMs - frame.sensorMs in 0.0..SENSOR_LAG_MAX_MS
        val start = if (fromSensor) frame.sensorMs else frame.tMs.toDouble()
        val from = if (fromSensor) "sensor" else "analyzer"
        val aspect = input.width.toFloat() / input.height
        val people = result.landmarks()
        if (people.isEmpty()) {
            onResult(PoseResult(frame.tMs, now - start, from, frame.seq, aspect, null, null, null))
            return
        }
        val p = people[0]
        val w = result.worldLandmarks()[0]
        val image = FloatArray(N * 3)
        val world = FloatArray(N * 3)
        val vis = FloatArray(N)
        for (i in 0 until N) {
            image[3 * i] = p[i].x()
            image[3 * i + 1] = p[i].y()
            image[3 * i + 2] = p[i].z()
            world[3 * i] = w[i].x()
            world[3 * i + 1] = w[i].y()
            world[3 * i + 2] = w[i].z()
            vis[i] = p[i].visibility().orElse(0f)
        }
        onResult(PoseResult(frame.tMs, now - start, from, frame.seq, aspect, image, world, vis))
    }

    private fun handleError(e: RuntimeException) {
        Log.e(TAG, "MediaPipe error (delegate=$delegate)", e)
        val fallback = synchronized(this) {
            busySince = 0L
            delegate == "gpu" && !gotResult
        }
        if (fallback) control.execute { switchToCpu() } // never close the graph from its own callback
    }

    private fun switchToCpu() {
        val gpu = synchronized(this) {
            if (landmarker == null || delegate == "cpu") return
            landmarker.also { landmarker = null } // detect() drops frames until the CPU graph is up
        }
        gpu?.close() // outside the lock, as in close()
        val cpu = build(Delegate.CPU)
        synchronized(this) {
            if (closed) {
                cpu?.close()
                return
            }
            landmarker = cpu
            delegate = "cpu"
            busySince = 0L
        }
        onDelegateChanged("cpu")
    }

    companion object {
        private const val TAG = "PoseEngine"
        private const val N = 33
        private const val STALL_MS = 500L
        private const val MAX_PENDING = 8
        private const val SENSOR_LAG_MAX_MS = 500.0
    }
}
```

- [ ] **Step 5: 네이티브 뷰와 모듈 정의** — `PoseCameraView.kt`, `PoseCameraModule.kt`

`PoseCameraView.kt`:
```kotlin
package expo.modules.posecamera

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.ViewGroup
import androidx.camera.view.PreviewView
import androidx.lifecycle.LifecycleOwner
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

/**
 * Camera preview + pose events for the session's camera tab; runs only while `active`.
 * JS gets landmarks and timing; video frames never leave this view (principle 3).
 */
class PoseCameraView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    override val shouldUseAndroidLayout = true // lay out the native PreviewView child

    private val onPose by EventDispatcher()
    private val onEngine by EventDispatcher()
    private val onError by EventDispatcher()
    private val main = Handler(Looper.getMainLooper())
    private val previewView = PreviewView(context).apply {
        implementationMode = PreviewView.ImplementationMode.COMPATIBLE // TextureView: JS overlays draw on top
        scaleType = PreviewView.ScaleType.FILL_CENTER
    }
    private var wantActive = false
    private var source: FrameSource? = null
    private var engine: PoseEngine? = null
    var model = "lite"
    var detectorJson = "{}"

    init {
        addView(previewView, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    }

    fun setActive(active: Boolean) {
        wantActive = active
    }

    /** After every prop update: start or stop to match `active`. */
    fun applyProps() {
        if (wantActive) start() else stop()
    }

    fun stop() {
        source?.stop()
        source = null
        engine?.close()
        engine = null
    }

    private fun start() {
        if (source != null) return
        val owner = appContext.currentActivity as? LifecycleOwner ?: return emitError("카메라 화면을 열 수 없어요.")
        val e = try {
            PoseEngine(context, model, PoseOptions.fromJson(detectorJson), ::emitPose, ::emitEngine)
        } catch (ex: Exception) {
            return emitError(ex.message ?: "자세 인식을 시작하지 못했어요.")
        }
        engine = e
        emitEngine(e.delegate)
        source = FrontCameraSource(context).also { it.start(owner, previewView.surfaceProvider) { frame -> e.detect(frame) } }
    }

    /** Called on MediaPipe's thread. Expo map events cannot carry null: nobody in view = empty lists. */
    private fun emitPose(r: PoseResult) {
        val now = SystemClock.elapsedRealtime()
        val image = r.image
        val vis = r.visibility
        val lm = if (image != null && vis != null) List(N * 3) { k -> if (k % 3 == 2) vis[k / 3].toDouble() else image[k].toDouble() } else emptyList()
        val payload = mapOf<String, Any>(
            "tMs" to r.tMs.toDouble(),
            "seq" to r.sourceFrames.toDouble(),
            "ageMs" to (now - r.tMs).toDouble(),
            "emitWallMs" to System.currentTimeMillis().toDouble(),
            "latencyMs" to r.captureMs,
            "captureFrom" to r.captureFrom,
            "aspect" to r.aspect.toDouble(),
            "image" to lm,
            "world" to (r.world?.map { it.toDouble() } ?: emptyList()),
        )
        main.post { onPose(payload) }
    }

    private fun emitEngine(delegate: String) {
        main.post { onEngine(mapOf("model" to model, "delegate" to delegate)) }
    }

    private fun emitError(message: String) {
        main.post { onError(mapOf("message" to message)) }
    }

    companion object {
        private const val N = 33
    }
}
```
`image[k]` for `k % 3 != 2`: landmark `k / 3`의 x(`k % 3 == 0`)와 y(`k % 3 == 1`)가 `image[3 * (k / 3) + k % 3] == image[k]`에 있다. 그래서 결과는 33 × [x, y, visibility]이고 z는 버린다.

`PoseCameraModule.kt`:
```kotlin
package expo.modules.posecamera

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class PoseCameraModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("PoseCamera")
        View(PoseCameraView::class) {
            Events("onPose", "onEngine", "onError")
            Prop("active") { view: PoseCameraView, active: Boolean -> view.setActive(active) }
            Prop("model") { view: PoseCameraView, model: String -> view.model = model }
            Prop("detectorJson") { view: PoseCameraView, json: String -> view.detectorJson = json }
            OnViewDidUpdateProps { view: PoseCameraView -> view.applyProps() }
            OnViewDestroys { view: PoseCameraView -> view.stop() }
        }
    }
}
```

- [ ] **Step 6: JS 진입점** — `app/modules/pose-camera/index.ts`

```ts
import { requireNativeView } from 'expo';
import type { ComponentType } from 'react';
import { Platform, type NativeSyntheticEvent, type ViewProps } from 'react-native';
import type { PoseEvent } from '../../src/tracking/types';

export type PoseCameraProps = ViewProps & {
  active: boolean;
  model: 'lite';
  detectorJson: string;
  onPose?: (e: NativeSyntheticEvent<PoseEvent>) => void;
  onEngine?: (e: NativeSyntheticEvent<{ model: string; delegate: string }>) => void;
  onError?: (e: NativeSyntheticEvent<{ message: string }>) => void;
};

/** Front camera preview + pose events. Android only; null elsewhere (the web preview shows a note). */
const PoseCameraView: ComponentType<PoseCameraProps> | null =
  Platform.OS === 'android' ? requireNativeView<PoseCameraProps>('PoseCamera') : null;
export default PoseCameraView;
```

- [ ] **Step 7: 빌드 확인**

```powershell
npm run typecheck; npm run lint
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
npx expo prebuild --platform android --no-install --clean
npm run build:android
```
Expected: typecheck·lint 통과, `BUILD SUCCESSFUL`. 빌드 로그에 `:pose-camera`(또는 `:expo-module-pose-camera`) 프로젝트가 컴파일되어야 한다. 모델을 지우고(`Remove-Item modules\pose-camera\android\src\main\assets\models -Recurse`) 다시 빌드하면 `Missing ... Run in app/: npm run models`로 실패해야 한다. 확인한 뒤 `npm run models`로 되돌린다.

CameraX·MediaPipe 버전 충돌로 빌드가 실패하면(예: `Duplicate class`, minSdk), 오류 전문을 태양에게 보고하고 버전을 바꾸기 전에 확인을 받는다.

- [ ] **Step 8: 커밋**

```powershell
git add modules/pose-camera scripts/download-models.cjs package.json .gitignore
git status --short   # 모델 .task 파일이 없어야 한다
git commit -m "Add the pose-camera module: CameraX preview and MediaPipe pose events" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: 화면용 순수 로직 — 스토어, [춤 시작], 오버레이 좌표, 안 가본 쪽

**Files:**
- Create: `app/src/tracking/store.ts`, `app/src/tracking/danceStart.ts`, `app/src/tracking/overlay.ts`, `app/src/tracking/insights.ts`
- Test: `app/scripts/tracking/store.test.cjs`, `app/scripts/tracking/danceStart.test.cjs`, `app/scripts/tracking/overlay.test.cjs`, `app/scripts/tracking/insights.test.cjs`

**Interfaces:**
- Consumes: `LiveSession`, `planFor`, `countInEight`, `EightPlan`, `DEFAULT_CONFIG`, `PoseEvent` 등
- Produces (store.ts): `MusicSource = () => {position, playing}`, `PlanName`, `TrackingView {status, usage, cue, perf, pose, playing, count, plan, engine, error}`, `frameMusicTime(position, ageMs, emitWallMs, wallNowMs)`, `poseFromEvent(e): PoseFrame | null`, `class LiveTrackingStore(cfg?, {wallNowMs?, perfNowMs?}) { session; trackerState; calibrated; subscribe(fn); getView(); setMusicSource(src); setPlan(plan); importTracking(saved?); exportTracking(): SessionTracking | null; recalibrate(); handlePose(e); handleEngine({model, delegate}); handleError(message) }`. `subscribe`와 `getView`는 화살표 함수 필드라 `useSyncExternalStore(store.subscribe, store.getView)`에 바로 넘긴다.
- Produces (danceStart.ts): `StartPhase`, `StartAction = 'recalibrate' | 'play'`, `StartEvent`, `IDLE`, `nextStart(phase, event) → {phase, actions}`, `secondsLeft(phase, nowMs)`
- Produces (overlay.ts): `projectToBox(x, y, frameAspect, boxAspect) → {x, y}` (FILL_CENTER 잘림 + 전면 카메라 거울)
- Produces (insights.ts): `unexploredTargets(underused, level, levelMinShare): CueTarget[]`

- [ ] **Step 1: 실패하는 테스트 작성**

`app/scripts/tracking/overlay.test.cjs`:
```js
const assert = require('node:assert/strict');
const { projectToBox } = require('../load-ts.cjs')('src/tracking/overlay.ts');
const { close } = require('./helpers.cjs');

assert.deepEqual(projectToBox(0.25, 0.4, 0.75, 0.75), { x: 0.75, y: 0.4 }, 'same aspect: mirror only');
{
  // frame wider than the box: the sides are cropped and the middle fills the box
  const mid = projectToBox(0.5, 0.5, 1.0, 0.75);
  close(mid.x, 0.5);
  close(mid.y, 0.5);
  const edge = projectToBox(0.125, 0.3, 1.0, 0.75);
  close(edge.x, 1, 1e-9, 'left crop edge lands on the mirrored right edge');
  close(edge.y, 0.3);
}
{
  // frame taller than the box: top and bottom are cropped
  const p = projectToBox(0.5, 0.2, 0.5, 0.75);
  close(p.x, 0.5);
  close(p.y, 0.05);
}
```

`app/scripts/tracking/danceStart.test.cjs`:
```js
const assert = require('node:assert/strict');
const { nextStart, secondsLeft, IDLE } = require('../load-ts.cjs')('src/tracking/danceStart.ts');

const press = (nowMs, calibrated) => ({ type: 'press', nowMs, calibrated, countdownMs: 5000 });
const tick = (nowMs, state = 'tracking', playing = false) => ({ type: 'tick', nowMs, state, playing });

// not calibrated: countdown -> recalibrate -> wait for the dancer -> play
let r = nextStart(IDLE, press(0, false));
assert.deepEqual(r, { phase: { kind: 'countdown', endsAtMs: 5000, calibrate: true }, actions: [] });
assert.equal(secondsLeft(r.phase, 1200), 4);
assert.deepEqual(nextStart(r.phase, tick(4999)).actions, []);
r = nextStart(r.phase, tick(5000));
assert.deepEqual(r, { phase: { kind: 'calibrating' }, actions: ['recalibrate'] });
assert.deepEqual(nextStart(r.phase, tick(5200, 'waiting')).actions, [], 'waits while nobody is in view');
assert.deepEqual(nextStart(r.phase, tick(6000, 'calibrating')).actions, []);
assert.deepEqual(nextStart(r.phase, tick(8200, 'tracking')), { phase: IDLE, actions: ['play'] });

// already calibrated: countdown -> play
const counting = nextStart(IDLE, press(0, true)).phase;
assert.deepEqual(nextStart(counting, tick(5000)), { phase: IDLE, actions: ['play'] });
// external play cancels: music started from the dock during the countdown, never play twice
assert.deepEqual(nextStart(counting, tick(2000, 'tracking', true)), { phase: IDLE, actions: [] });
assert.deepEqual(nextStart(counting, { type: 'cancel' }), { phase: IDLE, actions: [] });
assert.deepEqual(nextStart(counting, press(100, true)).phase, counting, 'pressing again while counting does nothing');
assert.deepEqual(nextStart(IDLE, tick(100)), { phase: IDLE, actions: [] });
assert.equal(secondsLeft(IDLE, 0), 0);
```

`app/scripts/tracking/insights.test.cjs`:
```js
const assert = require('node:assert/strict');
const { unexploredTargets } = require('../load-ts.cjs')('src/tracking/insights.ts');

assert.deepEqual(unexploredTargets(['leg_l'], { low: 0.05, mid: 0.9, high: 0.05 }, 0.1), ['leg_l', 'low', 'high']);
assert.deepEqual(unexploredTargets(['head'], { low: 0.2, mid: 0.6, high: 0.2 }, 0.1), ['head']);
assert.deepEqual(unexploredTargets([], { low: 0, mid: 0, high: 0 }, 0.1), [], 'level not judged: not unexplored');
```

`app/scripts/tracking/store.test.cjs`:
```js
const assert = require('node:assert/strict');
const load = require('../load-ts.cjs');
const { LiveTrackingStore, frameMusicTime, poseFromEvent } = load('src/tracking/store.ts');
const { withConfig } = load('src/tracking/config.ts');
const { planFor } = load('src/tracking/windows.ts');
const { S, standingImage, worldFromImage, rng, jitter, close } = require('./helpers.cjs');

close(frameMusicTime(10, 50, 1000, 1030), 9.92);
close(frameMusicTime(10, 50, 1000, 990), 9.95, 1e-9, 'a wall clock behind the event adds no delay');

/** A pose-camera event for a pose image (33 x [x, y, z]) or nobody (null). */
const event = (tMs, img, wallMs) => ({
  tMs, seq: Math.round(tMs / 33) + 1, ageMs: 20, emitWallMs: wallMs, latencyMs: 35, captureFrom: 'sensor', aspect: 0.75,
  image: img ? img.flatMap(p => [p[0], p[1], 1]) : [],
  world: img ? worldFromImage(img).flat() : [],
});
assert.equal(poseFromEvent(event(0, null, 0)), null);
{
  const p = poseFromEvent(event(5, standingImage(), 0));
  assert.equal(p.tMs, 5);
  assert.equal(p.visibility.length, 33);
  assert.deepEqual(p.image[S.L_HIP], [0.53, 0.5, 0]);
}

const CFG = withConfig({ calibration: { duration_s: 1 }, feedback: { warmup_s: 0, persist_s: 0 } });
/** Store with fake clocks. Each send() is one camera frame `stepMs` later; the song position follows the camera. */
function harness({ playing = true, stepMs = 66 } = {}) {
  let wall = 1_000_000, t = 0, notified = 0;
  const music = { playing };
  const store = new LiveTrackingStore(CFG, { wallNowMs: () => wall, perfNowMs: () => 0 });
  store.setMusicSource(() => ({ position: t / 1000, playing: music.playing }));
  store.subscribe(() => notified++);
  const send = (img = standingImage()) => { store.handlePose(event(t, img, wall)); t += stepMs; wall += stepMs; };
  const r = rng(0);
  const arms = i => {
    const img = jitter(standingImage(), r);
    for (const k of [S.L_ELBOW, S.L_WRIST, S.R_ELBOW, S.R_WRIST]) img[k][0] += 0.1 * Math.sin(i / 3);
    return img;
  };
  return { store, music, send, arms, notified: () => notified, wall: () => wall };
}

{
  // the 8count window follows the song's eights
  const h = harness();
  h.store.setPlan(planFor([{ index: 0, start: 0, end: 4 }, { index: 1, start: 4, end: 8 }], null, 4));
  for (let i = 0; i < 80; i++) h.send(); // 5.3 s
  assert.equal(h.store.trackerState, 'tracking');
  assert.equal(h.store.session.pipeline.accumulator.currentEightKey, 1);
  const v = h.store.getView();
  assert.equal(v.plan, 'eights');
  assert.ok(v.count >= 2 && v.count <= 3, `count ${v.count}`);
  assert.ok(v.usage['8count'] && v.status.state === 'tracking');
  assert.ok(h.store.exportTracking().totals.frames > 0);
}
{
  // paused the whole time: tracks the dancer but saves nothing
  const h = harness({ playing: false });
  for (let i = 0; i < 60; i++) h.send();
  assert.equal(h.store.trackerState, 'tracking');
  assert.equal(h.store.exportTracking(), null);
  assert.equal(h.store.getView().playing, false);
}
{
  // view updates are throttled to app.view_hz
  const h = harness({ stepMs: 10 });
  for (let i = 0; i < 30; i++) h.send(); // 300 ms of frames
  assert.ok(h.notified() >= 4 && h.notified() <= 6, `notified ${h.notified()} times`);
}
{
  // pose cleared: the skeleton disappears when nobody is in view
  const h = harness({ stepMs: 100 });
  h.send();
  assert.ok(h.store.getView().pose);
  h.send(null);
  assert.equal(h.store.getView().pose, null);
}
{
  // a suggestion shows for cue_show_s, then clears (before the next one may come)
  const h = harness({ stepMs: 100 });
  let i = 0;
  while (!h.store.getView().cue && i < 100) h.send(h.arms(i++));
  assert.ok(h.store.getView().cue, 'arms-only dancing gets a suggestion');
  const shownAt = h.wall();
  while (h.wall() < shownAt + 9000) h.send(h.arms(i++));
  assert.equal(h.store.getView().cue, null);
}
{
  const h = harness();
  h.store.handleEngine({ model: 'lite', delegate: 'cpu' });
  assert.deepEqual(h.store.getView().engine, { model: 'lite', delegate: 'cpu' });
  h.store.handleError('카메라 화면을 열 수 없어요.');
  assert.equal(h.store.getView().error, '카메라 화면을 열 수 없어요.');
}
{
  const h = harness();
  for (let i = 0; i < 40; i++) h.send();
  assert.equal(h.store.calibrated, true);
  h.store.recalibrate();
  assert.equal(h.store.trackerState, 'waiting');
  assert.equal(h.store.calibrated, false);
}
{
  const saved = { version: 1, trackedMs: 40000, totals: { frames: 10, score: { head: 0, torso: 0, arm_l: 5, arm_r: 0, leg_l: 0, leg_r: 0 }, observed: { head: 10, torso: 10, arm_l: 10, arm_r: 10, leg_l: 10, leg_r: 10 }, levels: { low: 0, mid: 10, high: 0 } } };
  const h = harness();
  h.store.importTracking(saved);
  assert.deepEqual(h.store.exportTracking(), saved, 'a resumed session keeps its totals even without new frames');
  h.store.importTracking(undefined); // sessions saved before tracking existed
}
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test:tracking`
Expected: `danceStart.test.cjs`에서 FAIL (`ENOENT ... danceStart.ts`). insights·overlay·store도 같은 이유로 실패한다.

- [ ] **Step 3: `app/src/tracking/overlay.ts` 작성**

```ts
/**
 * Where a frame point (0..1, not mirrored) lands in the on-screen box (0..1). Matches PreviewView
 * FILL_CENTER (the frame is scaled to cover the box; the overflow is cropped evenly) and the front
 * camera preview's mirror.
 */
export function projectToBox(x: number, y: number, frameAspect: number, boxAspect: number): { x: number; y: number } {
  let u = x, v = y;
  if (frameAspect > boxAspect) {
    const w = boxAspect / frameAspect; // visible share of the frame's width
    u = (x - (1 - w) / 2) / w;
  } else if (frameAspect < boxAspect) {
    const h = frameAspect / boxAspect; // visible share of the frame's height
    v = (y - (1 - h) / 2) / h;
  }
  return { x: 1 - u, y: v };
}
```

- [ ] **Step 4: `app/src/tracking/danceStart.ts` 작성**

```ts
// [춤 시작]: a countdown to walk back from the phone, a 3 s still calibration if needed, then the music.
import type { TrackerState } from './types';

export type StartPhase =
  | { kind: 'idle' }
  | { kind: 'countdown'; endsAtMs: number; calibrate: boolean }
  | { kind: 'calibrating' };
export type StartAction = 'recalibrate' | 'play';
export type StartEvent =
  | { type: 'press'; nowMs: number; calibrated: boolean; countdownMs: number }
  | { type: 'tick'; nowMs: number; state: TrackerState; playing: boolean }
  | { type: 'cancel' };

export const IDLE: StartPhase = { kind: 'idle' };

export function nextStart(phase: StartPhase, ev: StartEvent): { phase: StartPhase; actions: StartAction[] } {
  const stay = { phase, actions: [] as StartAction[] };
  if (ev.type === 'cancel') return { phase: IDLE, actions: [] };
  if (ev.type === 'press')
    return phase.kind === 'idle' ? { phase: { kind: 'countdown', endsAtMs: ev.nowMs + ev.countdownMs, calibrate: !ev.calibrated }, actions: [] } : stay;
  if (phase.kind === 'idle') return stay;
  if (ev.playing) return { phase: IDLE, actions: [] }; // started from the dock: never play twice
  if (phase.kind === 'countdown') {
    if (ev.nowMs < phase.endsAtMs) return stay;
    return phase.calibrate ? { phase: { kind: 'calibrating' }, actions: ['recalibrate'] } : { phase: IDLE, actions: ['play'] };
  }
  return ev.state === 'tracking' ? { phase: IDLE, actions: ['play'] } : stay;
}

export const secondsLeft = (phase: StartPhase, nowMs: number): number =>
  phase.kind === 'countdown' ? Math.max(0, Math.ceil((phase.endsAtMs - nowMs) / 1000)) : 0;
```

- [ ] **Step 5: `app/src/tracking/insights.ts` 작성** (Task 14가 이 파일에 이어서 쓴다)

```ts
import type { CueTarget, Level, Segment } from './types';

/** Not explored yet: underused parts, then low / high below `levelMinShare` (only when level was judged at all). */
export function unexploredTargets(underused: Segment[], level: Record<Level, number>, levelMinShare: number): CueTarget[] {
  const judged = level.low + level.mid + level.high > 0;
  return [...underused, ...(judged ? (['low', 'high'] as const).filter(l => level[l] < levelMinShare) : [])];
}
```

- [ ] **Step 6: `app/src/tracking/store.ts` 작성**

```ts
// Glue between the pose-camera events, the music player and the camera tab. Holds one LiveSession for the
// whole practice session (it outlives tab switches) and exposes a throttled view for useSyncExternalStore.
import { DEFAULT_CONFIG, type TrackingConfig } from './config';
import { LiveSession } from './session';
import { countInEight, planFor, type EightPlan } from './windows';
import type {
  FeedbackCue, Landmarks, OutMessage, PerfMessage, PoseEvent, PoseFrame, PoseMessage, SessionTracking,
  StatusMessage, TrackerState, UsageMessage, WindowName,
} from './types';

export type MusicSource = () => { position: number; playing: boolean };
export type PlanName = 'eights' | 'tempo' | 'fixed' | 'rolling';
export type TrackingView = {
  status: StatusMessage | null;
  usage: Partial<Record<WindowName, UsageMessage>>;
  cue: FeedbackCue | null; // cleared after app.cue_show_s
  perf: PerfMessage | null;
  pose: PoseMessage | null; // null = nobody in view
  playing: boolean;
  count: number | null; // 1..8 inside the current eight
  plan: PlanName;
  engine: { model: string; delegate: string };
  error: string | null;
};

/** Song position of a frame: the player position now, minus how old the frame is. */
export function frameMusicTime(position: number, ageMs: number, emitWallMs: number, wallNowMs: number): number {
  return position - (ageMs + Math.max(0, wallNowMs - emitWallMs)) / 1000;
}

export function poseFromEvent(e: PoseEvent): PoseFrame | null {
  if (e.image.length !== 99 || e.world.length !== 99) return null;
  const image: Landmarks = [], world: Landmarks = [], visibility: number[] = [];
  for (let i = 0; i < 33; i++) {
    image.push([e.image[3 * i], e.image[3 * i + 1], 0]);
    visibility.push(e.image[3 * i + 2]);
    world.push([e.world[3 * i], e.world[3 * i + 1], e.world[3 * i + 2]]);
  }
  return { tMs: e.tMs, image, world, visibility };
}

const planName = (p: EightPlan): PlanName => (p.kind === 'grid' ? p.source : p.kind);

export class LiveTrackingStore {
  readonly session: LiveSession;
  private view: TrackingView;
  private pending: Partial<TrackingView> = {};
  private listeners = new Set<() => void>();
  private music: MusicSource | null = null;
  private plan: EightPlan;
  private lastFlush = -Infinity;
  private cueAtMs = 0;
  private lastTMs = 0;
  private readonly wallNow: () => number;

  constructor(private readonly cfg: TrackingConfig = DEFAULT_CONFIG, o: { wallNowMs?: () => number; perfNowMs?: () => number } = {}) {
    this.wallNow = o.wallNowMs ?? (() => Date.now());
    this.plan = planFor(null, null, cfg.aggregate.windows['8count_s']);
    this.session = new LiveSession(cfg, m => this.onMessage(m), {
      model: 'lite', delegate: 'gpu', captureFrom: 'sensor', clockMs: this.wallNow, perfNowMs: o.perfNowMs, plan: this.plan,
    });
    this.view = { status: null, usage: {}, cue: null, perf: null, pose: null, playing: false, count: null, plan: planName(this.plan), engine: { model: 'lite', delegate: 'gpu' }, error: null };
  }

  get trackerState(): TrackerState {
    return this.session.pipeline.tracker.state;
  }

  get calibrated(): boolean {
    return this.session.pipeline.tracker.calibration !== null;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getView = (): TrackingView => this.view;

  setMusicSource(source: MusicSource | null): void {
    this.music = source;
  }

  setPlan(plan: EightPlan): void {
    this.plan = plan;
    this.session.setPlan(plan);
    this.set({ plan: planName(plan) }, true);
  }

  importTracking(saved: SessionTracking | undefined): void {
    if (saved) this.session.importTracking(saved);
  }

  /** What to save with the practice session; null until something was tracked or restored. */
  exportTracking(): SessionTracking | null {
    const s = this.session.exportTracking();
    return s.trackedMs > 0 || s.totals.frames > 0 ? s : null;
  }

  recalibrate(): void {
    this.session.recalibrate();
  }

  handlePose(e: PoseEvent): void {
    const music = this.music?.() ?? { position: 0, playing: false };
    const musicT = frameMusicTime(music.position, e.ageMs, e.emitWallMs, this.wallNow());
    const pose = poseFromEvent(e);
    this.lastTMs = e.tMs;
    this.session.perf.captureFrom = e.captureFrom;
    if (!pose) this.pending.pose = null; // nobody in view: clear the skeleton
    this.session.step(e.tMs, pose, e.aspect, { playing: music.playing, musicT }, { captureMs: e.latencyMs, sourceFrames: e.seq });
    this.set({ playing: music.playing, count: countInEight(this.plan, musicT) });
  }

  handleEngine(e: { model: string; delegate: string }): void {
    this.session.setEngine(e.model, e.delegate);
    this.set({ engine: { model: e.model, delegate: e.delegate } }, true);
  }

  handleError(message: string): void {
    this.session.recordError(this.lastTMs);
    this.set({ error: message }, true);
  }

  private onMessage(m: OutMessage): void {
    if (!('type' in m)) {
      this.pending.usage = { ...(this.pending.usage ?? this.view.usage), [m.window]: m };
    } else if (m.type === 'status') {
      this.pending.status = m;
    } else if (m.type === 'pose') {
      this.pending.pose = m;
    } else if (m.type === 'perf') {
      this.pending.perf = m;
    } else {
      this.pending.cue = { t: m.t, kind: m.kind, target: m.target, text: m.text };
      this.cueAtMs = this.wallNow();
    }
  }

  /** Merge into the view; notify at most app.view_hz times a second unless forced. */
  private set(patch: Partial<TrackingView>, force = false): void {
    Object.assign(this.pending, patch);
    const now = this.wallNow();
    if (!force && now - this.lastFlush < 1000 / this.cfg.app.view_hz) return;
    let view: TrackingView = { ...this.view, ...this.pending };
    if (view.cue && now - this.cueAtMs >= 1000 * this.cfg.app.cue_show_s) view = { ...view, cue: null };
    this.view = view;
    this.pending = {};
    this.lastFlush = now;
    for (const listener of this.listeners) listener();
  }
}
```

- [ ] **Step 7: 통과 확인**

Run: `npm run test:tracking`
Expected: 새 파일 4개를 포함해 전부 `PASS`.

- [ ] **Step 8: 커밋**

```powershell
npm run lint; npm run typecheck
git add src/tracking scripts/tracking
git commit -m "Add the tracking store, dance-start flow and overlay mapping" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: 카메라 탭 화면과 세션 탭

**Files:**
- Modify: `app/package.json`, `app/package-lock.json` (`npx expo install react-native-svg`)
- Create: `app/src/components/tracking/BodyUsageBars.tsx`, `app/src/components/tracking/SkeletonOverlay.tsx`, `app/src/components/tracking/CameraTab.tsx`
- Modify: `app/src/screens/PlayerScreen.tsx`

**Interfaces:**
- Consumes: `PoseCameraView`(Task 10), `LiveTrackingStore`·`TrackingView`(Task 11), `nextStart`·`secondsLeft`·`IDLE`, `projectToBox`, `unexploredTargets`, `label`·`SEGMENT_LABELS`, `planFor`, `DEFAULT_CONFIG`·`detectorJson`
- Produces: `BodyUsageBars({segments, underused, dim?})`(Task 14가 재사용), `CameraTab({store, playing, onPlay})`, PlayerScreen의 `tracking` 스토어(Task 13이 저장에 쓴다)
- React 컴포넌트에는 이 레포에 테스트 도구가 없다. 검증은 typecheck·lint, 웹·Android 번들 export, 실기기 확인으로 한다.

- [ ] **Step 1: react-native-svg 설치**

```powershell
npx expo install react-native-svg
```
Expected: `package.json`의 dependencies에 SDK 57에 맞는 `react-native-svg` 버전이 추가된다.

- [ ] **Step 2: `app/src/components/tracking/BodyUsageBars.tsx` 작성**

```tsx
import { StyleSheet, Text, View } from 'react-native';
import { SEGMENT_LABELS } from '../../tracking/phrases';
import { SEGMENT_NAMES } from '../../tracking/segments';
import type { Segment } from '../../tracking/types';
import { C } from '../../theme';

type Props = { segments: Record<Segment, number>; underused: Segment[]; dim?: boolean };

/** Share of movement per body part. Quiet parts read "안 가본 쪽" with a dashed track, never as a warning. */
export default function BodyUsageBars({ segments, underused, dim = false }: Props) {
  return (
    <View style={[s.list, dim && s.dim]}>
      {SEGMENT_NAMES.map(seg => {
        const quiet = underused.includes(seg), pct = Math.round(segments[seg] * 100);
        return (
          <View key={seg} style={s.row}>
            <Text style={s.label}>{SEGMENT_LABELS[seg]}</Text>
            <View style={[s.track, quiet && s.quietTrack]}><View style={[s.fill, { width: `${pct}%` }]} /></View>
            <Text style={[s.value, quiet && s.quietValue]}>{quiet ? '안 가본 쪽' : `${pct}%`}</Text>
          </View>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  list: { gap: 8 },
  dim: { opacity: 0.45 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  label: { width: 52, color: C.sub, fontSize: 12 },
  track: { flex: 1, height: 9, borderRadius: 5, backgroundColor: C.bg, overflow: 'hidden' },
  quietTrack: { borderWidth: 1, borderStyle: 'dashed', borderColor: C.accent, backgroundColor: 'transparent' },
  fill: { height: '100%', borderRadius: 5, backgroundColor: C.accent },
  value: { width: 64, textAlign: 'right', color: C.text, fontSize: 12, fontVariant: ['tabular-nums'] },
  quietValue: { color: C.accent, fontSize: 11 },
});
```

- [ ] **Step 3: `app/src/components/tracking/SkeletonOverlay.tsx` 작성**

```tsx
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Line } from 'react-native-svg';
import { projectToBox } from '../../tracking/overlay';
import { SKELETON_EDGES, segmentOf } from '../../tracking/segments';
import type { PoseMessage, Segment } from '../../tracking/types';
import { C } from '../../theme';

type Props = { pose: PoseMessage | null; shares: Record<Segment, number> | null; underused: Segment[]; boxAspect: number; visibility: number };

const JOINTS = Array.from(new Set(SKELETON_EDGES.flat()));

/** Stick figure over the mirrored preview. Busier parts draw stronger; quiet ones get a dashed ring. */
export default function SkeletonOverlay({ pose, shares, underused, boxAspect, visibility }: Props) {
  if (!pose) return null;
  const W = 100 * boxAspect; // viewBox width: keeps circles round in the box
  const at = (i: number) => {
    const p = projectToBox(pose.lm[i][0], pose.lm[i][1], pose.aspect, boxAspect);
    return { x: p.x * W, y: p.y * 100 };
  };
  const seen = (i: number) => pose.lm[i][2] >= visibility;
  const strength = (i: number) => {
    const seg = segmentOf(i);
    return seg && shares ? Math.min(1, shares[seg] * 3) : 0;
  };
  return (
    <View style={[StyleSheet.absoluteFill, { pointerEvents: 'none' }]}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${W} 100`}>
        {SKELETON_EDGES.filter(([a, b]) => seen(a) && seen(b)).map(([a, b]) => {
          const p = at(a), q = at(b);
          return <Line key={`${a}-${b}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke="#FFFFFF" strokeOpacity={0.8} strokeWidth={0.8} />;
        })}
        {JOINTS.filter(seen).map(i => {
          const p = at(i), seg = segmentOf(i), quiet = !!seg && underused.includes(seg);
          return (
            <Circle key={i} cx={p.x} cy={p.y} r={quiet ? 2.2 : 1.6} fill={C.accent} fillOpacity={0.35 + 0.65 * strength(i)}
              stroke={quiet ? '#FFFFFF' : 'none'} strokeWidth={0.5} strokeDasharray={quiet ? '1 1' : undefined} />
          );
        })}
      </Svg>
    </View>
  );
}
```

- [ ] **Step 4: `app/src/components/tracking/CameraTab.tsx` 작성**

```tsx
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AppState, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import PoseCameraView from '../../../modules/pose-camera';
import { DEFAULT_CONFIG, detectorJson } from '../../tracking/config';
import { IDLE, nextStart, secondsLeft, type StartEvent, type StartPhase } from '../../tracking/danceStart';
import { unexploredTargets } from '../../tracking/insights';
import { label } from '../../tracking/phrases';
import type { LiveTrackingStore, TrackingView } from '../../tracking/store';
import { C } from '../../theme';
import BodyUsageBars from './BodyUsageBars';
import SkeletonOverlay from './SkeletonOverlay';

const BOX_ASPECT = 3 / 4; // upright 4:3 camera frame, no crop
const DETECTOR = detectorJson();
const LEVEL_NAMES = { low: '낮음', mid: '중간', high: '높음' } as const;
const PLAN_NOTE = { eights: '', tempo: 'BPM 기준 8박 단위', fixed: `박자 정보 없음 · ${DEFAULT_CONFIG.aggregate.windows['8count_s']}초 단위`, rolling: '' } as const;

type Props = { store: LiveTrackingStore; playing: boolean; onPlay: () => void };

function statusText(view: TrackingView, phase: StartPhase, now: number, playing: boolean): string {
  if (view.error) return view.error;
  if (phase.kind === 'countdown') return `${secondsLeft(phase, now)}초 뒤 시작 · 자리를 잡아 주세요`;
  const state = view.status?.state;
  if (state === 'calibrating') return `가만히 ${DEFAULT_CONFIG.calibration.duration_s}초 · ${Math.round((view.status?.progress ?? 0) * 100)}%`;
  if (!state || state === 'waiting') return '카메라 앞에 서 주세요 · 몸 전체가 보이게';
  if (!playing) return '일시정지 · 집계 멈춤';
  if (!view.usage['8count']?.tracking_ok) return '잘 안 보여요 · 몸 전체가 화면에 들어오게 서 주세요';
  return '트래킹 중';
}

const hudText = ({ perf, engine }: TrackingView) =>
  perf ? `${perf.pose_fps}fps · ${perf.lat_ms.capture_pose.p50 ?? '–'}ms · 인식 ${Math.round(perf.detect_rate * 100)}% · ${engine.delegate}` : '';

/** The session's camera tab: preview + skeleton, what has been used, and [춤 시작]. */
export default function CameraTab({ store, playing, onPlay }: Props) {
  const view = useSyncExternalStore(store.subscribe, store.getView);
  const [permission, setPermission] = useState<'asking' | 'granted' | 'denied'>('asking');
  const [windowName, setWindowName] = useState<'8count' | 'session'>('8count');
  const [phase, setPhase] = useState<StartPhase>(IDLE);
  const [now, setNow] = useState(() => Date.now());
  const phaseRef = useRef<StartPhase>(IDLE);
  const playingRef = useRef(playing);
  const onPlayRef = useRef(onPlay);
  useEffect(() => { playingRef.current = playing; }, [playing]);
  useEffect(() => { onPlayRef.current = onPlay; }, [onPlay]);

  const dispatch = useCallback((ev: StartEvent) => {
    const r = nextStart(phaseRef.current, ev);
    phaseRef.current = r.phase;
    setPhase(r.phase);
    for (const action of r.actions) {
      if (action === 'recalibrate') store.recalibrate();
      else onPlayRef.current();
    }
  }, [store]);

  // Camera permission: ask once, re-check when coming back from the system settings.
  useEffect(() => {
    if (!PoseCameraView) return;
    let alive = true;
    const check = (ask: boolean) => (ask ? ImagePicker.requestCameraPermissionsAsync() : ImagePicker.getCameraPermissionsAsync())
      .then(r => { if (alive) setPermission(r.granted ? 'granted' : 'denied'); })
      .catch(() => { if (alive) setPermission('denied'); });
    void check(true);
    const sub = AppState.addEventListener('change', state => { if (state === 'active') void check(false); });
    return () => { alive = false; sub.remove(); };
  }, []);

  // Drives the countdown and waits for calibration while [춤 시작] is running.
  useEffect(() => {
    if (phase.kind === 'idle') return;
    const timer = setInterval(() => {
      const t = Date.now();
      setNow(t);
      dispatch({ type: 'tick', nowMs: t, state: store.trackerState, playing: playingRef.current });
    }, 200);
    return () => clearInterval(timer);
  }, [phase.kind, dispatch, store]);

  if (!PoseCameraView) return (
    <View style={s.card}>
      <Text style={s.title}>카메라 트래킹은 Android 앱에서만 쓸 수 있어요</Text>
      <Text style={s.body}>믹서 탭은 그대로 쓸 수 있어요.</Text>
    </View>
  );
  if (permission === 'denied') return (
    <View style={s.card}>
      <Text style={s.title}>카메라 권한이 필요해요</Text>
      <Text style={s.body}>몸의 움직임을 보려면 카메라가 필요해요. 영상은 화면에만 보이고 저장하거나 보내지 않아요.</Text>
      <Pressable accessibilityRole="button" onPress={() => void Linking.openSettings()} style={s.secondary}><Text style={s.secondaryText}>설정 열기</Text></Pressable>
    </View>
  );

  const usage = view.usage[windowName];
  const dim = !playing || !usage?.tracking_ok;
  const targets = usage ? unexploredTargets(usage.underused, usage.level, DEFAULT_CONFIG.feedback.level_min_share) : [];
  const count = view.count === null ? (view.plan === 'eights' ? '도입' : '') : `${view.count} / 8`;
  const busy = phase.kind !== 'idle';
  return (
    <View style={s.root}>
      <View style={s.camera}>
        {permission === 'granted' && (
          <PoseCameraView style={StyleSheet.absoluteFill} active model="lite" detectorJson={DETECTOR}
            onPose={e => store.handlePose(e.nativeEvent)} onEngine={e => store.handleEngine(e.nativeEvent)} onError={e => store.handleError(e.nativeEvent.message)} />
        )}
        <SkeletonOverlay pose={view.pose} shares={view.usage.session?.segments ?? null} underused={usage?.underused ?? []}
          boxAspect={BOX_ASPECT} visibility={DEFAULT_CONFIG.pose.visibility_threshold} />
        <Text style={s.hud}>{hudText(view)}</Text>
      </View>
      <Text style={s.status} accessibilityLiveRegion="polite">{statusText(view, phase, now, playing)}</Text>
      <View style={s.head}>
        <View style={s.switch}>
          {(['8count', 'session'] as const).map(w => (
            <Pressable key={w} accessibilityRole="button" accessibilityState={{ selected: windowName === w }} onPress={() => setWindowName(w)} style={[s.switchItem, windowName === w && s.switchOn]}>
              <Text style={[s.switchText, windowName === w && s.switchTextOn]}>{w === '8count' ? '이번 8카운트' : '세션 전체'}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={s.count}>{count}</Text>
      </View>
      {!!PLAN_NOTE[view.plan] && <Text style={s.small}>{PLAN_NOTE[view.plan]}</Text>}
      {usage ? (
        <>
          <BodyUsageBars segments={usage.segments} underused={usage.underused} dim={dim} />
          <Text style={[s.body, dim && s.dim]}>높이  {(['low', 'mid', 'high'] as const).map(l => `${LEVEL_NAMES[l]} ${Math.round(usage.level[l] * 100)}`).join(' · ')}</Text>
          {targets.length > 0 && <Text style={[s.body, dim && s.dim]}>안 가본 쪽: {targets.map(t => label(t)).join(' · ')}</Text>}
        </>
      ) : <Text style={s.body}>트래킹이 시작되면 부위별 비율이 여기에 보여요.</Text>}
      {view.cue && <Text style={s.cue}>&quot;{view.cue.text}&quot;</Text>}
      <View style={s.actions}>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: playing || busy }} disabled={playing || busy} style={[s.primary, (playing || busy) && s.off]}
          onPress={() => dispatch({ type: 'press', nowMs: Date.now(), calibrated: store.calibrated, countdownMs: 1000 * DEFAULT_CONFIG.app.countdown_s })}>
          <Text style={s.primaryText}>춤 시작</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: phase.kind === 'countdown' }} disabled={phase.kind === 'countdown'} style={[s.secondary, phase.kind === 'countdown' && s.off]}
          onPress={() => { dispatch({ type: 'cancel' }); store.recalibrate(); }}>
          <Text style={s.secondaryText}>다시 맞추기</Text>
        </Pressable>
      </View>
      <Text style={s.small}>카메라 영상은 화면에만 보이고 저장하거나 보내지 않아요.</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { gap: 14 },
  camera: { width: '100%', aspectRatio: BOX_ASPECT, borderRadius: 24, overflow: 'hidden', backgroundColor: C.text },
  hud: { position: 'absolute', left: 12, bottom: 10, color: '#FFFFFF', fontSize: 10, fontVariant: ['tabular-nums'] },
  status: { color: C.text, fontSize: 15, fontWeight: '600' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  switch: { flexDirection: 'row', backgroundColor: C.card, borderRadius: 12, padding: 3 },
  switchItem: { paddingHorizontal: 12, minHeight: 36, borderRadius: 9, justifyContent: 'center' },
  switchOn: { backgroundColor: C.cardHi },
  switchText: { color: C.sub, fontSize: 12 },
  switchTextOn: { color: C.accent, fontWeight: '700' },
  count: { color: C.text, fontSize: 22, fontWeight: '600', fontVariant: ['tabular-nums'] },
  body: { color: C.sub, fontSize: 13, lineHeight: 20 },
  small: { color: C.dim, fontSize: 11, lineHeight: 17 },
  dim: { opacity: 0.45 },
  cue: { color: C.accent, fontSize: 15, lineHeight: 22, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: 10 },
  primary: { flex: 1, minHeight: 48, borderRadius: 14, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#FFFFFF', fontWeight: '700' },
  secondary: { flex: 1, minHeight: 48, borderRadius: 14, backgroundColor: C.cardHi, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: C.accent, fontWeight: '700' },
  off: { opacity: 0.4 },
  card: { backgroundColor: C.card, borderRadius: 20, padding: 20, gap: 10 },
  title: { color: C.text, fontSize: 16, fontWeight: '700' },
});
```

- [ ] **Step 5: `PlayerScreen.tsx`에 탭 붙이기**

다섯 군데를 고친다. 기존 줄은 들여쓰기를 바꾸지 않는다(diff를 작게).

5-1. import — `import { useEffect, useRef, useState } from 'react';`를 바꾼다:
```tsx
import { useEffect, useMemo, useRef, useState } from 'react';
```
`import { PlaybackSnapshot } from '../state/model';` 다음 줄에 추가:
```tsx
import CameraTab from '../components/tracking/CameraTab';
import { DEFAULT_CONFIG } from '../tracking/config';
import { LiveTrackingStore } from '../tracking/store';
import { planFor } from '../tracking/windows';

const TABS = [['mixer', '믹서'], ['camera', '카메라']] as const;
```

5-2. `  const [transportBusy, setTransportBusy] = useState(false);` 다음 줄에 추가:
```tsx
  const [tab, setTab] = useState<'mixer' | 'camera'>('mixer');
  // One tracking session per practice session; it outlives tab switches.
  const tracking = useMemo(() => new LiveTrackingStore(DEFAULT_CONFIG, { perfNowMs: () => performance.now() }), []);
```

5-3. `  }, [server, job, reloading, initial]);` 다음 줄에 추가:
```tsx
  useEffect(() => {
    tracking.setMusicSource(loadedPlayer ? () => ({ position: loadedPlayer.position, playing: loadedPlayer.playing }) : null);
    return () => tracking.setMusicSource(null);
  }, [tracking, loadedPlayer]);
  useEffect(() => {
    tracking.setPlan(planFor(analysis?.eights, analysis?.tempo ?? job.tempo, DEFAULT_CONFIG.aggregate.windows['8count_s']));
  }, [tracking, analysis, job.tempo]);
```

5-4. `  const seek = (time: number) => perform(p => p.seek(time));` 다음 줄에 추가:
```tsx
  // [춤 시작] plays only when stopped: StemPlayer.play() while playing would jump back to the paused position.
  const startPlayback = () => { if (!player.current?.playing) void perform(p => p.play()); };
```

5-5. JSX — `<View style={s.top}>…MY SESSION</Text></View>` 줄 바로 다음, `        <View style={s.hero}>` 앞에 넣는다:
```tsx
        <View style={s.tabs}>{TABS.map(([key, title]) => <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: tab === key }} onPress={() => setTab(key)} style={[s.tab, tab === key && s.tabOn]}><Text style={[s.tabText, tab === key && s.tabTextOn]}>{title}</Text></Pressable>)}</View>
        {tab === 'camera' && <CameraTab store={tracking} playing={playing} onPlay={startPlayback} />}
        {/* The mixer stays mounted (watch haptics keep running) and is only hidden on the camera tab. */}
        <View style={tab === 'mixer' ? undefined : s.hidden}>
```
그리고 `        {!!analysisNotice && <Text style={s.small}>{analysisNotice}</Text>}` 줄 다음에 닫는다:
```tsx
        </View>
```
"세션 마치고 기록 저장" 버튼과 footer는 두 탭에서 모두 보인다.

스타일 — `const s = StyleSheet.create({` 바로 다음 줄에 추가:
```tsx
  tabs: { flexDirection: 'row', backgroundColor: C.card, borderRadius: 14, padding: 4, marginBottom: 22 },
  tab: { flex: 1, minHeight: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  tabOn: { backgroundColor: C.cardHi },
  tabText: { color: C.sub, fontSize: 13, fontWeight: '600' },
  tabTextOn: { color: C.accent },
  hidden: { display: 'none' },
```

- [ ] **Step 6: 정적 검사와 번들 확인**

```powershell
npm run lint; npm run typecheck; npm run test:tracking; npm run test:audio
$out = "$env:TEMP\eight-export"
npx expo export --platform web --output-dir "$out\web"
npx expo export --platform android --output-dir "$out\android"
```
Expected: 모두 통과. 두 export가 성공해야 한다(웹에서는 `PoseCameraView`가 null이라 네이티브 모듈을 요청하지 않는다). export 결과는 레포 밖 임시 폴더에 둔다.

- [ ] **Step 7: 웹 화면 확인**

`npm run web`을 띄우고 브라우저에서 **새로운 시작 → 체험 음악 → 워치 없이 시작하기 → [카메라] 탭**을 연다. "카메라 트래킹은 Android 앱에서만 쓸 수 있어요"가 보여야 한다. [믹서] 탭으로 돌아오면 재생·레이어 조절이 그대로 동작해야 한다. 확인한 뒤 서버를 끈다.

- [ ] **Step 8: 실기기 빌드와 첫 확인 (USB로 연결한 갤럭시)**

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
npx expo prebuild --platform android --no-install --clean
npm run build:android
adb install -r android\app\build\outputs\apk\debug\app-debug.apk
adb reverse tcp:8081 tcp:8081
npx expo start --dev-client --localhost
```
(마지막 명령은 백그라운드로 띄운다.) 폰에서 앱을 열고 체험 음악 세션 → [카메라] 탭으로 간다.
- 에이전트가 확인할 것: 권한 창이 뜨는지, 허용 후 미리보기가 나오는지. `adb exec-out screencap -p > "$env:TEMP\camera-tab.png"`로 화면을 찍어 확인한다. `adb logcat -d -s PoseEngine FrontCamera ReactNativeJS`에 오류가 없어야 한다. HUD에 fps가 표시되어야 한다.
- **태양이 확인할 것**(에이전트는 결과를 받아 기록만 한다): 2.5–3m 앞에서 관절 선이 몸과 겹치는지(손 들기·기울기로 좌우 반전 확인), [춤 시작]이 5초 카운트다운 → 가만히 3초 → 음악 자동 재생으로 진행되는지, 춤추면 막대와 "안 가본 쪽"이 바뀌는지, 믹서 탭으로 가면 카메라가 꺼지고 돌아오면 다시 켜지는지, 일시정지하면 "일시정지 · 집계 멈춤"이 뜨는지.

- [ ] **Step 9: 커밋 (PR 3 지점)**

```powershell
git add package.json package-lock.json src/components/tracking src/screens/PlayerScreen.tsx
git commit -m "Add the camera tab to the practice session" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
여기까지가 PR 3이다. push·PR은 태양이 승인할 때만 한다.

---

### Task 13: 세션 기록에 트래킹 누적값 저장

**Files:**
- Create: `app/src/tracking/validate.ts`
- Test: `app/scripts/tracking/validate.test.cjs`, `app/scripts/test-library.cjs`(끝에 추가)
- Modify: `app/src/state/model.ts`, `app/src/state/validation.ts`, `app/src/screens/PlayerScreen.tsx`

**Interfaces:**
- Consumes: `SessionTracking`, `LEVELS`, `SEGMENT_NAMES`, `LiveTrackingStore.importTracking/exportTracking`
- Produces: `validTracking(x): x is SessionTracking`, `PlaybackSnapshot.tracking?: SessionTracking`(그래서 `Session.tracking`도 생긴다). 성원의 `checkpoint`가 스냅숏을 세션에 펼쳐 넣으므로 저장 경로는 그대로다.

- [ ] **Step 1: 실패하는 테스트 작성**

`app/scripts/tracking/validate.test.cjs`:
```js
const assert = require('node:assert/strict');
const { validTracking } = require('../load-ts.cjs')('src/tracking/validate.ts');

const seg = v => ({ head: v, torso: v, arm_l: v, arm_r: v, leg_l: v, leg_r: v });
const good = { version: 1, trackedMs: 40000, totals: { frames: 600, score: seg(10.5), observed: seg(600), levels: { low: 0, mid: 590, high: 10 } } };
assert.equal(validTracking(good), true);
const broken = [
  null, [], 'x',
  { ...good, version: 2 },
  { ...good, trackedMs: -1 },
  { ...good, trackedMs: Infinity },
  { ...good, totals: null },
  { ...good, totals: { ...good.totals, frames: '600' } },
  { ...good, totals: { ...good.totals, score: { ...seg(1), tail: 1 } } },
  { ...good, totals: { ...good.totals, score: { head: 1 } } },
  { ...good, totals: { ...good.totals, score: seg(-1) } },
  { ...good, totals: { ...good.totals, observed: seg(601) } },
  { ...good, totals: { ...good.totals, levels: { low: 0, mid: 700, high: 0 } } },
  { ...good, totals: { ...good.totals, levels: { low: 300, mid: 300, high: 300 } } },
];
broken.forEach((b, i) => assert.equal(validTracking(b), false, `broken #${i} must be rejected`));
```

`app/scripts/test-library.cjs` 맨 끝에 추가:
```js

// Session tracking totals (camera tab): old sessions still load, broken values are rejected.
const trackedProject = { id: 'p1', server: 'local', saved: true, updatedAt: 1, job: { id: 'demo-groove', name: 'demo', status: 'done', stage: 'done', progress: 1, createdAt: 1, config: { model: 'demo', shifts: 0, overlap: 0 } } };
const trackedSession = { id: 's1', projectId: 'p1', startedAt: 1, position: 0, duration: 16, listened: 40, master: 0.8, layerSeconds: {}, mix: {}, loop: null };
const perSegment = v => ({ head: v, torso: v, arm_l: v, arm_r: v, leg_l: v, leg_r: v });
const savedTracking = { version: 1, trackedMs: 40000, totals: { frames: 600, score: perSegment(10), observed: perSegment(600), levels: { low: 0, mid: 600, high: 0 } } };
const withSession = s => JSON.stringify({ ...empty, projects: [trackedProject], sessions: [s] });
assert.equal(decodeLibrary(withSession(trackedSession), empty).sessions[0].tracking, undefined, 'sessions saved before tracking still load');
assert.deepEqual(decodeLibrary(withSession({ ...trackedSession, tracking: savedTracking }), empty).sessions[0].tracking, savedTracking);
assert.throws(() => decodeLibrary(withSession({ ...trackedSession, tracking: { ...savedTracking, totals: { ...savedTracking.totals, observed: perSegment(601) } } }), empty));
console.log('PASS: session tracking totals load, round-trip and reject broken values');
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test:tracking; npm run test:library`
Expected: `validate.test.cjs`에서 FAIL(`ENOENT ... validate.ts`). `test:library`는 마지막 `assert.throws`에서 FAIL(아직 `tracking`을 검사하지 않음).

- [ ] **Step 3: `app/src/tracking/validate.ts` 작성**

```ts
import { LEVELS, SEGMENT_NAMES } from './segments';
import type { SessionTracking } from './types';

const count = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const exact = (o: unknown, keys: readonly string[], ok: (v: number) => boolean): o is Record<string, number> =>
  !!o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).length === keys.length &&
  keys.every(k => Object.prototype.hasOwnProperty.call(o, k) && count((o as Record<string, unknown>)[k]) && ok((o as Record<string, number>)[k]));

/** Saved tracking totals from disk or a backup: known keys only, finite counts, nothing above the frame count. */
export function validTracking(x: unknown): x is SessionTracking {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
  const s = x as { version?: unknown; trackedMs?: unknown; totals?: unknown };
  if (s.version !== 1 || !count(s.trackedMs) || !s.totals || typeof s.totals !== 'object') return false;
  const t = s.totals as { frames?: unknown; score?: unknown; observed?: unknown; levels?: unknown };
  if (!count(t.frames)) return false;
  const frames = t.frames as number;
  return exact(t.score, SEGMENT_NAMES, () => true)
    && exact(t.observed, SEGMENT_NAMES, v => v <= frames)
    && exact(t.levels, LEVELS, v => v <= frames)
    && LEVELS.reduce((sum, l) => sum + (t.levels as Record<string, number>)[l], 0) <= frames;
}
```

- [ ] **Step 4: 타입과 백업 검사 연결**

`app/src/state/model.ts`: `import type { LoopRange } from '../audio/StemPlayer';` 다음 줄에 추가:
```ts
import type { SessionTracking } from '../tracking/types';
```
그리고 `PlaybackSnapshot`을 바꾼다:
```ts
export type PlaybackSnapshot = {
  position: number; duration: number; mix: Mix; master: number;
  loop: LoopRange; listened: number; layerSeconds: Record<string, number>;
  tracking?: SessionTracking; // camera tab totals (src/tracking); absent until something was tracked
};
```

`app/src/state/validation.ts`: `import { analyzeTrace, parseTrace } from '../motion/analyze';` 다음 줄에 추가:
```ts
import { validTracking } from '../tracking/validate';
```
세션 검사의 끝 `&& (s.missionWeek === undefined || text(s.missionWeek))));`를 바꾼다:
```ts
    && (s.missionWeek === undefined || text(s.missionWeek)) && (s.tracking === undefined || validTracking(s.tracking))));
```

- [ ] **Step 5: PlayerScreen에서 저장·복원**

5-1. 스토어 생성(Task 12의 `useMemo`)을 바꾼다:
```tsx
  // One tracking session per practice session; it outlives tab switches.
  const tracking = useMemo(() => {
    const store = new LiveTrackingStore(DEFAULT_CONFIG, { perfNowMs: () => performance.now() });
    store.importTracking(initial?.tracking); // resumed session: keep counting from its saved totals
    return store;
  }, [initial]);
```

5-2. `const s = StyleSheet.create({` 바로 위에 추가:
```tsx
/** The playback snapshot plus the camera tab's totals, once anything was tracked (or restored). */
function withTracking(store: LiveTrackingStore, snap: PlaybackSnapshot): PlaybackSnapshot {
  const tracking = store.exportTracking();
  return tracking ? { ...snap, tracking } : snap;
}
```

5-3. 5초 저장 effect를 바꾼다(기존 두 줄 + deps):
```tsx
    const timer = setInterval(() => { if (latest.current.duration > 0) onSnapshot?.(withTracking(tracking, latest.current)); }, 5000);
    return () => { clearInterval(timer); if (latest.current.duration > 0) onSnapshot?.(withTracking(tracking, latest.current)); };
  }, [onSnapshot, tracking]);
```

5-4. 앱 비활성 effect에서 `if (latest.current.duration > 0) onSnapshot?.(latest.current);`를 `if (latest.current.duration > 0) onSnapshot?.(withTracking(tracking, latest.current));`로 바꾸고, 그 effect의 deps `[onSnapshot]`을 `[onSnapshot, tracking]`으로 바꾼다.

5-5. "세션 마치고 기록 저장" 버튼의 `onFinish({ ...latest.current, position: p.position, listened: listened.current, layerSeconds: { ...layerSeconds.current } });`를 바꾼다:
```tsx
onFinish(withTracking(tracking, { ...latest.current, position: p.position, listened: listened.current, layerSeconds: { ...layerSeconds.current } }));
```

- [ ] **Step 6: 통과 확인**

Run: `npm run test:tracking; npm run test:library; npm run lint; npm run typecheck`
Expected: 전부 통과. `test:library` 출력에 `PASS: session tracking totals load, round-trip and reject broken values`가 있어야 한다.

- [ ] **Step 7: 실기기 확인 (태양)**

Task 12 Step 8처럼 빌드·설치한다. JS만 바뀌었으면 dev 서버 새로고침으로 충분하다. 확인할 것: 카메라 탭에서 30초 이상 춤춘 뒤 "저장하고 나가기" → 홈에서 같은 세션 이어하기 → [카메라] 탭 "세션 전체" 막대가 이전 값에서 이어지는지. 이어서 "세션 마치고 기록 저장".

- [ ] **Step 8: 커밋**

```powershell
git add src/tracking/validate.ts scripts/tracking/validate.test.cjs scripts/test-library.cjs src/state/model.ts src/state/validation.ts src/screens/PlayerScreen.tsx
git commit -m "Save camera tracking totals with the practice session" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: 분석 탭 "카메라로 본 몸 사용" 카드

**Files:**
- Modify: `app/src/tracking/insights.ts`, `app/scripts/tracking/insights.test.cjs`
- Create: `app/src/components/tracking/TrackingInsightCard.tsx`
- Modify: `app/src/app/analysis.tsx`

**Interfaces:**
- Consumes: `unexploredTargets`(Task 11), `emptyTotals`·`mergeTotals`·`snapshotFromTotals`(Task 6), `shareOptions`·`DEFAULT_CONFIG`, `BodyUsageBars`(Task 12), `Session.tracking`(Task 13)
- Produces: `Unexplored {target, count}`, `TrackingInsights {sessions, trackedMs, segments, level, unexplored}`, `trackingInsights(saved, cfg?): TrackingInsights | null`, `TrackingInsightCard({sessions})`

- [ ] **Step 1: 실패하는 테스트 추가** — `app/scripts/tracking/insights.test.cjs`

첫 줄의 require를 바꾼다:
```js
const { unexploredTargets, trackingInsights } = require('../load-ts.cjs')('src/tracking/insights.ts');
const { close } = require('./helpers.cjs');
```
파일 끝에 추가:
```js
const seg = (o = {}) => ({ head: 0, torso: 0, arm_l: 0, arm_r: 0, leg_l: 0, leg_r: 0, ...o });
const every = v => seg({ head: v, torso: v, arm_l: v, arm_r: v, leg_l: v, leg_r: v });
// arms only while standing: legs, head and torso quiet; low and high unexplored
const armsOnly = { version: 1, trackedMs: 60000, totals: { frames: 100, score: seg({ arm_l: 100, arm_r: 100 }), observed: every(100), levels: { low: 0, mid: 100, high: 0 } } };
// everything moving, half of it low
const allLow = { version: 1, trackedMs: 40000, totals: { frames: 100, score: every(100), observed: every(100), levels: { low: 50, mid: 50, high: 0 } } };
const short = { ...armsOnly, trackedMs: 29000 };

assert.equal(trackingInsights([undefined, short]), null, 'nothing tracked for 30 s yet');
const r = trackingInsights([armsOnly, allLow, undefined, short]);
assert.equal(r.sessions, 2);
assert.equal(r.trackedMs, 100000);
close(r.segments.arm_l, 0.25);
close(r.segments.leg_l, 0.125);
close(r.level.low, 0.25);
close(r.level.mid, 0.75);
assert.deepEqual(r.unexplored, [
  { target: 'high', count: 2 },
  { target: 'low', count: 1 },
  { target: 'leg_l', count: 1 },
  { target: 'leg_r', count: 1 },
  { target: 'torso', count: 1 },
  { target: 'head', count: 1 },
], 'most often unexplored first, ties: levels then limbs');
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test:tracking`
Expected: `insights.test.cjs`에서 FAIL (`trackingInsights is not a function`).

- [ ] **Step 3: `app/src/tracking/insights.ts`를 아래로 교체**

```ts
import { DEFAULT_CONFIG, shareOptions, type TrackingConfig } from './config';
import { emptyTotals, mergeTotals, snapshotFromTotals } from './usage';
import type { CueTarget, Level, Segment, SessionTracking, UsageTotals } from './types';

/** Not explored yet: underused parts, then low / high below `levelMinShare` (only when level was judged at all). */
export function unexploredTargets(underused: Segment[], level: Record<Level, number>, levelMinShare: number): CueTarget[] {
  const judged = level.low + level.mid + level.high > 0;
  return [...underused, ...(judged ? (['low', 'high'] as const).filter(l => level[l] < levelMinShare) : [])];
}

export type Unexplored = { target: CueTarget; count: number };
export type TrackingInsights = { sessions: number; trackedMs: number; segments: Record<Segment, number>; level: Record<Level, number>; unexplored: Unexplored[] };

const ORDER: CueTarget[] = ['low', 'high', 'leg_l', 'leg_r', 'arm_l', 'arm_r', 'torso', 'head'];

/**
 * Analysis tab: body use over the sessions tracked at least app.min_tracked_s, and how many of them
 * left each part / level unexplored. Counts of facts only, no score.
 */
export function trackingInsights(saved: (SessionTracking | undefined)[], cfg: TrackingConfig = DEFAULT_CONFIG): TrackingInsights | null {
  const used = saved.filter((s): s is SessionTracking => !!s && s.trackedMs >= 1000 * cfg.app.min_tracked_s);
  if (!used.length) return null;
  const opts = shareOptions(cfg), counts = new Map<CueTarget, number>();
  let sum: UsageTotals = emptyTotals();
  for (const s of used) {
    sum = mergeTotals(sum, s.totals);
    const snap = snapshotFromTotals(s.totals, opts);
    for (const t of unexploredTargets(snap.underused, snap.level, cfg.feedback.level_min_share)) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const all = snapshotFromTotals(sum, opts);
  const unexplored = [...counts]
    .map(([target, count]) => ({ target, count }))
    .sort((a, b) => b.count - a.count || ORDER.indexOf(a.target) - ORDER.indexOf(b.target));
  return { sessions: used.length, trackedMs: used.reduce((a, s) => a + s.trackedMs, 0), segments: all.segments, level: all.level, unexplored };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm run test:tracking`
Expected: 전부 `PASS`.

- [ ] **Step 5: `app/src/components/tracking/TrackingInsightCard.tsx` 작성**

```tsx
import { Text, View } from 'react-native';
import type { Session } from '../../state/model';
import { trackingInsights } from '../../tracking/insights';
import { label } from '../../tracking/phrases';
import { C, fmtTime } from '../../theme';
import { Card, Icon, ui } from '../../ui/Kit';
import BodyUsageBars from './BodyUsageBars';

const LEVEL_NAMES = { low: '낮음', mid: '중간', high: '높음' } as const;

/** Analysis tab: what the camera tab saw over the chosen period. Facts and counts, never a score. */
export default function TrackingInsightCard({ sessions }: { sessions: Session[] }) {
  const insight = trackingInsights(sessions.map(s => s.tracking));
  if (!insight) return (
    <Card>
      <Icon name="body-outline" color={C.dim} size={28} />
      <Text style={ui.h3}>카메라로 본 몸 사용</Text>
      <Text style={ui.body}>세션의 카메라 탭에서 춤추면 기록이 쌓여요.</Text>
    </Card>
  );
  return (
    <Card>
      <View style={ui.between}>
        <Text style={ui.h3}>카메라로 본 몸 사용</Text>
        <Text style={ui.pill}>{insight.sessions}개 세션 · {fmtTime(insight.trackedMs / 1000)}</Text>
      </View>
      <BodyUsageBars segments={insight.segments} underused={[]} />
      <Text style={ui.body}>높이  {(['low', 'mid', 'high'] as const).map(l => `${LEVEL_NAMES[l]} ${Math.round(insight.level[l] * 100)}%`).join(' · ')}</Text>
      {insight.unexplored.length > 0 && (
        <View style={{ gap: 6 }}>
          <Text style={ui.h3}>자주 안 가본 쪽</Text>
          {insight.unexplored.slice(0, 4).map(u => <Text key={u.target} style={ui.body}>{label(u.target)} · {insight.sessions}개 세션 중 {u.count}번</Text>)}
        </View>
      )}
      <Text style={ui.small}>카메라 탭에서 음악을 재생한 동안의 부위·높이 비율이에요. 잘하고 못함을 뜻하지 않아요.</Text>
    </Card>
  );
}
```

- [ ] **Step 6: 분석 탭에 붙이기** — `app/src/app/analysis.tsx`

import 추가(`import { layerShares } from '../state/model';` 다음 줄):
```tsx
import TrackingInsightCard from '../components/tracking/TrackingInsightCard';
```
`<Section title="Music · 음악 레이어" />` 바로 앞에 넣는다(성원의 Body 카드 다음, Music 앞):
```tsx
<Section title="Body · 카메라 트래킹" /><TrackingInsightCard sessions={sessions} />
```
`sessions`는 이미 기간 필터(최근 7일/전체)가 적용된 목록이다.

- [ ] **Step 7: 검사**

```powershell
npm run lint; npm run typecheck; npm run test:tracking; npm run test:library
npx expo export --platform web --output-dir "$env:TEMP\eight-export\web"
```
웹(`npm run web`)에서 분석 탭을 열면 "세션의 카메라 탭에서 춤추면 기록이 쌓여요." 카드가 보이고, 성원의 카드들은 그대로여야 한다. 실기기에서는 Task 13 Step 7에서 30초 이상 트래킹한 세션이 카드에 나와야 한다(태양 확인).

- [ ] **Step 8: 커밋**

```powershell
git add src/tracking/insights.ts scripts/tracking/insights.test.cjs src/components/tracking/TrackingInsightCard.tsx src/app/analysis.tsx
git commit -m "Add the camera tracking card to the analysis tab" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: 문서

**Files:**
- Create: `docs/TRACKING.md` (레포 루트의 `docs/`)
- Modify: `docs/FEATURE_STATUS.md`(끝에 섹션 추가), `README.md`(끝에 섹션 추가)

**Interfaces:**
- Consumes: Task 1–14의 결과
- Produces: 팀원이 읽는 원칙·구조·메시지·명령·실기기 표

- [ ] **Step 1: `docs/TRACKING.md` 작성**

````markdown
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
| `modules/pose-camera/` | Kotlin Expo 모듈. CameraX 전면 카메라 미리보기 + MediaPipe Pose(lite, GPU→CPU) → `onPose` 이벤트(관절 좌표·시각만). 외부 카메라는 `FrameSource` 구현을 하나 더 만들면 된다 |
| `src/tracking/` | React 없는 TypeScript 로직: 스무딩, 캘리브레이션, 부위 활동, 높이, 집계 창, 제안, 세션, 스토어. `scripts/load-ts.cjs`로 node에서 바로 테스트 |
| `src/components/tracking/` | 카메라 탭, 관절 선 오버레이, 부위 막대, 분석 탭 카드 |
| `src/tracking/config.ts` | 모든 임계값. id403 `config/default.yaml`과 공유하는 섹션은 키·값이 같아야 한다(정답 테스트가 검사) |

## 명령 (app/에서)
```
npm run models          # MediaPipe lite 모델 받기 (git 제외, 첫 빌드 전에 한 번)
npm run test:tracking   # 트래킹 로직 테스트 + id403 정답 비교
npx expo prebuild --platform android --no-install
npm run build:android   # Windows·Mac 모두
```
정답 데이터 다시 만들기 (id403 로직을 바꾼 경우만):
```
cd <id403>
.venv\Scripts\python.exe tools\export_golden.py --out <EIGHT>\app\scripts\fixtures\tracking
```

## 화면과 동작
- 세션 화면 위 [믹서 | 카메라] 탭. 카메라는 카메라 탭이 보일 때만 켜진다. 믹서는 탭을 바꿔도 그대로 동작한다.
- [춤 시작]: 5초 카운트다운 → (처음이면) 가만히 3초 → 음악 자동 재생. [다시 맞추기]: 캘리브레이션만 다시 하고 세션 누적은 유지한다.
- 음악이 재생 중이고 트래킹 중일 때만 집계·제안한다. 제안은 글자로 8초 보인다(음성 없음).
- 8카운트 창: 서버 분석(`analysis.eights`) → 없으면 BPM 8박 → 없으면 4초 단위. 반복 구간 되감기·뒤로 탐색·곡 처음으로 돌아가기에서 새 창이 시작된다.
- 세션 기록: `Session.tracking = { version: 1, trackedMs, totals }`(5초마다 저장). 이어하기 하면 누적이 이어진다. 분석 탭의 "카메라로 본 몸 사용" 카드는 30초 이상 트래킹한 세션을 합친다.

## 메시지 형식 (하드웨어·프로젝터로 보낼 때 그대로)
`src/tracking/types.ts`가 원본이고, 필드는 id403 `docs/message-schema.md`와 같다.

| 종류 | 빈도 | 필드 |
|---|---|---|
| `UsageMessage` (type 없음) | 10 Hz × 창 3개 | `t`, `window` (`8count` · `recent` · `session`), `segments` {head, torso, arm_l, arm_r, leg_l, leg_r}, `level` {low, mid, high}, `current_level`, `underused`, `tracking_ok` |
| `status` | 10 Hz | `t`, `state` (waiting · calibrating · tracking), `progress`, `session_s` |
| `feedback` | 드물게 | `t`, `kind` (segment_unexplored · level_unexplored · explored), `target`, `text` |
| `pose` | 프레임마다 | `t`, `aspect`, `lm` (33 × [x, y, visibility], 거울 반전 안 함) |
| `perf` | 1 Hz | `t`, `source_fps`, `pose_fps`, `detect_rate`, `lat_ms` {capture_pose, pipeline} {p50, p95}, `capture_from`, `model`, `delegate`, `errors` |

- `window: "8count"`은 이 앱에서 "곡의 현재 8카운트"다(id403에서는 최근 4초).
- 왼쪽·오른쪽 = 춤추는 사람 본인의 왼쪽·오른쪽.

## 실기기 체크리스트 (갤럭시)
| 항목 | 결과 | 날짜·기종 | 메모 |
|---|---|---|---|
| 카메라 권한 허용 / 거부 / 설정에서 다시 허용 | | | |
| 미리보기와 관절 선이 겹침 (손 들기·기울기로 좌우 확인) | | | |
| [춤 시작]: 카운트다운 → 가만히 3초 → 자동 재생 | | | |
| 사람이 안 잡히면 "카메라 앞에 서 주세요"로 기다림 | | | |
| 카운트다운 중 dock으로 재생 → 자동 재생을 또 하지 않음 | | | |
| 탭 전환 시 카메라 꺼짐·켜짐, 백그라운드 갔다 오기 | | | |
| 반복 구간·탐색 시 8카운트 창이 새로 시작 | | | |
| 일시정지 → "일시정지 · 집계 멈춤", 다시 재생하면 이어짐 | | | |
| 저장하고 나가기 → 이어하기 → 누적 이어짐 | | | |
| 세션 마치기 → 분석 탭 카드 | | | |

## 측정 (lite)
| 기종 | delegate | pose_fps | capture_pose p50 / p95 (ms) | detect_rate | id403 A1 (같은 기종) |
|---|---|---|---|---|---|
| | | | | | |
````

- [ ] **Step 2: `docs/FEATURE_STATUS.md` 끝에 추가**

```markdown

## 카메라 트래킹 (2026-10-14~, 태양)

세션 화면에 [카메라] 탭을 추가했다. 자세한 내용은 [TRACKING.md](TRACKING.md).

| 영역 | 구현 내용 | 범위와 데이터 |
|---|---|---|
| 카메라 탭 | 전면 카메라 미리보기 + 관절 선, 부위 비율·높이·안 가본 쪽, 글자 제안, [춤 시작]·[다시 맞추기] | Android만. 영상은 저장·전송하지 않음 |
| 음악 싱크 | 서버 분석의 8카운트 → BPM → 4초 순으로 집계 창 결정 | 재생 중에만 집계 |
| 기록 | 세션에 집계 숫자(`tracking`) 저장, 이어하기, 분석 탭 "카메라로 본 몸 사용" | 관절 좌표·영상 없음. 30초 이상 트래킹한 세션만 |

남은 일: 실기기 체크리스트와 측정표(TRACKING.md), 사후 분석(영상 → 좌표)과 움직임 스튜디오 연결, 외부 카메라 입력, 하드웨어로 메시지 전송, 음성·워치 제안.
```

- [ ] **Step 3: `README.md` 끝에 추가**

```markdown

## 카메라 트래킹 (2026-10-14~)

세션 화면의 **[카메라] 탭**에서 폰을 세워 두고 춤추면, 폰이 몸의 어느 부위·높이를 썼는지 곡의 8카운트에 맞춰 보여주고 아직 안 가본 쪽을 제안합니다. Android 전용이고 영상은 저장하지 않습니다. 첫 빌드 전에 `cd app && npm run models`로 자세 인식 모델을 받으세요. 자세한 내용: [docs/TRACKING.md](docs/TRACKING.md).
```

- [ ] **Step 4: 커밋 (PR 4 지점)**

```powershell
cd C:\Users\hotsu\EIGHT
git add docs/TRACKING.md docs/FEATURE_STATUS.md README.md
git commit -m "Document camera tracking for the team" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### 마무리 확인

- [ ] **전체 검사**

```powershell
cd C:\Users\hotsu\EIGHT\app
npm run lint; npm run typecheck
npm run test:tracking; npm run test:audio; npm run test:haptics; npm run test:upload; npm run test:library; npm run test:motion
git log --oneline main..body-tracking
git status --short
```
Expected: 모든 검사 통과. 커밋 13개 정도가 `body-tracking`에만 있고, 작업 트리는 깨끗하다(모델 파일과 `android/`는 git 제외). `git log origin/main..main`은 비어 있어야 한다(main에는 아무것도 하지 않았음).

- [ ] **태양에게 보고**

보고 내용: 끝난 Task, 실기기 확인 결과(Task 12·13·14에서 태양이 확인한 것과 아직 못 한 것), `docs/TRACKING.md` 측정표에 채운 값, 계획과 달라진 점. PR 1–4로 나눠 push할지 묻는다. **push·PR은 답을 받은 뒤에만 한다.**
