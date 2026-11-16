// Body heatmap (src/tracking/bodyMap.ts) and the analysis tab's live view: store + rolling window + camera clock.
const assert = require('./assert.cjs');
const load = require('../load-ts.cjs');
const { wholePercents, heatStrength, extremes, fromStudio, fromSegments, liveClock, FULL_STRENGTH_SHARE } = load('src/tracking/bodyMap.ts');
const { LiveTrackingStore } = load('src/tracking/store.ts');
const { withConfig } = load('src/tracking/config.ts');
const { S, standingImage, worldFromImage, rng, jitter } = require('./helpers.cjs');

const sum = r => Object.values(r).reduce((a, b) => a + (b ?? 0), 0);

// Percentages always add up to 100, even when every share rounds down.
{
  const p = wholePercents({ head: 1 / 6, torso: 1 / 6, arm_l: 1 / 6, arm_r: 1 / 6, leg_l: 1 / 6, leg_r: 1 / 6 });
  assert.equal(sum(p), 100);
  assert.ok(Object.values(p).every(v => v === 16 || v === 17));
}
{
  const p = wholePercents({ head: 0.004, torso: 0.1, arm_l: 0.4, arm_r: 0.3, leg_l: 0.096, leg_r: 0.1 });
  assert.equal(sum(p), 100);
  assert.equal(p.arm_l, 40);
}
// Unmeasured parts stay null and the rest is renormalised; nothing moving stays all zero.
{
  const p = wholePercents(fromStudio({ leftWrist: 0.3, rightWrist: 0.3, leftAnkle: 0.1, rightAnkle: 0.1, hip: 0.2 }));
  assert.equal(p.head, null);
  assert.equal(sum(p), 100);
  assert.deepEqual([p.arm_l, p.arm_r, p.leg_l, p.leg_r, p.torso], [30, 30, 10, 10, 20]);
  assert.deepEqual(wholePercents(fromSegments({ head: 0, torso: 0, arm_l: 0, arm_r: 0, leg_l: 0, leg_r: 0 })), { head: 0, torso: 0, arm_l: 0, arm_r: 0, leg_l: 0, leg_r: 0 });
}
// Fill strength: faint at 0 / unmeasured, full from a third of the movement up, monotonic in between.
assert.equal(heatStrength(0), heatStrength(null));
assert.equal(heatStrength(FULL_STRENGTH_SHARE), heatStrength(0.9));
assert.ok(heatStrength(0.1) < heatStrength(0.2));
assert.ok(heatStrength(Number.NaN) === heatStrength(0));
// Most / least used.
assert.deepEqual(extremes({ head: null, torso: 0.1, arm_l: 0.5, arm_r: 0.2, leg_l: 0.1, leg_r: 0.1 }), { most: 'arm_l', least: 'torso' });
assert.equal(extremes({ head: 0, torso: 0, arm_l: 0, arm_r: 0, leg_l: 0, leg_r: 0 }), null);
// The camera clock stands in for the music and is always playing.
{
  let now = 5000;
  const clock = liveClock(2000, () => now);
  assert.deepEqual(clock(), { position: 3, playing: true });
  now = 1000;
  assert.equal(clock().position, 0);
}

// Live view end to end: no song, a rolling 4 s window, arms waving -> arms carry most of the movement, live.
{
  const CFG = withConfig({ calibration: { duration_s: 1 } });
  let wall = 1_000_000, t = 0;
  const store = new LiveTrackingStore(CFG, { wallNowMs: () => wall, perfNowMs: () => 0 });
  store.setPlan({ kind: 'rolling', ms: 4000 });
  store.setMusicSource(liveClock(wall, () => wall));
  store.beginTake();
  const send = img => {
    store.handlePose({
      tMs: t, seq: t / 33 + 1, ageMs: 20, emitWallMs: wall, latencyMs: 30, captureFrom: 'sensor', aspect: 0.75,
      image: img.flatMap(p => [p[0], p[1], 1]), world: worldFromImage(img).flat(),
    });
    t += 33; wall += 33;
  };
  const r = rng(1);
  for (let i = 0; i < 45; i++) send(jitter(standingImage(), r)); // stand still -> calibration
  assert.equal(store.trackerState, 'tracking');
  for (let i = 0; i < 150; i++) {
    const img = jitter(standingImage(), r);
    for (const k of [S.L_ELBOW, S.L_WRIST, S.R_ELBOW, S.R_WRIST]) img[k][0] += 0.12 * Math.sin(i / 3);
    send(img);
  }
  const view = store.getView();
  assert.equal(view.plan, 'rolling');
  for (const w of ['8count', 'recent', 'session']) {
    const seg = view.usage[w].segments;
    assert.ok(seg.arm_l + seg.arm_r > 0.6, `${w}: arms should dominate, got ${JSON.stringify(seg)}`);
    assert.equal(sum(wholePercents(fromSegments(seg))), 100);
  }
  // Now only the legs move: the rolling "지금 4초" window follows within seconds while the session still remembers the arms.
  for (let i = 0; i < 150; i++) {
    const img = jitter(standingImage(), r);
    for (const k of [S.L_KNEE, S.L_ANKLE, S.L_FOOT, S.R_KNEE, S.R_ANKLE, S.R_FOOT]) img[k][0] += 0.12 * Math.sin(i / 3);
    send(img);
  }
  const now = store.getView().usage['8count'].segments, all = store.getView().usage.session.segments;
  assert.ok(now.leg_l + now.leg_r > 0.6, `now: legs should dominate, got ${JSON.stringify(now)}`);
  assert.ok(all.arm_l + all.arm_r > 0.25, `session: arms still counted, got ${JSON.stringify(all)}`);
}
console.log('PASS: body heatmap shares and the live analysis view');
