const assert = require('./assert.cjs');
const load = require('../load-ts.cjs');
const { median, percentile, pyRound, norm, midpoint } = load('src/tracking/math.ts');
const { SEGMENT_NAMES, SEGMENTS, JOINT_ANGLES, SKELETON_EDGES, segmentOf, bySegment, byLevel } = load('src/tracking/segments.ts');
const { DEFAULT_CONFIG, withConfig, shareOptions, detectorJson } = load('src/tracking/config.ts');

// math: numpy-compatible helpers
assert.equal(median([3, 1, 2]), 2);
assert.equal(median([4, 1, 3, 2]), 2.5);
const tens = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
assert.equal(percentile(tens, 50), 55);
assert.equal(percentile(tens, 95), 95.5);
assert.equal(pyRound(0.125, 2), 0.12, 'exact ties go to the even neighbour, like Python round()');
assert.equal(pyRound(18.15, 1), 18.1, 'near-ties follow the exact decimal value, like Python');
assert.equal(pyRound(2.5, 0), 2);
assert.equal(pyRound(3.5, 0), 4);
assert.equal(pyRound(-2.5, 0), -2);
assert.equal(pyRound(0.123456, 4), 0.1235);
assert.equal(norm([3, 4, 0]), 5);
assert.deepEqual(midpoint([0, 0, 0], [2, 4, 6]), [1, 2, 3]);

// segments: disjoint landmark sets, the dancer's own left / right
const seen = new Set();
for (const s of SEGMENT_NAMES) for (const i of SEGMENTS[s]) { assert.ok(!seen.has(i), `landmark ${i} in two segments`); seen.add(i); }
assert.equal(JOINT_ANGLES.length, 8);
assert.equal(segmentOf(15), 'arm_l');
assert.equal(segmentOf(1), null, 'eye landmarks belong to no segment');
assert.ok(SKELETON_EDGES.every(([a, b]) => a < 33 && b < 33));
assert.deepEqual(Object.keys(bySegment(() => 0)), SEGMENT_NAMES);
assert.deepEqual(byLevel(l => l), { low: 'low', mid: 'mid', high: 'high' });

// config: deep overrides leave the defaults alone
const c = withConfig({ calibration: { duration_s: 1 } });
assert.equal(c.calibration.duration_s, 1);
assert.equal(c.calibration.noise_floor_multiplier, DEFAULT_CONFIG.calibration.noise_floor_multiplier);
assert.equal(DEFAULT_CONFIG.calibration.duration_s, 3);
assert.deepEqual(shareOptions(DEFAULT_CONFIG), { underusedRatio: 0.5, minObservedRatio: 0.5, idleActivity: 0.05 });
assert.equal(JSON.parse(detectorJson()).min_detection_confidence, 0.5);
