// Parity with the id403 Python pipeline: same frames in -> same tracker results and messages out.
// Fixtures: scripts/fixtures/tracking/*.json.gz, made by id403 tools/export_golden.py (synthetic poses only).
const assert = require('./assert.cjs');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const load = require('../load-ts.cjs');
const { LivePipeline, tickMessages } = load('src/tracking/pipeline.ts');
const { DEFAULT_CONFIG } = load('src/tracking/config.ts');

const dir = path.join(__dirname, '..', 'fixtures', 'tracking');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json.gz')).sort();
assert.equal(files.length, 8, `expected 8 fixtures in ${dir}`);

// Every number must agree with id403 to 1e-6 (spec §5.1). Exact fields (state, levels, flags, cue text) compare with ===.
function compare(actual, expected, where) {
  if (typeof expected === 'number') {
    assert.equal(typeof actual, 'number', `${where}: expected a number, got ${JSON.stringify(actual)}`);
    const tol = Math.max(1e-9, 1e-6 * Math.abs(expected));
    assert.ok(Math.abs(actual - expected) <= tol, `${where}: ${actual} vs python ${expected}`);
  } else if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual) && actual.length === expected.length, `${where}: ${JSON.stringify(actual)} vs python ${JSON.stringify(expected)}`);
    expected.forEach((e, i) => compare(actual[i], e, `${where}[${i}]`));
  } else if (expected !== null && typeof expected === 'object') {
    assert.ok(actual !== null && typeof actual === 'object', `${where}: got ${JSON.stringify(actual)}`);
    assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), `${where}: keys`);
    for (const k of Object.keys(expected)) compare(actual[k], expected[k], `${where}.${k}`);
  } else {
    assert.equal(actual, expected, where);
  }
}
const toPython = r => r && { t_ms: r.tMs, detected: r.detected, scores: r.scores, observed: r.observed, level: r.level };

for (const file of files) {
  const fx = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, file))).toString('utf8'));
  for (const [section, values] of Object.entries(DEFAULT_CONFIG)) {
    if (section === 'app') continue;
    for (const [k, v] of Object.entries(values))
      assert.deepEqual(v, fx.config[section][k], `${fx.name}: config ${section}.${k} differs from id403 default.yaml`);
  }
  const p = new LivePipeline(DEFAULT_CONFIG);
  const update = p.tracker.update.bind(p.tracker);
  let result = null;
  p.tracker.update = (t, pose) => (result = update(t, pose));
  fx.frames.forEach((f, i) => {
    const pose = f.image ? { tMs: f.t_ms, image: f.image, world: f.world, visibility: f.visibility } : null;
    const tick = p.step(f.t_ms, pose, undefined, f.t_ms);
    const where = `${fx.name} frame ${i} (t=${f.t_ms} ms)`;
    compare(toPython(result), fx.expected[i].result, `${where} result`);
    compare(tick && tickMessages(tick), fx.expected[i].messages, `${where} messages`);
  });
}
