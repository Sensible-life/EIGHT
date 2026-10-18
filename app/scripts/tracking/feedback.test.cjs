const assert = require('./assert.cjs');
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
