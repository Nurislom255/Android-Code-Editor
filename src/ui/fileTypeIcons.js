// ui/fileTypeIcons.js — file and folder icons by type (Material Icon Theme,
// generated into ./fileIcons.js by scripts/icons.mjs).
//
// The icon table is its own chunk, fetched as soon as the app starts but
// never holding up the first paint: an icon asked for before it arrives is
// drawn as a plain file/folder and filled in when the table lands.

import { h, icon } from './dom.js';

let table = null;

/** Pure: which icon a file name gets. Exact names first, then the longest extension ("d.ts" before "ts"). */
export function fileIconName(name, t) {
  const lower = name.toLowerCase();
  if (t.FILE_NAMES[lower]) return t.FILE_NAMES[lower];
  const parts = lower.split('.');
  for (let i = 1; i < parts.length; i++) {
    const ext = parts.slice(i).join('.');
    if (t.FILE_EXT[ext]) return t.FILE_EXT[ext];
  }
  return 'file';
}

/** Pure: which icon a folder gets ("src" → folder-src, open → "-open"). */
export function folderIconName(name, open, t) {
  return (t.FOLDER_NAMES[name.toLowerCase()] || 'folder') + (open ? '-open' : '');
}

function svgFor(iconName, size = 16) {
  const [box, body, fillNone] = table.FILE_ICON_SVG[iconName] || table.FILE_ICON_SVG.file;
  return `<svg viewBox="${box}" width="${size}" height="${size}"${fillNone ? ' fill="none"' : ''} aria-hidden="true" focusable="false">${body}</svg>`;
}

function fill(el) {
  const { fiName, fiFolder, fiOpen } = el.dataset;
  const name = fiFolder != null ? folderIconName(fiFolder, fiOpen === '1', table) : fileIconName(fiName, table);
  el.innerHTML = svgFor(name);
  el.dataset.icon = name;
  el.classList.remove('fi-pending');
}

const ready = import('./fileIcons.js').then((m) => {
  table = m;
  if (typeof document !== 'undefined') for (const el of document.querySelectorAll('.file-icon.fi-pending')) fill(el);
});
export const fileIconsReady = () => ready;

/** <span class="file-icon"> for a file name. */
export function fileIcon(name) {
  const el = h('span.file-icon', { dataset: { fiName: name } });
  if (table) fill(el);
  else { el.classList.add('fi-pending'); el.innerHTML = icon('file', 16); }
  return el;
}

/** <span class="file-icon"> for a folder, closed or open. */
export function folderIcon(name, open) {
  const el = h('span.file-icon', { dataset: { fiFolder: name, fiOpen: open ? '1' : '0' } });
  if (table) fill(el);
  else { el.classList.add('fi-pending'); el.innerHTML = icon(open ? 'folderOpen' : 'folder', 16); }
  return el;
}
