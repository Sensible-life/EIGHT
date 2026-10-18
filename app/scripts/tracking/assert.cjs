// load-ts.cjs runs modules in a new vm realm, so their arrays/objects fail node's deepEqual prototype check; structuredClone moves them into this realm first.
const a = require('node:assert/strict');
const p = v => (v && typeof v === 'object' ? structuredClone(v) : v);
module.exports = Object.assign(Object.create(a), { deepEqual: (x, y, m) => a.deepEqual(p(x), p(y), m) });
