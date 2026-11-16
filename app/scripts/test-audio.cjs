const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const contexts = [];
let decode;
class Param { value = 1; cancelScheduledValues() {} setTargetAtTime(v) { this.value = v; } }
class Gain { gain = new Param(); connect() {} }
class Source { playbackRate = new Param(); getLatency() { return 0; } connect(g) { this.gain = g; } start(time, offset) { this.startTime = time; this.offset = offset; } stop() { this.stopped = true; } disconnect() {} }
class Context {
  currentTime = 10; state = 'running'; destination = {}; nodes = [];
  constructor() { contexts.push(this); }
  createGain() { return new Gain(); }
  createBufferSource(options) { const node = new Source(); node.options = options; this.nodes.push(node); return node; }
  async decodeAudioData(url) { return decode(url); }
  async resume() { this.state = 'running'; }
  async close() { this.state = 'closed'; }
}
const buffer = (duration = 30) => ({ duration, sampleRate: 100, getChannelData: () => new Float32Array(duration * 100).fill(0.25) });
const audioApi = { AudioContext: Context, AudioManager: { setAudioSessionOptions() {} } };
function load(path) {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, setTimeout, __DEV__: false, require: name => { if (name === '../haptics/pattern') return load('src/haptics/pattern.ts'); if (name === './layerAnalysisCache') return { layerAnalysisIdentity: (uri, stem) => `${stem}:${uri}`, readLayerAnalysis: () => null, writeLayerAnalysis: () => {} }; assert.equal(name, 'react-native-audio-api'); return audioApi; } }, { filename: path });
  return module.exports;
}
const { StemPlayer } = load('src/audio/StemPlayer.ts');
const { initialMix, layerGain } = load('src/audio/mix.ts');
(async () => {
  decode = async () => buffer();
  const player = new StemPlayer();
  await assert.rejects(player.load({}), /layer/i);
  const progress = [];
  await player.load({ vocals: 'a', drums: 'b', bass: 'c', other: 'd' }, (done, total) => progress.push([done, total]));
  assert.equal(player.duration, 30); assert.equal(progress.length, 4); assert.equal(player.waveform('vocals').length, 64);
  await player.play();
  const context = contexts.at(-1);
  assert.equal(new Set(context.nodes.map(node => node.startTime)).size, 1, 'all stems start on the same audio clock');
  assert.ok(context.nodes.every(node => node.options.pitchCorrection === true), 'buffer playback keeps pitch');
  assert.equal(player.position, 0, 'scheduled start never produces negative time');
  context.currentTime += 2; player.pause(); assert.equal(player.playing, false); assert.ok(Math.abs(player.position - 1.8) < 0.001);
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
  expandedContext.currentTime += 1.05;
  const beforeRate = expanded.position;
  expanded.setPlaybackRate(0.5);
  assert.equal(expanded.position, beforeRate, 'rate changes preserve position');
  assert.ok(expandedContext.nodes.every(node => node.playbackRate.value === 0.5));
  expandedContext.currentTime += 2;
  assert.ok(Math.abs(expanded.position - beforeRate - 1) < 1e-8);
  await expanded.seek(4); assert.ok(expandedContext.nodes.slice(-11).every(node => node.playbackRate.value === 0.5));
  assert.throws(() => expanded.setPlaybackRate(0));
  expanded.setGain('wind', 0.37);
  assert.equal(expandedContext.nodes[9].gain.gain.value, 0.37);
  assert.equal(expandedContext.nodes[8].gain.gain.value, 1);
  await expanded.dispose();
  decode = async url => buffer(url === 'short' ? 10 : 30);
  const unequal = new StemPlayer(); await assert.rejects(unequal.load({ a: 'short', b: 'long' }), /length/i); assert.equal(unequal.stems.length, 0); await unequal.dispose();
  let finish;
  decode = () => new Promise(resolve => { finish = resolve; });
  const closing = new StemPlayer(); const pending = closing.load({ a: 'a' }); await closing.dispose(); finish(buffer()); await pending; assert.equal(closing.stems.length, 0, 'loading cannot resurrect a disposed player');
  const mix = initialMix(['vocals', 'drums', 'bass']); mix.vocals.volume = 0.42;
  assert.equal(layerGain(mix, 'vocals'), 0.42); mix.drums.solo = true; assert.equal(layerGain(mix, 'vocals'), 0); assert.equal(layerGain(mix, 'drums'), 1);
  mix.vocals.solo = true; assert.equal(layerGain(mix, 'vocals'), 0.42); mix.vocals.muted = true; assert.equal(layerGain(mix, 'vocals'), 0);
  assert.equal(layerGain(initialMix(Object.keys(mix)), 'vocals'), 1);
  let reads = 0;
  decode = async () => ({ ...buffer(3), getChannelData: () => { reads++; return new Float32Array(300); } });
  const firstLoad = new StemPlayer(); await firstLoad.load({ bass: 'cache-specific-file' }); await firstLoad.dispose();
  const secondLoad = new StemPlayer(); await secondLoad.load({ bass: 'cache-specific-file' }); await secondLoad.dispose();
  assert.equal(reads, 1, 'reopening a layer reuses compact waveform and haptic analysis');
  decode = async () => buffer();
  const streamed = new StemPlayer();
  const streamContext = contexts.at(-1), streamNodes = [], events = [];
  streamContext.context = { createFileSource: options => { const node = { options, duration: 30, playbackRate: 1, connect() {}, disconnect() {}, seekToTime(value) { this.seek = value; events.push('seek'); }, start(value) { this.started = value; events.push('start'); }, pause() { events.push('pause'); }, stop() {} }; streamNodes.push(node); return node; }, createMediaElementSource: () => ({ connect() {}, disconnect() {} }) };
  await streamed.load(Object.fromEntries(['one', 'two', 'three', 'four', 'five'].map(name => [name, `file:///${name}.mp3`])));
  assert.equal(streamNodes.length, 5);
  assert.ok(streamNodes.every(node => node.options.preservesPitch === true), 'file playback keeps pitch');
  await streamed.play(); assert.equal(new Set(streamNodes.map(node => node.started)).size, 1);
  assert.deepEqual(events, [...Array(5).fill('pause'), ...Array(5).fill('seek'), ...Array(5).fill('start')], 'pause and seek every layer before starting any layer');
  events.length = 0;
  const seeking = streamed.seek(12);
  assert.equal(streamed.transport.playing, false, 'watch transport pauses during grouped seek');
  await seeking;
  assert.deepEqual(events, [...Array(5).fill('pause'), ...Array(5).fill('seek'), ...Array(5).fill('start')]);
  assert.ok(streamNodes.every(node => node.seek === 12));
  events.length = 0;
  const interrupted = streamed.seek(18);
  streamed.pause(); await interrupted;
  assert.equal(events.filter(event => event === 'start').length, 0, 'a paused seek cannot start playback later');
  await streamed.play();
  streamed.setPlaybackRate(.75); assert.ok(streamNodes.every(node => node.playbackRate === .75));
  await streamed.pause(); await streamed.dispose();
  console.log('PASS: 11-layer synchronized playback and independent volume, simultaneous start, pause/resume, seek, loop, end, gain, length validation, disposal, mute/solo/reset');
})().catch(error => { console.error(error); process.exitCode = 1; });
