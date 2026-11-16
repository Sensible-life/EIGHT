const assert = require('node:assert/strict');
const { isWatchMixerCommand, applyWatchMixerCommands } = require('./load-ts.cjs')('src/audio/watchMixer.ts');
const session = 'active';
for (const command of [
  { session, stem: 'drums', percent: 0 },
  { session, stem: 'drums', percent: 150 },
  { session, stem: 'drums', delta: -10 },
  { session, stem: 'drums', delta: 10 },
]) assert.ok(isWatchMixerCommand(command, session));
for (const command of [
  null, { session: 'old', stem: 'drums', percent: 50 },
  { session, stem: 'drums', percent: 151 }, { session, stem: 'drums', percent: -1 },
  { session, stem: 'drums', percent: 50.5 }, { session, stem: 'drums', percent: NaN },
  { session, stem: '', percent: 50 }, { session, stem: 'drums', delta: 1 },
  { session, stem: 'drums', delta: 10, percent: 50 },
]) assert.equal(isWatchMixerCommand(command, session), false);
const original = { drums: { volume: 1, muted: true, solo: false }, bass: { volume: 1.5, muted: false, solo: true } };
const result = applyWatchMixerCommands(original, [
  { session, stem: 'drums', percent: 35 }, { session, stem: 'drums', delta: 10 },
  { session, stem: 'bass', delta: 10 }, { session, stem: 'missing', percent: 50 },
  { session, stem: '__proto__', percent: 50 },
]);
assert.equal(result.drums.volume, .45);
assert.equal(result.drums.muted, true);
assert.equal(result.bass.volume, 1.5);
assert.equal(result.bass.solo, true);
assert.equal(original.drums.volume, 1);
assert.equal(Object.hasOwn(result, '__proto__'), false);
console.log('PASS: watch slider and legacy button commands, bounds, sessions, order and mixer state');
const { applyWatchMasterCommands } = require('./load-ts.cjs')('src/audio/watchMixer.ts');
for (const command of [
  { session, stem: 'drums', muted: false }, { session, stem: 'bass', solo: true },
  { session, masterPercent: 0 }, { session, masterPercent: 100 },
]) assert.ok(isWatchMixerCommand(command, session));
for (const command of [
  { session, stem: 'drums', muted: 1 }, { session, stem: 'drums', solo: true, muted: false },
  { session, masterPercent: 101 }, { session, masterPercent: -1 },
  { session, masterPercent: 50, stem: 'drums' }, { session: 'old', masterPercent: 50 },
]) assert.equal(isWatchMixerCommand(command, session), false);
const controls = [
  { session, stem: 'drums', muted: false }, { session, stem: 'drums', solo: true },
  { session, stem: 'bass', solo: false }, { session, masterPercent: 23 },
  { session, masterPercent: 72 },
];
const changed = applyWatchMixerCommands(original, controls);
assert.equal(changed.drums.muted, false);
assert.equal(changed.drums.solo, true);
assert.equal(changed.bass.solo, false);
assert.equal(changed.drums.volume, 1);
assert.equal(applyWatchMasterCommands(.8, controls), .72);
assert.equal(applyWatchMixerCommands(original, [{ session, masterPercent: 0 }]), original);
assert.equal(original.drums.muted, true);
console.log('PASS: watch mute, solo and master controls');
