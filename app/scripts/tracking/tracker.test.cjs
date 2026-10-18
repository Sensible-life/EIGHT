const assert = require('./assert.cjs');
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
