const assert = require('./assert.cjs');
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
