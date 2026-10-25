// Runs every scripts/tracking/*.test.cjs: the pure TypeScript tracking logic in src/tracking/.
const fs = require('node:fs');
const path = require('node:path');
const dir = path.join(__dirname, 'tracking');
for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.test.cjs')).sort()) {
  require(path.join(dir, file));
  console.log(`PASS: ${file}`);
}
