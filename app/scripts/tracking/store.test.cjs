const assert = require('./assert.cjs');
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
/** Store with fake clocks. Each send() is one camera frame stepMs later; the song position follows the camera. */
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
  const h = harness({ stepMs: 100 });
  h.store.handleEngine({ model: 'lite', delegate: 'cpu' });
  assert.deepEqual(h.store.getView().engine, { model: 'lite', delegate: 'cpu' });
  h.store.handleError('카메라 화면을 열 수 없어요.');
  assert.equal(h.store.getView().error, '카메라 화면을 열 수 없어요.');
  h.send(); h.send(); // frames flow again (the view refreshes at 15 Hz): the error is over
  assert.equal(h.store.getView().error, null);
  h.store.handleError('다시 실패');
  h.store.handleEngine({ model: 'lite', delegate: 'cpu' });
  assert.equal(h.store.getView().error, null, 'a restarted camera clears the error');
}
{
  // a camera restart resets the perf window (the frame counter starts over)
  const h = harness();
  for (let i = 0; i < 10; i++) h.send();
  let before = 0;
  h.store.session.perf.reset = () => { before++; };
  h.store.handleEngine({ model: 'lite', delegate: 'gpu' });
  assert.equal(before, 1);
}
{
  // a fresh store owes the dance-spot measurement: the tracker calibrating on the dancer at the phone does not count
  const h = harness();
  for (let i = 0; i < 40; i++) h.send();
  assert.equal(h.store.trackerState, 'tracking');
  assert.equal(h.store.calibrated, false);
  h.store.recalibrate();
  assert.equal(h.store.trackerState, 'waiting');
  assert.equal(h.store.calibrated, false);
  for (let i = 0; i < 40; i++) h.send();
  assert.equal(h.store.calibrated, true);
}
{
  // [다시 맞추기]: the next [춤 시작] must measure again, even though the tracker re-calibrates on its own
  const h = harness();
  h.store.recalibrate();
  for (let i = 0; i < 40; i++) h.send();
  assert.equal(h.store.calibrated, true);
  h.store.requestRecalibration();
  assert.equal(h.store.trackerState, 'waiting');
  assert.equal(h.store.calibrated, false);
  for (let i = 0; i < 40; i++) h.send();
  assert.equal(h.store.trackerState, 'tracking');
  assert.equal(h.store.calibrated, false, 'still owed: the dancer was standing at the phone, not at the dance spot');
  h.store.recalibrate(); // the dance-start 'recalibrate' action
  assert.equal(h.store.trackerState, 'waiting');
  for (let i = 0; i < 40; i++) h.send();
  assert.equal(h.store.calibrated, true);
}
{
  const saved = { version: 1, trackedMs: 40000, totals: { frames: 10, score: { head: 0, torso: 0, arm_l: 5, arm_r: 0, leg_l: 0, leg_r: 0 }, observed: { head: 10, torso: 10, arm_l: 10, arm_r: 10, leg_l: 10, leg_r: 10 }, levels: { low: 0, mid: 10, high: 0 } } };
  const h = harness();
  h.store.importTracking(saved);
  assert.deepEqual(h.store.exportTracking(), saved, 'a resumed session keeps its totals even without new frames');
  h.store.importTracking(undefined); // sessions saved before tracking existed
  assert.deepEqual(h.store.exportTracking(), saved, 'importing nothing keeps the restored totals');
}
