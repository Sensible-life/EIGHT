const assert = require('node:assert/strict');
const { crossedLoop } = require('../load-ts.cjs')('src/audio/composition.ts');
const range = { start: 4, end: 8 };
assert.equal(crossedLoop(7.95, 4.04, range, range), true);
assert.equal(crossedLoop(null, 4.04, range, range), false, 'manual seek must not advance');
assert.equal(crossedLoop(7.95, 4.04, { start: 0, end: 16 }, range), false, 'other loops must not advance');
assert.equal(crossedLoop(6, 4.1, range, range), false, 'mid-range jumps do not advance');
console.log('PASS: composition advances only when its active loop wraps');
