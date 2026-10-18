const assert = require('./assert.cjs');
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
