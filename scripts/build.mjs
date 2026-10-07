// scripts/build.mjs — builds the app into docs/ (served by GitHub Pages, and
// the folder Capacitor wraps into the APK).
//
//   node scripts/build.mjs        production build (minified)
//   node scripts/build.mjs --dev  readable build with source maps
//
// Output:
//   main.js + chunks/*.js   the app as ES modules; languages, git, Markdown and
//                           zip support are separate chunks loaded on demand
//   run-worker.js           JS runner sandbox (classic worker)
//   format-worker.js        Prettier (classic worker, loaded on first format)
//   sw.js                   service worker precaching everything → works offline

import * as esbuild from 'esbuild';
import { readFile, writeFile, rm, mkdir, cp, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'docs');
const dev = process.argv.includes('--dev');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));

const common = {
  bundle: true,
  minify: !dev,
  sourcemap: dev ? 'linked' : false,
  target: ['es2020', 'chrome80'],
  legalComments: 'none',
  logLevel: 'warning',
  define: { __APP_VERSION__: JSON.stringify(pkg.version), 'process.env.NODE_ENV': '"production"', global: 'globalThis' },
};

// Clean previous output, but keep files that aren't build products (e.g. CNAME).
await mkdir(out, { recursive: true });
for (const name of await readdir(out)) {
  if (['CNAME', '.nojekyll'].includes(name)) continue;
  await rm(path.join(out, name), { recursive: true, force: true });
}

await esbuild.build({
  ...common,
  entryPoints: { main: path.join(root, 'src/main.js') },
  outdir: out,
  format: 'esm',
  splitting: true,
  chunkNames: 'chunks/[name]-[hash]',
});

await esbuild.build({
  ...common,
  entryPoints: {
    'run-worker': path.join(root, 'src/workers/run.worker.js'),
    'format-worker': path.join(root, 'src/workers/format.worker.js'),
  },
  outdir: out,
  format: 'iife',
});

await cp(path.join(root, 'src/index.html'), path.join(out, 'index.html'));
await cp(path.join(root, 'src/styles.css'), path.join(out, 'styles.css'));
await cp(path.join(root, 'static'), out, { recursive: true, filter: (src) => !src.endsWith('sw.template.js') });
await writeFile(path.join(out, '.nojekyll'), '');

// ---- service worker: precache every built file ----------------------------
async function walk(dir, base = '') {
  const files = [];
  for (const name of await readdir(dir)) {
    const rel = base ? `${base}/${name}` : name;
    const full = path.join(dir, name);
    if ((await stat(full)).isDirectory()) files.push(...(await walk(full, rel)));
    else files.push(rel);
  }
  return files;
}
const assets = (await walk(out)).filter((f) => !/(^|\/)(sw\.js|CNAME|\.nojekyll)$|\.map$/.test(f)).sort();
const hash = createHash('sha256');
for (const f of assets) hash.update(f).update(await readFile(path.join(out, f)));
const version = `${pkg.version}-${hash.digest('hex').slice(0, 10)}`;
const swTemplate = await readFile(path.join(root, 'static/sw.template.js'), 'utf8');
await writeFile(path.join(out, 'sw.js'), swTemplate
  .replace('__VERSION__', version)
  .replace('__ASSETS__', JSON.stringify(['./', ...assets], null, 0)));

let total = 0;
for (const f of assets) total += (await stat(path.join(out, f))).size;
const mainSize = (await stat(path.join(out, 'main.js'))).size;
console.log(`Built ${assets.length} files into docs/ (${(total / 1024).toFixed(0)} KB total, main.js ${(mainSize / 1024).toFixed(0)} KB) — version ${version}`);
