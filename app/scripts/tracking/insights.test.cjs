const assert = require('./assert.cjs');
const { unexploredTargets, trackingInsights } = require('../load-ts.cjs')('src/tracking/insights.ts');
const { close } = require('./helpers.cjs');

assert.deepEqual(unexploredTargets(['leg_l'], { low: 0.05, mid: 0.9, high: 0.05 }, 0.1), ['leg_l', 'low', 'high']);
assert.deepEqual(unexploredTargets(['head'], { low: 0.2, mid: 0.6, high: 0.2 }, 0.1), ['head']);
assert.deepEqual(unexploredTargets([], { low: 0, mid: 0, high: 0 }, 0.1), [], 'level not judged: not unexplored');

const seg = (o = {}) => ({ head: 0, torso: 0, arm_l: 0, arm_r: 0, leg_l: 0, leg_r: 0, ...o });
const every = v => seg({ head: v, torso: v, arm_l: v, arm_r: v, leg_l: v, leg_r: v });
// arms only while standing: legs, head and torso quiet; low and high unexplored
const armsOnly = { version: 1, trackedMs: 60000, totals: { frames: 100, score: seg({ arm_l: 100, arm_r: 100 }), observed: every(100), levels: { low: 0, mid: 100, high: 0 } } };
// everything moving, half of it low
const allLow = { version: 1, trackedMs: 40000, totals: { frames: 100, score: every(100), observed: every(100), levels: { low: 50, mid: 50, high: 0 } } };
const short = { ...armsOnly, trackedMs: 29000 };

assert.equal(trackingInsights([undefined, short]), null, 'nothing tracked for 30 s yet');
const r = trackingInsights([armsOnly, allLow, undefined, short]);
assert.equal(r.sessions, 2);
assert.equal(r.trackedMs, 100000);
close(r.segments.arm_l, 0.25);
close(r.segments.leg_l, 0.125);
close(r.level.low, 0.25);
close(r.level.mid, 0.75);
assert.deepEqual(r.unexplored, [
  { target: 'high', count: 2 },
  { target: 'low', count: 1 },
  { target: 'leg_l', count: 1 },
  { target: 'leg_r', count: 1 },
  { target: 'torso', count: 1 },
  { target: 'head', count: 1 },
], 'most often unexplored first, ties: levels then limbs');
