const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(path, imports, globals = {}) {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, require: name => {
    assert.ok(name in imports, `unexpected import ${name}`); return imports[name];
  }, Blob, File, TextEncoder, Uint8Array, ArrayBuffer, ...globals }, { filename: path });
  return module.exports;
}
class RNFormData { constructor() { this._parts = []; } }
// Match the native RN Blob limitation, instead of using Node's permissive Blob.
class NativeBlob {
  constructor(parts = []) {
    if (parts.some(part => part instanceof ArrayBuffer || ArrayBuffer.isView(part))) {
      throw new Error('Creating blobs from ArrayBuffer and ArrayBufferView are not supported');
    }
  }
}
const { installFormDataPatch } = load('node_modules/expo/src/winter/FormData.ts', {}, {Blob: NativeBlob});
const FormData = installFormDataPatch(RNFormData);
const blobUtils = load('node_modules/expo/src/utils/blobUtils.ts', {});
const { convertFormDataAsync } = load('node_modules/expo/src/winter/fetch/convertFormData.ts', {'../../utils/blobUtils': blobUtils}, {Blob: NativeBlob});
const audioBytes = Uint8Array.from([0x49, 0x44, 0x33, 0, 0xff, 0x80, 7]);
const reads = [];
class LocalFile {
  constructor(uri) { this.uri = uri; }
  get name() { return this.uri.split('/').at(-1); }
  get type() { return this.uri.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg'; }
  async bytes() { reads.push(this.uri); return audioBytes; }
  async arrayBuffer() { throw new Error('The upload must not create an ArrayBuffer Blob'); }
}
const posts = [];
const imports = {
  'expo-file-system': { File: LocalFile },
  'expo/fetch': { fetch: async (url, options) => {
    // Exercise the exact SDK converter that emitted the user's error.
    const result = await convertFormDataAsync(options.body, 'test-boundary');
    posts.push({ url, bytes: result.body });
    return { ok: true, json: async () => ({id: 'queued-job'}) };
  } },
};
const { api } = load('src/api.ts', imports, { FormData, Blob: NativeBlob });
(async () => {
  assert.throws(() => new NativeBlob([audioBytes]), /ArrayBufferView/, 'reproduce the second native Blob error');
  const legacy = new FormData();
  legacy.append('file', {uri: 'file:///cache/song.mp3', name: 'song.mp3', type: 'audio/mpeg'});
  await assert.rejects(convertFormDataAsync(legacy), /Unsupported FormDataPart implementation/, 'reproduce the original SDK error');
  const job = await api.upload('http://server:8000/', {uri: 'file:///cache/UUID.mp3', name: '내 노래.mp3', mimeType: 'audio/mpeg'}, {
    model: 'auto', shifts: 1, provider: 'lalal', lalalMode: 'multistem', lalalStems: ['vocals', 'bass', 'drum'], splitVocals: true,
  });
  assert.equal(job.id, 'queued-job');
  assert.equal(reads.length, 1);
  assert.equal(posts[0].url, 'http://server:8000/jobs');
  const wire = Buffer.from(posts[0].bytes);
  assert.ok(wire.includes(Buffer.from(audioBytes)), 'binary audio bytes are preserved');
  const text = wire.toString();
  assert.ok(text.includes('filename="UUID.mp3"'), 'send native File without constructing a Blob');
  assert.ok(text.includes('내 노래.mp3'), 'preserve picked name in original_name field');
  assert.ok(text.includes('content-type: audio/mpeg'));
  assert.ok(text.includes('["vocals","bass","drum"]'));
  assert.ok(text.includes('true'));
  await api.upload('http://server', {uri: 'file:///cache/x.wav', name: 'piano.wav'}, {model: 'auto', shifts: 1});
  assert.ok(Buffer.from(posts[1].bytes).toString().includes('content-type: audio/wav'));
  const browserFile = new File([audioBytes], 'browser.mp3', {type: 'audio/mpeg'});
  const { convertFormDataAsync: browserConvert } = load('node_modules/expo/src/winter/fetch/convertFormData.ts', {'../../utils/blobUtils': blobUtils});
  const browserImports = {...imports, 'expo/fetch': {fetch: async (url, options) => {
    const result = await browserConvert(options.body, 'test-boundary');
    posts.push({url, bytes: result.body});
    return {ok: true, json: async () => ({id: 'queued-job'})};
  }}};
  const { api: browserApi } = load('src/api.ts', browserImports, {FormData: globalThis.FormData});
  await browserApi.upload('http://server', {uri: 'blob:browser', name: 'browser.mp3', file: browserFile}, {model: 'auto', shifts: 1});
  assert.equal(reads.length, 2, 'browser File bypasses native filesystem');
  assert.ok(Buffer.from(posts[2].bytes).includes(Buffer.from(audioBytes)));
  console.log('PASS: reproduce native URI and ArrayBuffer Blob errors; native MP3/WAV and browser uploads pass actual Expo SDK multipart converter, preserving bytes, filename, and options');
})().catch(error => {console.error(error); process.exitCode = 1;});
