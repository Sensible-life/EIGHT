const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const files = new Map([['file:///cache/video.mp4', 1234]]);
class Directory { constructor(base, path) { this.uri = `${base.uri}/${path}`; } create() {} }
class File {
  constructor(base, name) { this.uri = typeof base === 'string' ? base : `${base.uri}/${name}`; }
  get exists() { return files.has(this.uri); }
  get size() { return files.get(this.uri) ?? 0; }
  async copy(to) { await new Promise(resolve => setTimeout(resolve, 5)); if (!this.exists) throw new Error('missing source'); files.set(to.uri, this.size); }
  delete() { files.delete(this.uri); }
}
const moduleUnderTest = { exports: {} };
const js = ts.transpileModule(fs.readFileSync('src/storage/media.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
vm.runInNewContext(js, { module: moduleUnderTest, exports: moduleUnderTest.exports, setTimeout, require: name => name === 'expo-file-system' ? { File, Directory, Paths: { document: { uri: 'file:///documents' }, cache: { uri: 'file:///cache' } } } : { Platform: { OS: 'android' } } });
(async () => {
  const result = await moduleUnderTest.exports.saveMedia('file:///cache/video.mp4', '.mp4');
  assert.equal(files.get(result), 1234, 'save waits for asynchronous copy before validating the destination');
  assert.equal(files.get('file:///cache/video.mp4'), 1234, 'copy preserves source until caller confirms success');
  await assert.rejects(moduleUnderTest.exports.saveMedia('file:///cache/missing.mp4', '.mp4'), /missing source/);
  console.log('PASS: media save waits for copy and reports copy failure');
})().catch(error => { console.error(error); process.exitCode = 1; });
