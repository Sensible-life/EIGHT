const assert = require('./assert.cjs');
const { unexploredTargets } = require('../load-ts.cjs')('src/tracking/insights.ts');

assert.deepEqual(unexploredTargets(['leg_l'], { low: 0.05, mid: 0.9, high: 0.05 }, 0.1), ['leg_l', 'low', 'high']);
assert.deepEqual(unexploredTargets(['head'], { low: 0.2, mid: 0.6, high: 0.2 }, 0.1), ['head']);
assert.deepEqual(unexploredTargets([], { low: 0, mid: 0, high: 0 }, 0.1), [], 'level not judged: not unexplored');
