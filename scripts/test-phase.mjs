// scripts/test-phase.mjs — runs the tests that prove one ROADMAP phase
// (the map is tests/phases.json; what each test checks is in TESTS.md).
//
//   npm run test:phase -- 3                 unit + e2e of Phase 3, all screen sizes
//   npm run test:phase -- 3 --unit          only the unit tests
//   npm run test:phase -- 3 --e2e --project=phone   only e2e, only the phone
//   npm run test:phase -- base 1 2 3        several phases at once
//
// Build first (npm run build): the e2e tests run against docs/.

import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const phases = JSON.parse(readFileSync(path.join(root, 'tests/phases.json'), 'utf8'));
const args = process.argv.slice(2);
const wanted = args.filter((a) => !a.startsWith('-'));
const extra = args.filter((a) => a.startsWith('-') && a !== '--unit' && a !== '--e2e');
const onlyUnit = args.includes('--unit');
const onlyE2e = args.includes('--e2e');

if (!wanted.length || wanted.some((p) => !phases[p] || p.startsWith('_'))) {
  console.error(`usage: npm run test:phase -- <phase…> [--unit|--e2e] [playwright options]\nphases: base, ${Object.keys(phases).filter((k) => !k.startsWith('_') && k !== 'base').join(', ')}`);
  process.exit(2);
}

const unit = [];
const e2e = [];
for (const p of wanted) {
  console.log(`Phase ${p}: ${phases[p].title}`);
  for (const f of phases[p].unit) unit.push(`tests/unit/${f}.test.mjs`);
  for (const f of phases[p].e2e) e2e.push(`tests/e2e/${f}.spec.mjs`);
}
for (const f of [...unit, ...e2e]) if (!existsSync(path.join(root, f))) { console.error(`missing test file: ${f}`); process.exit(2); }

let failed = false;
const run = (cmd, list) => {
  const r = spawnSync(cmd, list, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) failed = true;
};
if (!onlyE2e && unit.length) run('node', ['--test', ...unit]);
// --no-deps: the timing tests' project waits for all others in a full run
// (playwright.config.mjs); a phase run takes only its own files.
if (!onlyUnit && e2e.length) run('npx', ['playwright', 'test', '--no-deps', ...e2e, ...extra]);
process.exit(failed ? 1 : 0);
