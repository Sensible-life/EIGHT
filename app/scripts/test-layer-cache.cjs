const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const stored = new Map();
const metadata = new Map([['file:///music/bass.mp3', { size: 12345, modificationTime: 100 }]]);
class Directory { constructor(base, name) { this.uri = `${base.uri}/${name}`; } create() {} }
class File {
  constructor(base, name) { this.uri = typeof base === 'string' ? base : `${base.uri}/${name}`; }
  info() { const m = metadata.get(this.uri); return m ? { exists: true, ...m } : { exists: false }; }
  get exists() { return stored.has(this.uri); }
  textSync() { return stored.get(this.uri); }
  create() { stored.set(this.uri, ''); }
  write(value) { stored.set(this.uri, value); }
}
function load() {
  const module = { exports: {} };
  const js = ts.transpileModule(fs.readFileSync('src/audio/layerAnalysisCache.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(js, { module, exports: module.exports, require: name => name === 'expo-file-system' ? { Directory, File, Paths: { document: { uri: 'file:///documents' } } } : { Platform: { OS: 'android' } } });
  return module.exports;
}
const data = { waveform: Array(64).fill(.4), envelope: [.3, .5], pulses: [{ t: 1.2, strength: .8 }] };
load().writeLayerAnalysis('file:///music/bass.mp3', 'bass', data);
assert.equal(stored.size, 1);
const cached = load().readLayerAnalysis('file:///music/bass.mp3', 'bass');
assert.equal(cached.pulses[0].t, 1.2, 'cache survives a fresh module instance');
metadata.get('file:///music/bass.mp3').modificationTime++;
assert.equal(load().readLayerAnalysis('file:///music/bass.mp3', 'bass'), null, 'changed source does not reuse stale cache');
metadata.get('file:///music/bass.mp3').modificationTime--;
stored.set([...stored.keys()][0], '{invalid json');
assert.equal(load().readLayerAnalysis('file:///music/bass.mp3', 'bass'), null, 'corrupt cache falls back safely');
console.log('PASS: analysis cache persists across loads and invalidates changed or corrupt data');
