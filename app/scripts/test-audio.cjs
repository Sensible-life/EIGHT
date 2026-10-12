const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const contexts = [];
let decode;
class Param { value = 1; cancelScheduledValues() {} setTargetAtTime(v) { this.value = v; } }
class Gain { gain = new Param(); connect() {} }
class Source { connect(g) { this.gain = g; } start(time, offset) { this.startTime = time; this.offset = offset; } stop() { this.stopped = true; } disconnect() {} }
class Context {
  currentTime = 10; state = 'running'; destination = {}; nodes = [];
  constructor() { contexts.push(this); }
  createGain() { return new Gain(); }
  createBufferSource() { const node = new Source(); this.nodes.push(node); return node; }
  async decodeAudioData(url) { return decode(url); }
  async resume() { this.state = 'running'; }
  async close() { this.state = 'closed'; }
}
const buffer = (duration = 30) => ({ duration, sampleRate: 100, getChannelData: () => new Float32Array(duration * 100).fill(0.25) });
const audioApi = { AudioContext: Context, AudioManager: { setAudioSessionOptions() {} } };
function load(path) {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, require: name => { if (name === '../haptics/pattern') return load('src/haptics/pattern.ts'); assert.equal(name, 'react-native-audio-api'); return audioApi; } }, { filename: path });
  return module.exports;
}
const { StemPlayer } = load('src/audio/StemPlayer.ts');
const { initialMix, layerGain } = load('src/audio/mix.ts');
(async () => {
  decode = async () => buffer();
  const player = new StemPlayer();
  await assert.rejects(player.load({}), /레이어/);
  const progress = [];
  await player.load({ vocals: 'a', drums: 'b', bass: 'c', other: 'd' }, (done, total) => progress.push([done, total]));
  assert.equal(player.duration, 30); assert.equal(progress.length, 4); assert.equal(player.waveform('vocals').length, 64);
  await player.play();
  const context = contexts.at(-1);
  assert.equal(new Set(context.nodes.map(node => node.startTime)).size, 1, 'all stems start on the same audio clock');
  assert.equal(player.position, 0, 'scheduled start never produces negative time');
  context.currentTime += 2; player.pause(); assert.equal(player.playing, false); assert.ok(Math.abs(player.position - 1.95) < 0.001);
  player.setGain('vocals', 0.6); assert.equal(context.nodes[0].gain.gain.value, 0.6);
  await player.play(); assert.equal(context.nodes.at(-1).offset, player.position);
  await player.seek(12); assert.equal(player.position, 12); assert.equal(context.nodes.at(-1).offset, 12);
  await player.setLoop({ start: 4, end: 8 }); assert.equal(player.position, 4); assert.equal(context.nodes.at(-1).loopEnd, 8);
  context.currentTime += 10; assert.ok(player.position >= 4 && player.position < 8);
  await player.setLoop(null); await player.seek(25); context.currentTime += 10;
  let ended = 0; player.onEnded = () => ended++; assert.equal(player.position, 0); assert.equal(ended, 1); assert.equal(player.playing, false);
  await player.dispose(); await player.play(); assert.equal(context.state, 'closed');
  decode = async () => buffer();
  const expanded = new StemPlayer();
  const names = ['lead_vocals', 'backing_vocals', 'drums', 'bass', 'piano', 'electric_guitar', 'acoustic_guitar', 'synthesizer', 'strings', 'wind', 'other'];
  await expanded.load(Object.fromEntries(names.map(name => [name, name])));
  await expanded.play();
  const expandedContext = contexts.at(-1);
  assert.equal(expandedContext.nodes.length, 11);
  assert.equal(new Set(expandedContext.nodes.map(node => node.startTime)).size, 1);
  expanded.setGain('wind', 0.37);
  assert.equal(expandedContext.nodes[9].gain.gain.value, 0.37);
  assert.equal(expandedContext.nodes[8].gain.gain.value, 1);
  await expanded.dispose();
  decode = async url => buffer(url === 'short' ? 10 : 30);
  const unequal = new StemPlayer(); await assert.rejects(unequal.load({ a: 'short', b: 'long' }), /길이/); assert.equal(unequal.stems.length, 0); await unequal.dispose();
  let finish;
  decode = () => new Promise(resolve => { finish = resolve; });
  const closing = new StemPlayer(); const pending = closing.load({ a: 'a' }); await closing.dispose(); finish(buffer()); await pending; assert.equal(closing.stems.length, 0, 'loading cannot resurrect a disposed player');
  const mix = initialMix(['vocals', 'drums', 'bass']); mix.vocals.volume = 0.42;
  assert.equal(layerGain(mix, 'vocals'), 0.42); mix.drums.solo = true; assert.equal(layerGain(mix, 'vocals'), 0); assert.equal(layerGain(mix, 'drums'), 1);
  mix.vocals.solo = true; assert.equal(layerGain(mix, 'vocals'), 0.42); mix.vocals.muted = true; assert.equal(layerGain(mix, 'vocals'), 0);
  assert.equal(layerGain(initialMix(Object.keys(mix)), 'vocals'), 1);
  console.log('PASS: 11-layer synchronized playback and independent volume, simultaneous start, pause/resume, seek, loop, end, gain, length validation, disposal, mute/solo/reset');
})().catch(error => { console.error(error); process.exitCode = 1; });
