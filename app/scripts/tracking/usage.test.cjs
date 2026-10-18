const assert = require('./assert.cjs');
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
  close(snap(a, 'session', t).segments.leg_l, 0.6667);
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
{
  // one NaN / Infinity score must not poison the totals (they are saved and validated strictly)
  const { addToTotals } = load('src/tracking/usage.ts');
  const t = emptyTotals();
  const scores = { head: 0.5, torso: NaN, arm_l: Infinity, arm_r: 1, leg_l: 0, leg_r: 0 };
  const observed = { head: true, torso: true, arm_l: true, arm_r: true, leg_l: true, leg_r: true };
  addToTotals(t, { tMs: 0, level: 'mid', scores, observed, detected: true });
  assert.equal(t.frames, 1);
  assert.equal(t.score.torso, 0);
  assert.equal(t.score.arm_l, 0);
  assert.equal(t.observed.torso, 0, 'a non-finite segment counts as not observed');
  assert.equal(t.observed.head, 1);
  assert.equal(t.score.arm_r, 1);
}
