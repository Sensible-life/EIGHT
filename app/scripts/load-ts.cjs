const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');
module.exports = function load(file) {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, Date, require: name => { if (!name.startsWith('.')) throw new Error(`Unexpected dependency ${name}`); return load(path.resolve(path.dirname(file), name + '.ts')); } }, { filename: file });
  return module.exports;
};
