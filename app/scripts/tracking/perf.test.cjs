const assert = require('./assert.cjs');
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
