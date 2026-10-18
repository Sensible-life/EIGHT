const assert = require('./assert.cjs');
const { validTracking } = require('../load-ts.cjs')('src/tracking/validate.ts');

const seg = v => ({ head: v, torso: v, arm_l: v, arm_r: v, leg_l: v, leg_r: v });
const good = { version: 1, trackedMs: 40000, totals: { frames: 600, score: seg(10.5), observed: seg(600), levels: { low: 0, mid: 590, high: 10 } } };
assert.equal(validTracking(good), true);
const broken = [
  null, [], 'x',
  { ...good, version: 2 },
  { ...good, trackedMs: -1 },
  { ...good, trackedMs: Infinity },
  { ...good, totals: null },
  { ...good, totals: { ...good.totals, frames: '600' } },
  { ...good, totals: { ...good.totals, score: { ...seg(1), tail: 1 } } },
  { ...good, totals: { ...good.totals, score: { head: 1 } } },
  { ...good, totals: { ...good.totals, score: seg(-1) } },
  { ...good, totals: { ...good.totals, observed: seg(601) } },
  { ...good, totals: { ...good.totals, levels: { low: 0, mid: 700, high: 0 } } },
  { ...good, totals: { ...good.totals, levels: { low: 300, mid: 300, high: 300 } } },
];
broken.forEach((b, i) => assert.equal(validTracking(b), false, `broken #${i} must be rejected`));
console.log('PASS: validTracking accepts good totals and rejects broken ones');
