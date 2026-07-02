'use strict';
/* Forge Studio — texture mode test runner.
   Runs every *.test.js in this directory in a fresh child process so
   shared globals (window.GF, GF.util shims) don't leak between suites.
   Usage:  node texture/tests/run.js */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const dir = __dirname;
const suites = fs.readdirSync(dir)
  .filter(f => f.endsWith('.test.js'))
  .sort();

let failed = 0;
for (const f of suites) {
  console.log('━━ ' + f + ' ' + '━'.repeat(60 - f.length));
  const r = spawnSync(process.execPath, [path.join(dir, f)], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}

if (failed) {
  console.log('\n' + failed + ' suite(s) failed');
  process.exit(1);
}
console.log('\nAll suites passed');
