const assert = require('node:assert/strict');
const { ImageHeatmap, floorTransform } = require('../load-ts.cjs')('src/projection/heatmap.ts');
const heat = new ImageHeatmap(), lm = Array.from({ length: 33 }, () => [0, 0, 0]);
lm[27] = [0.25, 0.75, 1]; lm[28] = [0.25, 0.75, 1];
const pose = { t: 1000, lm };
heat.update(pose, true, 1000);
const result = heat.update(pose, true, 1100);
assert.equal(result[6 * 8 + 6], 1);
assert.equal(result.filter(v => v > 0).length, 1);
const after = heat.update(pose, true, 2000);
assert.deepEqual(Array.from(after), Array.from(result), 'stale pose must not increase occupancy');
console.log('PASS: mirrored foot occupancy and stale-frame protection');

const corners = [{x:.2,y:.2}, {x:.8,y:.2}, {x:.95,y:.9}, {x:.05,y:.9}];
const transform = floorTransform(corners);
assert.ok(transform);
corners.forEach((p, i) => { const result = transform(p); const expected = [[0,0],[1,0],[1,1],[0,1]][i]; assert.ok(Math.abs(result.x - expected[0]) < 1e-8 && Math.abs(result.y - expected[1]) < 1e-8); });
assert.equal(floorTransform([corners[0],corners[2],corners[1],corners[3]]), null, 'crossed corners must be rejected');
console.log('PASS: perspective mapping and invalid corner order');
