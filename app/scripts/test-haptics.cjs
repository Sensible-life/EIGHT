const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const moduleUnderTest = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/haptics/pattern.ts', 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS}}).outputText, {module: moduleUnderTest, exports: moduleUnderTest.exports});
const { detectPulses, selectPulses, encodePattern } = moduleUnderTest.exports;
const rate = 44100;
const audio = new Float32Array(rate * 3);
const times = [0.3, 0.9, 1.5, 2.1];
for (const time of times) for (let i = 0; i < rate * 0.18; i++) audio[Math.floor(time * rate) + i] += Math.sin(i * 2 * Math.PI * 65 / rate) * Math.exp(-i / (rate * 0.06));
for (const kind of ['bass', 'kick']) {
  const pulses = detectPulses(audio, rate, kind);
  assert.equal(pulses.length, times.length, `${kind} detects four distinct attacks`);
  pulses.forEach((pulse, i) => assert.ok(Math.abs(pulse.t - times[i]) < 0.04, `${kind} onset remains close to audio attack`));
}
assert.equal(detectPulses(new Float32Array(rate), rate, 'bass').length, 0);
const hats = new Float32Array(rate * 3);
for (const time of times) for (let i = 0; i < rate * 0.04; i++) hats[Math.floor(time * rate) + i] = Math.sin(i * 2 * Math.PI * 8000 / rate) * Math.exp(-i / (rate * 0.01));
assert.equal(detectPulses(hats, rate, 'kick').length, 0, 'high hats do not alias into kick pulses');
const steady = Float32Array.from({length: rate * 3}, (_, i) => 0.3 * Math.sin(i * 2 * Math.PI * 65 / rate));
assert.equal(detectPulses(steady, rate, 'bass').filter(p => p.t > 0.1).length, 0, 'sustained bass does not become repeated beats');
const combined = selectPulses([{t: 1, strength: 0.4}, {t: 2, strength: 0.2}], [{t: 1.03, strength: 0.9}], 'both', 0.3);
assert.equal(combined.length, 1); assert.equal(combined[0].strength, 0.9);
assert.equal(selectPulses([{t: 1, strength: 0.4}], [], 'kick', 0.1).length, 0);
const encoded = JSON.parse(encodePattern(combined, 3));
assert.equal(encoded.pulses[0][0], 1000); assert.equal(encoded.durationMs, 3000);
assert.throws(() => encodePattern(Array.from({length: 20000}, (_, i) => ({t: i, strength: 1})), 20001), /패턴/);
console.log('PASS: bass/kick attacks, silence, sustained bass, sensitivity, merging, compact transfer limits');
