// server/app/static/tracking.js is generated from src/tracking/display.ts: it must match the source.
const assert = require('./assert.cjs');
const fs = require('node:fs');
const path = require('node:path');
const { build } = require('../build-display.cjs');

const want = build({ write: false }).replace(/\r\n/g, '\n');
const have = fs.readFileSync(path.join(__dirname, '../../../server/app/static/tracking.js'), 'utf8').replace(/\r\n/g, '\n');
assert.ok(have === want, 'server/app/static/tracking.js is stale: run npm run build:display');
console.log('PASS: display bundle is current');
