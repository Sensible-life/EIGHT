// What the display's character may point out (src/tracking/targets.ts): lacking limbs, heights and sides, and when they were tried.
const assert = require('./assert.cjs');
const load = require('../load-ts.cjs');
const { ringShares, limbShares, lackingTargets, exploredTargets, TARGET_ORDER } = load('src/tracking/targets.ts');
const { DEFAULT_CONFIG } = load('src/tracking/config.ts');

const u = (segments, level, underused = [], ok = true) => ({ t: 0, window: 'recent', segments, level, current_level: 'mid', underused, tracking_ok: ok });
const SEG = { head: .1, torso: .1, arm_l: .3, arm_r: .3, leg_l: .1, leg_r: .1 };
const MID = { low: 0, mid: 1, high: 0 };

assert.deepEqual(TARGET_ORDER, ['arm_l', 'arm_r', 'leg_l', 'leg_r', 'low', 'high', 'left', 'right']);
assert.deepEqual(ringShares(u(SEG, MID)), { upper: 0.75, lower: 0.25 });
assert.equal(ringShares(u(SEG, MID, [], false)), null, 'tracking not ok: no rings');
assert.equal(ringShares(u({ ...SEG, arm_l: 0, arm_r: 0, leg_l: 0, leg_r: 0 }, MID)), null, 'no limb movement: no rings');
assert.equal(ringShares(undefined), null);
assert.deepEqual(limbShares(u(SEG, MID)), { arm_l: 0.375, arm_r: 0.375, leg_l: 0.125, leg_r: 0.125 }, 'each limb of the limbs, head and torso left out');
assert.equal(limbShares(u(SEG, MID, [], false)), null, 'tracking not ok: no limb shares');
assert.equal(limbShares(u({ ...SEG, arm_l: 0, arm_r: 0, leg_l: 0, leg_r: 0 }, MID)), null, 'no limb movement: no limb shares');

assert.deepEqual(lackingTargets(u(SEG, MID, ['leg_l', 'head']), { left: 0, center: 1, right: 0 }, DEFAULT_CONFIG), ['leg_l', 'low', 'high', 'left', 'right'], 'head is never a target');
assert.deepEqual(lackingTargets(u(SEG, { low: .2, mid: .6, high: .2 }), null, DEFAULT_CONFIG), [], 'no zones before calibration');
assert.deepEqual(lackingTargets(u(SEG, MID, ['leg_l'], false), { left: 0, center: 1, right: 0 }, DEFAULT_CONFIG), [], 'tracking not ok: nothing');
assert.deepEqual(lackingTargets(u(SEG, { low: 0, mid: 0, high: 0 }), null, DEFAULT_CONFIG), [], 'no level measured: no level targets');
assert.deepEqual(lackingTargets(u(SEG, MID), { left: .1, center: .8, right: .1 }, DEFAULT_CONFIG), ['low', 'high'], 'exactly the minimum share is enough');
assert.deepEqual(lackingTargets(undefined, null, DEFAULT_CONFIG), []);

// explored thresholds: limbs ≥ 0.6 / 6 = 0.1, levels ≥ 0.3, zones ≥ 0.2
assert.deepEqual(exploredTargets({ ...u({ ...SEG, leg_r: .05 }, { low: .35, mid: .65, high: 0 }), window: '8count' }, { left: .25, center: .75, right: 0 }, DEFAULT_CONFIG), ['arm_l', 'arm_r', 'leg_l', 'low', 'left']);
assert.deepEqual(exploredTargets({ ...u(SEG, { low: .35, mid: .65, high: 0 }, [], false), window: '8count' }, null, DEFAULT_CONFIG), [], 'tracking not ok: nothing tried');
console.log('PASS: display targets');
