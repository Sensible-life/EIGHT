# 인식 코드 통일과 웹캠 디스플레이 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 디스플레이 페이지 하나가 웹캠으로 춤을 읽고(폰과 같은 인식 코드), 캐릭터가 부족한 팔다리·높이·좌우를 묻고 머리 위 O로 '예'를 받아 제안하고 "You tried it"으로 알아본다.

**Architecture:** `app/src/tracking/`이 하나뿐인 인식 코드다. 웹캠 라벨(`movement.js`)을 `labels.ts`로 옮기고, 디스플레이용 입구 `display.ts`를 esbuild로 `server/app/static/tracking.js`에 묶어 서버 HTML 페이지가 불러 쓴다. 서버(`projection.py`, `display_agent.py`)는 값을 검사하고 캐릭터가 언제 말할지만 정한다.

**Tech Stack:** TypeScript(React 없음, node 테스트 `load-ts.cjs`), esbuild, FastAPI, MediaPipe Tasks Vision 0.10.14(브라우저, CDN), 바닐라 JS 페이지.

**Spec:** `docs/superpowers/specs/2026-11-23-unified-tracking-display-design.md`

## Global Constraints

- **커밋하지 않는다.** 사용자가 요청할 때만 커밋한다(사용자 규칙). 각 작업은 "확인" 단계로 끝난다.
- 작업 브랜치: `main`에서 딴 `unified-display`. 지금 `camera-ui`에 있는 커밋 안 한 변경(`movement.html`, `movement.js`, `projection.py`)과 문서를 그대로 들고 간다.
- `app/src/tracking/`과 `app/src/projection/`의 모듈은 React와 외부 패키지를 불러오지 않는다(`load-ts.cjs`는 상대 경로 `.ts`만 푼다).
- id403과 공유하는 설정 섹션과 정답 테스트(`golden.test.cjs`)는 건드리지 않는다. 새 값은 `config.ts`의 새 섹션 `labels`, `answer`, `targets`에 둔다.
- 디스플레이 글자는 모두 영어다.
- 영상과 관절 좌표는 페이지 밖으로 나가지 않는다. 중계는 검사한 단어와 숫자만 넘긴다. 패킷 하나는 4096바이트 미만(`projection.py`가 그보다 큰 것을 버린다).
- MediaPipe: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14`, 모델 `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task`(지금 쓰는 주소 그대로).
- 서버는 `./run.sh`만으로 돈다. 묶음 파일 `server/app/static/tracking.js`는 저장소에 넣는 생성 파일이다.
- 이 컴퓨터(Windows)에는 `librosa`가 없어 `app.main`을 불러오는 기존 서버 테스트가 돌지 않는다. 새 서버 테스트는 `projection` 라우터만 올린 작은 FastAPI 앱으로 한다.
- 테스트 명령: `cd app && npm run test:tracking`, `cd app && npx tsc --noEmit`, `cd server && python -m unittest tests.test_webcam_guide -v`.

## Review Focus

1. **카메라 권한 거부·웹캠 없음** → 페이지는 뜨고 "Camera permission is needed" 또는 "No camera: choose a dance video"를 보이며 영상 파일 입력이 동작한다. (Task 5 확인 단계)
2. **발이 화면 밖(다리 잘림)** → 다리를 "안 썼다"고 짚지 않는다. (Task 3 `lacking excludes legs that are out of frame`)
3. **영상 파일이 처음으로 돌아감(시간이 거꾸로)** → 트래커와 라벨이 처음부터 다시 맞춘다. (Task 3 `time going back resets`)
4. **묻는 중에 시연자가 화면 밖으로 나감** → 질문을 거두고 O 유지 시간도 0으로. (Task 2 `null pose resets the hold`, Task 4 `leaving the frame withdraws the question`)
5. **같은 방에 디스플레이 탭 두 개 / 새로고침** → 웹캠 단독은 새로고침마다 새 방이라 막히지 않고, 폰 세션에 두 번째 웹캠이 붙으면 "This phone session already has a camera"를 보인다. (Task 5 확인 단계)

---

### Task 1: 웹캠 라벨을 `labels.ts`로 옮기기

**Files:**
- Create: `app/src/tracking/labels.ts`, `app/src/tracking/webEvent.ts`(4ff2a17에서 되살림), `app/scripts/tracking/labels.test.cjs`, `app/scripts/tracking/webEvent.test.cjs`(4ff2a17에서 되살림)
- Modify: `app/src/tracking/config.ts`(새 섹션 `labels`)
- Source to port: `server/app/movement.js`(지금 작업 트리), `server/tests/movement.test.mjs`

**Interfaces:**
- Produces:
  - `webPoseEvent(f: WebFrame): PoseEvent`, `type WebLandmark`, `type WebFrame` — 4ff2a17의 `app/src/tracking/webEvent.ts`와 같다(`git show 4ff2a17:app/src/tracking/webEvent.ts`).
  - `type Zone = 'left' | 'center' | 'right'`
  - `type LabelFrame = { tMs: number; image: [number, number][]; visibility: number[]; aspect: number; musicT: number | null; beatS: number | null }`
  - `type PartLabel = { kind: 'hold'|'reach'|'circle'|'swing'|'shake'|'shift'|'travel'|'jump'|'drop'|null; speed: 'still'|'slow'|'medium'|'fast'|null; size: 'small'|'medium'|'large'|null; texture: 'smooth'|'sharp'|null; toward: 'up'|'side'|'down'|null; timing: 'on beat'|'off beat'|'mixed'|null }`
  - `type SpaceLabel = { zone: Zone; level: 'low'|'mid'|'high'; depth: 'near'|'home'|'far'; weight: Zone; x: number; y: number; width: number }`
  - `type MovementLabel = { speed; size; direction: 'in place'|'left'|'right'|'up'|'down'|'side to side'|'up-down'; texture; lead: 'head'|'torso'|'arm_l'|'arm_r'|'leg_l'|'leg_r'|'whole body'|null; timing; values: { speed: number; reach: number; travel: [number, number] }; parts: Record<'arm_l'|'arm_r'|'leg_l'|'leg_r'|'torso', PartLabel>; space: SpaceLabel | null }` (전체 speed·size는 null 아님)
  - `class MovementLabeler { constructor(cfg: TrackingConfig['labels'] = DEFAULT_CONFIG.labels); add(f: LabelFrame): void; label(): MovementLabel | null; reset(): void; get calibrated(): boolean; zoneShares(windowS: number): Record<Zone, number> | null }`
  - `DEFAULT_CONFIG.labels` = `movement.js`의 `MOVEMENT_DEFAULTS` 값 그대로 + `min_seen: 0.5`, `zone_history_s: 30`

- [ ] **Step 1: 브랜치를 딴다**

Run: `git switch -c unified-display main`
Expected: `Switched to a new branch 'unified-display'`, `git status`에 커밋 안 한 변경이 그대로 있다.

- [ ] **Step 2: `webEvent.ts`와 그 테스트를 되살린다**

Run: `git show 4ff2a17:app/src/tracking/webEvent.ts > app/src/tracking/webEvent.ts && git show 4ff2a17:app/scripts/tracking/webEvent.test.cjs > app/scripts/tracking/webEvent.test.cjs`
Expected: 두 파일이 생긴다.

- [ ] **Step 3: 실패하는 테스트 `labels.test.cjs`를 쓴다**

`server/tests/movement.test.mjs`의 모든 경우를 CommonJS로 옮긴다(`figure`, `shift`, `run` 도우미 포함, `load('src/tracking/labels.ts').MovementLabeler`, `label().body` 관련 단언은 없다). 여기에 다음을 더한다:

```js
{ // both arms swing the same; the left arm (13, 15) is hidden while moving: unknown, not 'hold'
  const swing = (t, P) => { const s = Math.sin(2 * Math.PI * t); P[16][0] -= 0.12 * s; P[14][0] -= 0.06 * s; P[15][0] += 0.12 * s; P[13][0] += 0.06 * s; };
  const m = run(swing, { hide: i => (i >= STILL * 30 ? [13, 15] : []) });
  assert.equal(m.parts.arm_l.kind, null, JSON.stringify(m.parts.arm_l));
  assert.equal(m.parts.arm_l.speed, null);
  assert.notEqual(m.parts.arm_r.kind, 'hold');
  assert.notEqual(m.lead, 'arm_l');
}
{ // zone shares over time: 3 s still at home, then walks to their left and stays
  const c = runLabeler(t => (P => shift(P, t > 3 ? 0.3 : 0, 0)), { seconds: 10 });
  const z = c.zoneShares(30);
  assert.ok(z.left > 0.5 && Math.abs(z.left + z.center + z.right - 1) < 1e-9, JSON.stringify(z));
  assert.equal(new MovementLabeler().zoneShares(30), null, 'not calibrated: no zones');
}
```

(`runLabeler`는 `run`과 같되 `label()` 대신 분류기 자체를 돌려주는 도우미.)

- [ ] **Step 4: 실패를 확인한다**

Run: `cd app && node scripts/tracking/labels.test.cjs`
Expected: FAIL — `Cannot find module` 또는 `labels.ts` 없음.

- [ ] **Step 5: `config.ts`에 `labels` 섹션을 더하고 `labels.ts`를 쓴다**

`movement.js`를 TS로 옮기되 바꾸는 것은 셋뿐이다:
1. **가려진 관절을 이어 붙이지 않는다**: 안 보인 관절은 그 프레임의 `rel`에 넣지 않는다. 속도 열은 양쪽 프레임에 다 있는 쌍만 쓰고, 한 부위에서 그런 쌍이 창의 `min_seen`(0.5) 미만이면 그 부위는 `{ kind: null, speed: null, size: null, texture: null, toward: null, timing: null }`이고 `lead` 후보와 전체 요약에서 빠진다.
2. `body` 출력을 없앤다(팔다리 비율은 Task 3에서 트래커 값으로 낸다).
3. **구역 기록**: 캘리브레이션 뒤 프레임마다 `{ t, zone }`을 `zone_history_s`(30초)만큼 쌓고, `zoneShares(windowS)`는 마지막 `windowS`초 동안 각 구역에 있던 시간 비율(프레임 간격으로 가중)을 낸다. 캘리브레이션 전이면 `null`. `reset()`이 기록도 지운다.

- [ ] **Step 6: 통과를 확인한다**

Run: `cd app && npm run test:tracking && npx tsc --noEmit`
Expected: `PASS: labels.test.cjs`, `PASS: webEvent.test.cjs`, 기존 테스트 전부 PASS(정답 비교 포함), tsc 오류 없음.

- [ ] **Step 7: 확인** — `git status`에 위 파일만 새로 생기고 바뀐다. 커밋하지 않는다.

---

### Task 2: 머리 위 O 알아보기 (`answer.ts`)

**Files:**
- Create: `app/src/tracking/answer.ts`, `app/scripts/tracking/answer.test.cjs`
- Modify: `app/src/tracking/config.ts`(새 섹션 `answer: { hold_s: 3, visibility: 0.6, wrist_gap: 0.6, head_top: 0.3 }`)

**Interfaces:**
- Consumes: `PoseFrame`(types.ts)
- Produces:
  - `isOverheadO(pose: PoseFrame, aspect: number, cfg: TrackingConfig['answer']): boolean`
  - `class OverheadAnswer { constructor(cfg = DEFAULT_CONFIG.answer); update(pose: PoseFrame | null, aspect: number, asking: boolean, tMs: number): { progress: number; yes: boolean }; reset(): void }` — `progress`는 0..1

`isOverheadO` 조건(이미지 좌표, y는 아래로, x에는 `aspect`를 곱해 정사각 단위로): 관절 0, 11–16, 23, 24가 모두 `visibility` 이상. `T` = 어깨 중점–골반 중점 거리. 머리 꼭대기 `headTopY = nose.y − head_top·T`. 두 손목 y < `headTopY`, 두 손목 사이 거리 ≤ `wrist_gap·T`, 두 팔꿈치 y < 같은 쪽 어깨 y, 두 팔꿈치가 같은 쪽 손목보다 몸 중심선(어깨 중점 x)에서 더 멀다.

`OverheadAnswer.update` 규칙: `asking`이 거짓이면 유지 시간 0, `armed = false`. `asking`이 참인 동안 O가 아닌 프레임을 한 번 보면 `armed = true`. `armed`이고 O인 프레임이 이어지면 유지 시간이 늘고, O가 아니거나 `pose`가 null이면 0으로. 유지 시간 ≥ `hold_s`이면 그 한 번만 `yes: true`를 내고 `armed = false`.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`helpers.cjs`의 `standingImage()`/`frame()`으로 서 있는 사람을 만들고, O 자세는 손목 15·16을 머리 위(코보다 0.12 위)에서 서로 0.04 떨어지게, 팔꿈치 13·14를 어깨보다 위·바깥에 둔다. 30fps로 돌린다.

```js
assert.equal(isOverheadO(oPose, 0.75, CFG), true, 'O over the head');
assert.equal(isOverheadO(armsUpApart, 0.75, CFG), false, 'arms straight up, hands apart');
assert.equal(isOverheadO(clapAtChest, 0.75, CFG), false, 'hands together at the chest');
assert.equal(feed(['stand', 1], ['O', 3.05], { asking: true }).yesAt !== null, true, 'held 3 s while asking: yes');
assert.equal(feed(['stand', 1], ['O', 2.5], { asking: true }).yesAt, null, '2.5 s is not enough');
assert.equal(feed(['O', 5], { asking: true }).yesAt, null, 'an O made before the question does not count');
assert.equal(feed(['stand', 1], ['O', 3.05], { asking: false }).yesAt, null, 'not asking: no answer');
assert.equal(feed(['stand', 1], ['O', 7], { asking: true }).yesCount, 1, 'holding on does not answer twice');
assert.equal(feed(['stand', 1], ['O', 2], ['none', 0.1], ['O', 2], { asking: true }).yesAt, null, 'null pose resets the hold');
assert.equal(feed(['stand', 1], ['circles', 6], { asking: true }).yesAt, null, 'arm circles are not an answer');
```

(`feed(...segments, opts)`은 테스트 안의 도우미: 구간별 자세를 30fps로 넣고 첫 `yes`의 시각과 `yes` 횟수를 돌려준다.)

- [ ] **Step 2: 실패를 확인한다** — Run: `cd app && node scripts/tracking/answer.test.cjs` / Expected: FAIL(모듈 없음).

- [ ] **Step 3: `answer.ts`를 위 규칙대로 쓴다.**

- [ ] **Step 4: 통과를 확인한다** — Run: `cd app && npm run test:tracking && npx tsc --noEmit` / Expected: `PASS: answer.test.cjs`, 나머지 그대로 PASS.

- [ ] **Step 5: 확인** — 커밋하지 않는다.

---

### Task 3: 부족·해봄 판단, 디스플레이 입구, 묶음 파일

**Files:**
- Create: `app/src/tracking/targets.ts`, `app/src/tracking/display.ts`, `app/scripts/build-display.cjs`, `app/scripts/tracking/targets.test.cjs`, `app/scripts/tracking/display.test.cjs`, `app/scripts/tracking/bundle.test.cjs`, `server/app/static/tracking.js`(생성)
- Modify: `app/src/tracking/config.ts`(새 섹션 `targets: { zone_min_share: 0.1, zone_explored_share: 0.2 }`), `app/package.json`(devDependency `esbuild` 정확한 버전, 스크립트 `"build:display": "node scripts/build-display.cjs"`)

**Interfaces:**
- Consumes: Task 1 `MovementLabeler`, `MovementLabel`, `Zone`, `webPoseEvent`; Task 2 `OverheadAnswer`; 기존 `LiveSession`(session.ts), `poseFromEvent`(store.ts), `ImageHeatmap`(projection/heatmap.ts), `SKELETON_EDGES`(segments.ts)
- Produces:
  - `type Target = 'arm_l'|'arm_r'|'leg_l'|'leg_r'|'low'|'high'|'left'|'right'`, `TARGET_ORDER: Target[]`(이 순서)
  - `ringShares(usage: UsageMessage | undefined): { upper: number; lower: number } | null` — `tracking_ok`가 아니거나 팔다리 합이 0이면 null. 값은 소수 셋째 자리 반올림, `upper + lower = 1`.
  - `lackingTargets(recent: UsageMessage | undefined, zones: Record<Zone, number> | null, cfg: TrackingConfig): Target[]` — `recent.tracking_ok`가 아니면 `[]`. 팔다리: `recent.underused` 중 `cfg.feedback.segment_targets`에 있는 것. 높이: 높이 합 > 0일 때 `low`/`high` 중 `< cfg.feedback.level_min_share`. 좌우: `zones`가 있으면 `left`/`right` 중 `< cfg.targets.zone_min_share`. 결과는 `TARGET_ORDER` 순.
  - `exploredTargets(eight: UsageMessage | undefined, zones: Record<Zone, number> | null, cfg: TrackingConfig): Target[]` — 팔다리 `≥ cfg.feedback.segment_explored_ratio / 6`, 높이 `≥ cfg.feedback.level_explored_share`, 좌우 `≥ cfg.targets.zone_explored_share`.
  - `type DisplayPacket = { active: boolean; calibrated: false; cells: number[]; source: 'webcam' | 'phone'; movement?: { speed; size; direction; texture; lead; timing }; parts?: MovementLabel['parts']; space?: SpaceLabel; body?: { upper: number; lower: number; underused: Target[] }; explored?: Target[]; answering?: boolean }`
  - `buildPacket(i: { source: 'webcam' | 'phone'; active: boolean; cells: number[]; label: MovementLabel | null; usage: Partial<Record<WindowName, UsageMessage>>; zones30: Record<Zone, number> | null; zones8: Record<Zone, number> | null; answering: boolean }, cfg: TrackingConfig): DisplayPacket` — `active`가 거짓이면 `movement/parts/space/body/explored`를 넣지 않는다. `body`는 `ringShares(usage.recent)`가 있을 때만, `underused = lackingTargets(usage.recent, zones30)`. `explored = exploredTargets(usage['8count'], zones8)`. `answering`은 참일 때만 넣는다.
  - `type DisplayFrame = { packet: DisplayPacket; pose: PoseMessage | null; status: StatusMessage | null; usage: Partial<Record<WindowName, UsageMessage>>; label: MovementLabel | null; lacking: Target[]; answer: { progress: number; yes: boolean } }`
  - `class DisplayTracker { constructor(cfg: TrackingConfig = DEFAULT_CONFIG); step(e: PoseEvent, ctx: { musicT: number | null; beatS: number | null; playing: boolean; asking: boolean }): DisplayFrame; reset(): void }` — 안에 `LiveSession`, `MovementLabeler`, `OverheadAnswer`, `ImageHeatmap`을 하나씩 둔다. `active` = 트래커 상태 `'tracking'`이고 사람이 보임. `e.tMs`가 직전보다 작으면 `reset()` 후 처리. 구역은 `zoneShares(cfg.aggregate.windows.recent_s)`와 `zoneShares(cfg.aggregate.windows['8count_s'])`.
  - `display.ts`는 묶음의 입구로 `DisplayTracker`, `webPoseEvent`, `SKELETON_EDGES`, `DEFAULT_CONFIG`를 다시 내보낸다.
  - `build-display.cjs`: `module.exports = { build }`, `build({ write: boolean }): Promise<string>`. esbuild 설정: entry `src/tracking/display.ts`, `bundle: true`, `format: 'esm'`, `target: 'es2020'`, `legalComments: 'none'`. 출력 맨 앞에 `// Generated by app/scripts/build-display.cjs from app/src/tracking/display.ts. Do not edit.\n`. `write`이면 `../server/app/static/tracking.js`에 쓴다. 명령줄로 실행하면 `build({ write: true })`.

- [ ] **Step 1: esbuild를 설치한다**

Run: `cd app && npm install --save-dev --save-exact esbuild@0.25.5`
Expected: `package.json`의 devDependencies에 `"esbuild": "0.25.5"`. (그 버전이 없으면 0.25.x 중 가장 가까운 것을 정확한 버전으로.)

- [ ] **Step 2: 실패하는 테스트 세 개를 쓴다**

`targets.test.cjs`:
```js
const u = (segments, level, underused = [], ok = true) => ({ t: 0, window: 'recent', segments, level, current_level: 'mid', underused, tracking_ok: ok });
const SEG = { head: .1, torso: .1, arm_l: .3, arm_r: .3, leg_l: .1, leg_r: .1 };
assert.deepEqual(ringShares(u(SEG, { low: 0, mid: 1, high: 0 })), { upper: 0.75, lower: 0.25 });
assert.equal(ringShares(u(SEG, { low: 0, mid: 1, high: 0 }, [], false)), null);
assert.deepEqual(lackingTargets(u(SEG, { low: 0, mid: 1, high: 0 }, ['leg_l', 'head']), { left: 0, center: 1, right: 0 }, DEFAULT_CONFIG), ['leg_l', 'low', 'high', 'left', 'right']);
assert.deepEqual(lackingTargets(u(SEG, { low: .2, mid: .6, high: .2 }), null, DEFAULT_CONFIG), [], 'no zones before calibration');
assert.deepEqual(lackingTargets(u(SEG, { low: 0, mid: 1, high: 0 }, ['leg_l'], false), null, DEFAULT_CONFIG), [], 'tracking not ok: nothing');
// explored thresholds: limbs ≥ 0.6 / 6 = 0.1, levels ≥ 0.3, zones ≥ 0.2
assert.deepEqual(exploredTargets({ ...u({ ...SEG, leg_r: .05 }, { low: .35, mid: .65, high: 0 }), window: '8count' }, { left: .25, center: .75, right: 0 }, DEFAULT_CONFIG), ['arm_l', 'arm_r', 'leg_l', 'low', 'left']);
```

`display.test.cjs`(서 있는 사람 3초 → 맞춤, 이어서 동작; `helpers.cjs`의 `standingImage`, `worldFromImage`로 `PoseEvent`를 만드는 `eventAt(tMs, image, visibility)` 도우미):
```js
// arms only for 40 s at 30 fps: legs lacking, packet carries the words and the rings
const f = runDisplay(armsOnly, 43);
assert.equal(f.packet.active, true);
assert.equal(f.packet.source, 'webcam');
assert.ok(f.packet.body.upper > 0.6, JSON.stringify(f.packet.body));
assert.ok(f.packet.body.underused.includes('leg_l') && f.packet.body.underused.includes('leg_r'));
assert.ok(f.packet.parts && f.packet.movement && f.packet.cells.length === 64);
assert.ok(JSON.stringify(f.packet).length < 4096, 'fits the relay limit');
// lacking excludes legs that are out of frame: knees and feet (25–32) hidden the whole time
const g = runDisplay(armsOnly, 43, { hide: [25, 26, 27, 28, 29, 30, 31, 32] });
assert.ok(!g.packet.body || !g.packet.body.underused.some(t => t === 'leg_l' || t === 'leg_r'), JSON.stringify(g.packet.body));
// time going back resets: a looped video starts over and calibrates again
const t = new DisplayTracker(); stepMany(t, standing, 0, 5); const back = t.step(eventAt(1000, standingImage()), CTX);
assert.notEqual(back.status?.state, 'tracking');
// the O answer: only while asking
const h = runDisplay(oThenHold, 10, { asking: true });
assert.equal(h.sawYes, true);
assert.equal(runDisplay(oThenHold, 10, { asking: false }).sawYes, false);
// inactive: no words, no body
assert.deepEqual(Object.keys(new DisplayTracker().step(eventAt(0, null), CTX).packet).sort(), ['active', 'calibrated', 'cells', 'source']);
```

`bundle.test.cjs`:
```js
const { build } = require('../build-display.cjs');
const want = (await build({ write: false })).replace(/\r\n/g, '\n');
const have = fs.readFileSync(path.join(__dirname, '../../../server/app/static/tracking.js'), 'utf8').replace(/\r\n/g, '\n');
assert.equal(have, want, 'server/app/static/tracking.js is stale: run npm run build:display');
```
(최상위 `await`이 안 되면 `build(...).then(...)`으로, 실패 시 `process.exitCode = 1`.)

- [ ] **Step 3: 실패를 확인한다** — Run: `cd app && npm run test:tracking` / Expected: `targets.test.cjs`에서 FAIL(모듈 없음).

- [ ] **Step 4: `config.ts`의 `targets` 섹션, `targets.ts`, `display.ts`, `build-display.cjs`를 위 인터페이스대로 쓴다.** `DisplayTracker.step`은 `LiveSession.step(e.tMs, poseFromEvent(e), e.aspect, { playing: ctx.playing, musicT: ctx.musicT })`의 메시지를 받아 창별 `usage`와 `status`, `pose`를 모은다(store.ts `onMessage`와 같은 방식).

- [ ] **Step 5: 묶음을 만든다** — Run: `cd app && npm run build:display` / Expected: `server/app/static/tracking.js`가 생기고 첫 줄이 생성 주석.

- [ ] **Step 6: 통과를 확인한다** — Run: `cd app && npm run test:tracking && npx tsc --noEmit` / Expected: `targets`, `display`, `bundle` 포함 전부 PASS.

- [ ] **Step 7: 확인** — 커밋하지 않는다.

---

### Task 4: 서버 — 새 대상, 웹캠 규칙, 12초 '아니요', "You tried it", 경로

**Files:**
- Modify: `server/app/display_agent.py`, `server/app/projection.py`
- Create: `server/tests/test_webcam_guide.py`

**Interfaces:**
- Consumes: Task 3 `DisplayPacket`의 모양(`source`, `body.underused: Target[]`, `explored`, `answering`)
- Produces:
  - `TARGETS = ('arm_l', 'arm_r', 'leg_l', 'leg_r', 'low', 'high', 'left', 'right')`
  - `Observation`에 필드 추가: `webcam: bool = False`, `explored: tuple[str, ...] = ()`, `answering: bool = False`
  - `MovementGuide.__init__`에 키워드 추가: `webcam_warmup=15, webcam_persistence=8, webcam_cooldown=30, webcam_target_cooldown=60, answer_window=12, explore_window=60`
  - 캐릭터 상태에 `'unanswered'`(4초), `'explored'`(5초) 추가. `public()` 결과에 `'timers': {'warmup': float, 'cooldown': float, 'holding': {target: float}, 'answer': float | None}`(남은 초, 0 이상) 추가.
  - `LocalPromptGenerator.PROMPTS`에 추가: `'low': ('Go low', 'Bring your movement closer to the floor for the next counts.', '↓')`, `'high': ('Go high', 'Rise up and reach above your usual height.', '↑')`, `'left': ('Explore your left side', 'Travel a few steps to your left and dance there.', '←')`, `'right': ('Explore your right side', 'Travel a few steps to your right and dance there.', '→')`
  - 경로: `GET /display`(웹캠 단독 또는 `?room=`), `GET /static/tracking.js`(`text/javascript`), `GET /movement` → 307 `/display`(쿼리 유지). `GET /movement.js` 없앰. `GET /movement/rooms` 유지.

규칙(`observe`에서 `observation.webcam`이 참일 때):
- 준비·쉬는 시간 값은 `webcam_*`를 쓰고, 계기는 `'sustained'`(저장·반복 조건 없음).
- 고르는 대상: 준비된 것 중 부족이 가장 오래 이어진 것(`holding` 시작 시각이 가장 이른 것), 같으면 `TARGETS` 순서.
- 묻는 중(`pending.kind == 'help'`)이고 `now − createdAt ≥ answer_window`이며 `observation.answering`이 거짓이면: 질문을 거두고 `response = 'unanswered'`, 4초 보인다.
- '예'(`respond(..., 'accept')`)로 제안이 만들어지면 `watching = (target, now)`. 이후 `target in observation.explored`이고 `explore_window` 안이면 제안을 거두고 `response = 'explored'`, 5초 보인다. 창이 지나면 `watching`을 버린다.
- 폰 규칙(웹캠 아님)은 지금과 같다.

`projection.py`:
- `PART`의 `kind`, `speed`, `size`에 `None`을 허용한다.
- `_targets(value)`: 리스트이고 길이 ≤ 8, 모두 `TARGETS` 안이면 중복 없앤 리스트, 아니면 None.
- 발행자 패킷의 `source == 'webcam'`이면, 또는 `cam`이 있으면 `Observation(webcam=True, ...)`. `explored`는 `_targets`, `answering`은 `is True`.
- `camera` 역할의 `cam`에 `explored`, `answering`도 담고, `movement` 또는 `body`가 있으면 저장한다.
- 패킷에 실리는 키는 지금과 같다(`explored`, `answering`, `source`는 보는 쪽으로 넘기지 않는다).

- [ ] **Step 1: 실패하는 테스트를 쓴다** (`tests/test_webcam_guide.py`, `app.main`을 불러오지 않는다)

```python
def mini_app():
    a = FastAPI(); a.include_router(projection.router); return a

class WebcamGuideTests(unittest.TestCase):
    def setUp(self):
        self.g = MovementGuide()
    def obs(self, under=('leg_l',), **kw):
        return Observation(True, .7, .3, tuple(under), webcam=True, **kw)
    def run_until(self, t_end, step=.5, **kw):  # one clock per test: self.t carries over between calls
        out = None
        while self.t <= t_end: out = self.g.observe(self.obs(**kw), self.t); self.t += step
        return out

    def test_webcam_asks_after_warmup_and_persistence_without_phone(self):
        self.t = 0.0
        self.assertIsNone(self.run_until(14.5)['proposal'])
        ask = self.run_until(15.5)['proposal']   # held since 0 ≥ 8 s and warm-up 15 s done
        self.assertEqual((ask['kind'], ask['trigger'], ask['target']), ('help', 'sustained', 'leg_l'))
    def test_picks_the_longest_lacking_target(self): ...   # 'low' lacking from t=0, 'arm_l' from t=10 → target 'low'
    def test_no_answer_for_12_s_is_no(self): ...           # ask at t, observe at t+12 → state 'unanswered', proposal None; next ask not before t+30
    def test_answering_keeps_the_question_open(self): ...  # at t+12 with answering=True → still 'asking'; accept at t+14 succeeds
    def test_tried_it_after_accepting(self): ...           # accept help → suggestion; observe explored=('leg_l',) at +5 → state 'explored', proposal None
    def test_tried_it_window_closes(self): ...             # explored only at +61 → not 'explored'
    def test_leaving_the_frame_withdraws_the_question(self): ...  # Observation(False) while asking → state 'waiting', proposal None
    def test_phone_rules_unchanged(self): ...              # webcam=False, no save_revision → never asks within 200 s
    def test_timers_are_reported(self): ...                # public()['timers'] has warmup/cooldown/holding/answer

class WebcamRelayTests(unittest.TestCase):
    def test_routes(self): ...           # /display 200 and contains '/static/tracking.js'; /static/tracking.js 200 text/javascript;
                                         # /movement → 307 Location '/display'; /movement?room=<16hex> → '/display?room=<16hex>'; /movement.js 404
    def test_webcam_packet_drives_the_guide(self): ...  # publish {active, cells, source:'webcam', body:{upper:.7,lower:.3,underused:['low']}} → viewer packet has body.underused ['low'], no 'source'
    def test_unknown_part_and_new_targets_pass_validation(self): ...  # parts.arm_l all None passes; underused ['left','right'] passes; ['attic'] drops body
```

각 `...`는 주석의 단언을 그대로 코드로 쓴다(시각은 `MovementGuide()` 기본값 15 / 8 / 30 / 60 / 12 / 60 기준).

- [ ] **Step 2: 실패를 확인한다** — Run: `cd server && python -m unittest tests.test_webcam_guide -v` / Expected: FAIL(`Observation`에 `webcam` 없음 등).

- [ ] **Step 3: `display_agent.py`와 `projection.py`를 위 규칙대로 고친다.** `projection.py:33`의 독스트링이 가리키는 파일을 `app/src/tracking/labels.ts`로 고친다.

- [ ] **Step 4: 통과를 확인한다** — Run: `cd server && python -m unittest tests.test_webcam_guide -v` / Expected: 모두 OK.

- [ ] **Step 5: 기존 테스트가 이 컴퓨터에서 도는 부분을 확인한다** — Run: `cd server && python -c "import app.projection, app.display_agent"` / Expected: 오류 없음. (`tests.test_display_agent`, `tests.test_projection`은 `librosa`가 있는 맥에서 돌린다. 기존 단언은 바꾸지 않는다.)

- [ ] **Step 6: 확인** — 커밋하지 않는다.

---

### Task 5: 디스플레이 페이지 합치기와 디버깅 화면

**Files:**
- Modify: `server/app/display.html`, `docs/CREATIVE_DISPLAY.md`, `docs/TRACKING.md`
- Delete: `server/app/movement.html`, `server/app/movement.js`, `server/tests/movement.test.mjs`(Task 1에서 옮김)

**Interfaces:**
- Consumes: `/static/tracking.js`의 `DisplayTracker`, `webPoseEvent`, `SKELETON_EDGES`(Task 3); 서버 상태 `agent.state`의 `'unanswered'`, `'explored'`, `agent.timers`, `proposal.target`(Task 4); 지금 `movement.html`의 카메라·영상 파일·BPM·폰 세션 참여 코드

페이지 동작(모드는 주소로 정한다):
| 주소 | 모드 | 연결 |
|---|---|---|
| `/display` | 웹캠 단독. 방은 새로고침마다 무작위 16자리 | `publish`(내 패킷) + `view`(화면·캐릭터·답) |
| `/display?room=<16hex>` | 웹캠 + 폰 세션 | `camera`(내 패킷) + `view` |
| `/display/<16hex>` | 폰 카메라 | `view`만. 웹캠을 켜지 않는다 |
| `/display/demo` | 데모(지금 그대로) | 지금 그대로 |

- 웹캠 모드: `movement.html`의 카메라 시작(권한 거부 → "Camera permission is needed", 카메라 없음 → "No camera: choose a dance video"), 영상 파일 입력, GPU 실패 시 CPU를 옮겨 온다. 프레임마다 `webPoseEvent` → `DisplayTracker.step(e, { musicT, beatS, playing, asking })`. `asking` = 마지막 `view` 패킷의 `agent.proposal?.kind === 'help'`. 웹캠 단독은 `playing: true`, 폰 세션은 폰 시계(`phone` 메시지, 지금 코드)를 따른다. 250ms마다 `frame.packet`을 보낸다.
- `frame.answer.yes`이면 `view`로 `{type: 'agent_response', proposalId, choice: 'accept'}`. 키보드 `Y`/`N`은 accept/dismiss(묻거나 제안 중일 때).
- 화면은 지금처럼 `view` 패킷으로 `render()`한다. 추가:
  - 묻는 중: 넛지 아래 "Make an O over your head to say yes"와 `frame.answer.progress`로 채워지는 원.
  - `'unanswered'` → 제목 "Maybe later.", 설명 "Keep dancing. I'll check in again soon."
  - `'explored'` → 제목 "You tried it.", 설명 "Nice: {target name} joined in."(이름: Left arm, Right arm, Left leg, Right leg, Low height, High height, Your left side, Your right side)
  - 시작할 때 `frame.status.state`가 `'calibrating'`이면 큰 글자 "Stand still for 3 seconds"와 `status.progress` 막대.
- 디버깅 화면(오른쪽 아래 버튼 "Debug"와 `D` 키, 상태를 `localStorage['eight.debug']`에 try/catch로 저장, 기본 꺼짐): 거울로 뒤집은 영상 + `SKELETON_EDGES` 스켈레톤(가시성 0.5 미만 관절은 흐리게), fps, delegate(GPU/CPU), 트래커 상태, `frame.usage.recent.segments`(%), `kind`가 null인 부위 "(unknown)", `frame.lacking`, `agent.state`와 `agent.timers`, 입력 고르기(웹캠/영상 파일), BPM 입력, 방 주소와 "Phone session found: join" 링크(`/movement/rooms`를 3초마다, 링크는 `/display?room=…`). 폰 카메라 모드에서는 "Video stays on the phone. Check the phone's camera tab." 한 줄만.
- 폰 세션에 카메라가 이미 있으면(`camera` 연결이 1008로 닫힘) "This phone session already has a camera"를 보이고 다시 잇지 않는다.
- 바닥 안내 문구: "Video and pose landmarks stay on this computer. Only movement words and numbers are shared on your local network."

- [ ] **Step 1: `display.html`을 위대로 고친다.** 묶음은 `<script type="module">`에서 `import { DisplayTracker, webPoseEvent, SKELETON_EDGES } from '/static/tracking.js'`.

- [ ] **Step 2: `movement.html`, `movement.js`, `movement.test.mjs`를 지운다.**

Run: `git rm -q --cached server/app/movement.html server/app/movement.js server/tests/movement.test.mjs; rm server/app/movement.html server/app/movement.js server/tests/movement.test.mjs`
Expected: 세 파일이 사라지고 `git grep -n "movement.js\|movement.html" -- server app docs ':!docs/superpowers'`가 아무것도 찾지 않는다(독스트링·문서 포함).

- [ ] **Step 3: 문서를 고친다.** `docs/CREATIVE_DISPLAY.md`의 "Movement camera" 절을 `/display` 세 모드·디버깅 화면·머리 위 O·12초 규칙으로 바꾸고, "Boundaries" 절의 "does not use the computer's webcam" 문장을 고친다. `docs/TRACKING.md`에 `labels.ts`, `answer.ts`, `targets.ts`, `display.ts`, `npm run build:display`(소스를 바꾸면 반드시 다시 묶는다)를 더한다.

- [ ] **Step 4: 자동 확인** — Run: `cd server && python -m unittest tests.test_webcam_guide -v && cd ../app && npm run test:tracking` / Expected: 모두 통과.

- [ ] **Step 5: 브라우저 확인** — Run: `cd server && python -m uvicorn app.main:app --port 8000`가 `librosa` 때문에 안 되면 `python -c "import uvicorn; from fastapi import FastAPI; from app.projection import router; a=FastAPI(); a.include_router(router); uvicorn.run(a, port=8000)"`. `http://localhost:8000/display`를 열어 확인한다:
  - 웹캠 권한 허용 → "Stand still for 3 seconds" → 고리·태그·Space 칸이 움직인다.
  - `D` → 영상과 스켈레톤, 부위 %, 타이머가 보인다. 왼팔을 등 뒤로 숨기면 arm_l이 "(unknown)"이고 `lacking`에 없다.
  - 권한 거부 → 안내 문구와 영상 파일 입력이 동작한다.
  - 새 탭에서 `/display/<방>`을 열면 같은 값이 보인다.
  - `/movement` → `/display`로 넘어간다.

- [ ] **Step 6: 확인** — 커밋하지 않는다.

---

### Task 6: 리허설과 시연 대본

**Files:**
- Create: `docs/DEMO_SCRIPT.md`

- [ ] **Step 1: 대본 초안대로 웹캠 앞에서 돌린다**(설계 7절): 3초 가만히 → 팔만 25초 → 묻기 → O 3초 → 다리, 왼쪽 옆걸음 → "You tried it" → 높이 그대로 → 묻기 → O → 낮게 → "You tried it". 디버깅 화면을 켜고 `holding`·`warmup`·`cooldown` 타이머와 `lacking`을 지켜본다.

- [ ] **Step 2: 어긋난 곳을 기록한다.** 캐릭터가 예상과 다른 대상을 짚거나 때가 어긋나면, 원인이 동작(대본)인지 기준값인지 디버깅 값으로 가린다. 기준값을 바꿔야 하면 `config.ts`(`targets`, `answer`) 또는 `MovementGuide` 기본값을 고치고 해당 테스트의 기대값도 함께 고친 뒤 `npm run build:display`.

- [ ] **Step 3: `docs/DEMO_SCRIPT.md`를 쓴다**: 서는 자리(카메라에서 2.5–3m, 온몸이 화면 안), 시간표(구간·동작·화면에 보여야 할 것), 피할 동작(제자리 회전, 카메라 쪽 뻗기, 팔 숨기기), 시작 전 점검(인터넷, 웹캠 권한, `D`로 스켈레톤 확인 뒤 끄기), 막혔을 때(키보드 `Y`/`N`, 새로고침하면 새 방).

- [ ] **Step 4: 대본대로 처음부터 끝까지 한 번 더 돌려 대본의 때에 캐릭터가 뜨는지 확인한다.**

- [ ] **Step 5: 확인** — 커밋하지 않는다.

---

### Task 7: 폰 카메라 경로를 같은 패킷으로

**Files:**
- Modify: `app/src/tracking/store.ts`, `app/src/components/tracking/ProjectionCard.tsx`, `app/scripts/tracking/store.test.cjs`
- Delete: `app/src/projection/bodySummary.ts`, `app/scripts/tracking/displayBody.test.cjs`

**Interfaces:**
- Consumes: Task 1 `MovementLabeler`; Task 3 `buildPacket`
- Produces: `LiveTrackingStore.labeler: MovementLabeler`(읽기 전용 필드). `handlePose`가 사람이 보이는 프레임을 `{ tMs: e.tMs, image: pose.image.map(p => [p[0], p[1]]), visibility: pose.visibility, aspect: e.aspect, musicT, beatS: null }`로 넣는다. `requestRecalibration()`과 `recalibrate()`가 `labeler.reset()`도 부른다.

- [ ] **Step 1: 실패하는 테스트를 `store.test.cjs`에 더한다**

```js
{ // the phone's frames feed the same labeler as the display
  const store = new LiveTrackingStore(); feedStanding(store, 3); feedArmSwing(store, 3);
  const label = store.labeler.label();
  assert.ok(label && label.parts.arm_l.kind !== null, JSON.stringify(label?.parts.arm_l));
  store.requestRecalibration();
  assert.equal(store.labeler.label(), null, 'recalibration forgets the labels');
}
```

- [ ] **Step 2: 실패를 확인한다** — Run: `cd app && node scripts/tracking/store.test.cjs` / Expected: FAIL(`labeler` 없음).

- [ ] **Step 3: `store.ts`를 고치고, `ProjectionCard.tsx`의 전송을 `buildPacket({ source: 'phone', active, cells, label: store.labeler.label(), usage: view.usage, zones30: store.labeler.zoneShares(30), zones8: store.labeler.zoneShares(4), answering: false }, DEFAULT_CONFIG)`에 `missionTitle`, `context`, `recording`, `calibrated`를 덧붙인 것으로 바꾼다. `bodySummary.ts`와 그 테스트를 지운다.**

- [ ] **Step 4: 통과를 확인한다** — Run: `cd app && npm run test:tracking && npx tsc --noEmit && npm run build:display` / Expected: 전부 PASS, tsc 오류 없음, `bundle.test.cjs` 통과(묶음이 바뀌었으면 다시 만든 뒤 재실행).

- [ ] **Step 5: 확인** — 실기기 확인은 Android 폰이 있을 때 한다(폰 카메라 탭 → Start projection → `/display/<방>`에 부위 태그와 고리). 커밋하지 않는다.

---

### Task 8: `EN / KO` 스위치

**Files:**
- Modify: `server/app/display.html`

- [ ] **Step 1: 화면 글자를 표 하나로 모은다.** `const TEXT = { en: {...}, ko: {...} }`. 고정 문구, 상태 문구(waiting / asking / unanswered / explored / accepted / dismissed / paused), 대상 이름, 캐릭터 제안 문장(대상별 제목·설명, 서버 `PROMPTS`와 같은 영어 문장)을 담는다. 제안은 `proposal.target`과 `proposal.kind`로 표에서 찾고, 표에 없으면 서버가 보낸 문장을 쓴다.

- [ ] **Step 2: 오른쪽 위에 `EN / KO` 단추를 두고, 고른 언어를 `localStorage['eight.lang']`에 try/catch로 저장한다. 기본은 `en`.**

- [ ] **Step 3: 브라우저 확인** — `/display`에서 KO를 누르면 고정 문구, 상태 문구, 제안 문장이 한국어로 바뀌고, 새로고침해도 유지된다. 저장소가 막힌 창(시크릿)에서도 영어로 뜬다.

- [ ] **Step 4: 확인** — 커밋하지 않는다.
