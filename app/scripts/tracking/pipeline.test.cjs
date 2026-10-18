const assert = require('./assert.cjs');
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
