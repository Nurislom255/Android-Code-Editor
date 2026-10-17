// scripts/icons.mjs — turns two icon sets into small JS modules the app
// imports (no font, no extra requests, works offline):
//
//   src/ui/codicons.js   UI icons from VS Code's Codicons (CC BY 4.0, Microsoft)
//   src/ui/fileIcons.js  file and folder icons from Material Icon Theme (MIT)
//
// Usage (each package unpacked in its own folder, e.g. with `npm pack` + tar):
//   node scripts/icons.mjs <codicons package dir> <material-icon-theme package dir>
//
// The packages are only READ as data: each SVG must be plain shapes. Anything
// else (scripts, styles, links, gradients) makes the icon fail loudly, and only
// whitelisted elements and attributes reach the output. Numbers are rounded to
// two decimals, which is invisible at icon sizes and keeps the bundle small.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [codiconsDir, materialDir] = process.argv.slice(2);
if (!codiconsDir || !materialDir) {
  console.error('usage: node scripts/icons.mjs <codicons package dir> <material-icon-theme package dir>');
  process.exit(1);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Our name → Codicon file. Icons not listed here (cursors, joystick,
// keyboardHide, gesture, format…) stay the app's own drawings in ui/dom.js.
const CODICONS = {
  menu: 'menu', chevronDown: 'chevron-down', chevronRight: 'chevron-right',
  back: 'arrow-left', forward: 'arrow-right', undo: 'discard', redo: 'redo', save: 'save',
  split: 'split-horizontal', play: 'play', stop: 'debug-stop', files: 'files', search: 'search',
  outline: 'list-tree', git: 'source-control', history: 'history', settings: 'settings-gear',
  close: 'close', plus: 'add', folder: 'folder', folderOpen: 'folder-opened', file: 'file',
  newFile: 'new-file', newFolder: 'new-folder', more: 'kebab-vertical', lock: 'lock', unlock: 'unlock',
  wrap: 'word-wrap', eye: 'eye', terminal: 'terminal', refresh: 'refresh', trash: 'trash', edit: 'edit',
  upload: 'cloud-upload', download: 'cloud-download', copy: 'copy', check: 'check', clear: 'clear-all',
  maximize: 'screen-full', minimize: 'screen-normal', zip: 'file-zip', device: 'device-mobile',
  branch: 'git-branch', sync: 'sync', info: 'info', error: 'error', warning: 'warning', pin: 'pin', rename: 'rename', zen: 'layout-centered',
};

// File icons: Material Icon Theme name → the extensions / exact file names using it.
const FILES = {
  javascript: { ext: ['js', 'mjs', 'cjs'] },
  typescript: { ext: ['ts', 'mts', 'cts'] },
  'typescript-def': { ext: ['d.ts'] },
  react: { ext: ['jsx'] },
  react_ts: { ext: ['tsx'] },
  html: { ext: ['html', 'htm'] },
  css: { ext: ['css'] },
  sass: { ext: ['scss', 'sass'] },
  less: { ext: ['less'] },
  json: { ext: ['json', 'jsonc', 'json5'] },
  markdown: { ext: ['md', 'markdown'] },
  python: { ext: ['py', 'pyw'] },
  c: { ext: ['c'] },
  h: { ext: ['h'] },
  cpp: { ext: ['cpp', 'cc', 'cxx'] },
  hpp: { ext: ['hpp', 'hh', 'hxx'] },
  csharp: { ext: ['cs'] },
  java: { ext: ['java'] },
  kotlin: { ext: ['kt', 'kts'], flat: '#b75eff' }, // its gradient (ids would clash inline) as one colour
  go: { ext: ['go'] },
  rust: { ext: ['rs'] },
  dart: { ext: ['dart'] },
  php: { ext: ['php'] },
  ruby: { ext: ['rb'] },
  swift: { ext: ['swift'] },
  lua: { ext: ['lua'] },
  vue: { ext: ['vue'] },
  console: { ext: ['sh', 'bash', 'zsh', 'bat', 'cmd', 'ps1'] },
  yaml: { ext: ['yml', 'yaml'] },
  xml: { ext: ['xml'] },
  svg: { ext: ['svg'] },
  image: { ext: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif'] },
  database: { ext: ['sql', 'db', 'sqlite'] },
  document: { ext: ['txt', 'log'] },
  zip: { ext: ['zip', 'gz', 'tgz', 'rar', '7z'] },
  settings: { ext: ['ini', 'cfg', 'conf', 'toml', 'env'], names: ['.env'] },
  git: { names: ['.gitignore', '.gitattributes', '.gitmodules'] },
  nodejs: { names: ['package.json', 'package-lock.json'] },
  tsconfig: { names: ['tsconfig.json', 'jsconfig.json'] },
  editorconfig: { names: ['.editorconfig'] },
  readme: { names: ['readme.md', 'readme.txt', 'readme'] },
  certificate: { names: ['license', 'license.md', 'license.txt', 'copying'] },
  docker: { names: ['dockerfile', '.dockerignore'] },
  lock: { ext: ['lock'] },
  file: {}, // anything else
};

// Folder icons (closed + "-open"): Material name → folder names using it.
const FOLDERS = {
  folder: [],
  'folder-src': ['src', 'source', 'sources', 'code'],
  'folder-test': ['test', 'tests', '__tests__', 'spec', 'specs', 'e2e'],
  'folder-docs': ['docs', 'doc', 'documentation'],
  'folder-images': ['images', 'image', 'img', 'imgs', 'icons', 'assets', 'static', 'media'],
  'folder-scripts': ['scripts', 'script', 'bin', 'tools'],
  'folder-node': ['node_modules'],
  'folder-git': ['.git'],
  'folder-github': ['.github'],
  'folder-public': ['public', 'www', 'wwwroot'],
  'folder-dist': ['dist', 'build', 'out', 'output', 'release'],
  'folder-components': ['components', 'component', 'widgets', 'ui'],
  'folder-javascript': ['js', 'javascript'],
  'folder-lib': ['lib', 'libs', 'vendor', 'third_party'],
  'folder-config': ['config', 'configs', '.vscode', 'settings'],
};

// ---- a strict reader for plain-shape SVGs -----------------------------------------

const ELEMENTS = new Set(['path', 'circle', 'rect', 'ellipse', 'g']);
const ATTRS = new Set(['d', 'fill', 'fill-rule', 'clip-rule', 'opacity', 'fill-opacity', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'width', 'height', 'transform']);
const SAFE_VALUE = /^[\w\s.,#%()+-]*$/;

function round(n) {
  // "011" can be two arc flags and a number run together: leave it alone
  if (/^-?0\d/.test(n)) return n;
  const r = Math.round(Number(n) * 100) / 100;
  return String(r === 0 ? 0 : r).replace(/^(-?)0\./, '$1.');
}

/** Numbers rounded, then the spaces SVG doesn't need dropped ("1 -2" → "1-2"). */
function compactPath(d) {
  return d.replace(/-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/gi, round).replace(/\s+/g, ' ').replace(/ ?([a-zA-Z]) ?/g, '$1').replace(/ -/g, '-').trim();
}

function readSvg(text, file) {
  const svgTag = /<svg\b([^>]*)>/.exec(text);
  if (!svgTag) throw new Error(`${file}: no <svg>`);
  const viewBox = (/viewBox="([^"]+)"/.exec(svgTag[1]) || [])[1] || '0 0 16 16';
  if (!SAFE_VALUE.test(viewBox)) throw new Error(`${file}: odd viewBox`);
  const body = text.slice(svgTag.index + svgTag[0].length, text.lastIndexOf('</svg>'));
  let out = '';
  const re = /<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>|([^<]+)/g;
  for (let m; (m = re.exec(body));) {
    if (m[5] != null) { if (m[5].trim()) throw new Error(`${file}: text content`); continue; }
    const [, close, name, attrs, selfClose] = m;
    if (!ELEMENTS.has(name)) throw new Error(`${file}: <${name}> is not allowed`);
    if (close) { out += `</${name}>`; continue; }
    let tag = `<${name}`;
    for (const a of attrs.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) {
      const [, key, raw] = a;
      if (key === 'xmlns' || key === 'id' || key.startsWith('data-')) continue; // metadata (nothing may reference an id)
      if (!ATTRS.has(key)) throw new Error(`${file}: attribute ${key} is not allowed`);
      if (!SAFE_VALUE.test(raw)) throw new Error(`${file}: odd value in ${key}`);
      // an invisible full-size box some icons carry for padding
      const value = key === 'd' ? compactPath(raw) : /^(cx|cy|r|rx|ry|x|y|width|height)$/.test(key) ? round(raw) : raw;
      tag += ` ${key}="${value}"`;
    }
    out += tag + (selfClose ? '/>' : '>');
  }
  // Drop no-op squares like <path d="M0 0h24v24H0z"/> (with fill="none" on the svg).
  out = out.replace(/<path d="M0 0h(\d+)v\1H0z"\/>/g, '');
  const fillNone = /fill="none"/.test(svgTag[1]);
  return { viewBox, body: out, fillNone };
}

async function svg(dir, name, flat = null) {
  const file = path.join(dir, `${name}.svg`);
  let text = await readFile(file, 'utf8');
  if (flat) text = text.replace(/<defs>[\s\S]*?<\/defs>/, '').replace(/url\(#[\w-]+\)/g, flat);
  return readSvg(text, file);
}

const js = (v) => JSON.stringify(v);

// ---- Codicons -------------------------------------------------------------------------

const codiconsPkg = JSON.parse(await readFile(path.join(codiconsDir, 'package.json'), 'utf8'));
let codiconsOut = `// GENERATED by scripts/icons.mjs — do not edit by hand.
//
// UI icons from Codicons ${codiconsPkg.version} by Microsoft
// (https://github.com/microsoft/vscode-codicons), licensed under the
// Creative Commons Attribution 4.0 International licence (CC BY 4.0,
// https://creativecommons.org/licenses/by/4.0/).
// Changes: path numbers rounded to two decimals; only the icons the app uses.
//
// name → inner SVG markup for a 16×16 viewBox (or [viewBox, markup]), drawn in currentColor.
export const CODICONS = {
`;
for (const [ours, theirs] of Object.entries(CODICONS)) {
  const { viewBox, body } = await svg(path.join(codiconsDir, 'src/icons'), theirs);
  codiconsOut += `  ${ours}: ${viewBox === '0 0 16 16' ? js(body) : `[${js(viewBox)}, ${js(body)}]`}, // ${theirs}\n`;
}
codiconsOut += '};\n';
await writeFile(path.join(root, 'src/ui/codicons.js'), codiconsOut);

// ---- Material file / folder icons -------------------------------------------------------

const materialPkg = JSON.parse(await readFile(path.join(materialDir, 'package.json'), 'utf8'));
const iconDir = path.join(materialDir, 'icons');
const icons = {};
const ext = {};
const names = {};
for (const [name, { ext: exts = [], names: files = [], flat }] of Object.entries(FILES)) {
  icons[name] = await svg(iconDir, name, flat);
  for (const e of exts) ext[e] = name;
  for (const f of files) names[f] = name;
}
const folders = {};
for (const [name, dirs] of Object.entries(FOLDERS)) {
  icons[name] = await svg(iconDir, name);
  icons[`${name}-open`] = await svg(iconDir, `${name}-open`);
  for (const d of dirs) folders[d] = name;
}
let filesOut = `// GENERATED by scripts/icons.mjs — do not edit by hand.
//
// File and folder icons from Material Icon Theme ${materialPkg.version}
// (https://github.com/material-extensions/vscode-material-icon-theme),
// MIT licence, Copyright (c) 2025 Material Extensions.
// Changes: path numbers rounded to two decimals; only common file types;
// the Kotlin icon's gradient flattened to one colour.

/** name → [viewBox, inner SVG markup, fill="none" on the root] */
export const FILE_ICON_SVG = {
`;
for (const [name, { viewBox, body, fillNone }] of Object.entries(icons)) {
  filesOut += `  ${js(name)}: [${js(viewBox)}, ${js(body)}${fillNone ? ', true' : ''}],\n`;
}
filesOut += `};

/** lower-case extension (without the dot) → icon */
export const FILE_EXT = ${js(ext)};

/** lower-case exact file name → icon */
export const FILE_NAMES = ${js(names)};

/** lower-case folder name → icon (add "-open" when expanded) */
export const FOLDER_NAMES = ${js(folders)};
`;
await writeFile(path.join(root, 'src/ui/fileIcons.js'), filesOut);

console.log(`codicons: ${Object.keys(CODICONS).length} icons, ${codiconsOut.length} bytes; file icons: ${Object.keys(icons).length} icons, ${filesOut.length} bytes`);
