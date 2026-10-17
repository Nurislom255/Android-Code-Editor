// Generated icon tables (scripts/icons.mjs) and the file-type lookup (ui/fileTypeIcons.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CODICONS } from '../../src/ui/codicons.js';
import * as table from '../../src/ui/fileIcons.js';
import { fileIconName, folderIconName } from '../../src/ui/fileTypeIcons.js';

const SAFE = /^(?:<(?:path|circle|rect|ellipse|g)(?: [\w-]+="[\w\s.,#%()+-]*")*\/?>|<\/g>)*$/;

test('every generated icon is plain shapes with whitelisted attributes (no scripts, links or styles)', () => {
  for (const [name, v] of Object.entries(CODICONS)) {
    const body = typeof v === 'string' ? v : v[1];
    assert.match(body, SAFE, `codicon ${name}`);
  }
  for (const [name, [box, body]] of Object.entries(table.FILE_ICON_SVG)) {
    assert.match(box, /^-?[\d.]+ -?[\d.]+ [\d.]+ [\d.]+$/, `viewBox of ${name}`);
    assert.match(body, SAFE, `file icon ${name}`);
  }
});

test('the UI icons the app draws come from Codicons', () => {
  for (const name of ['save', 'play', 'files', 'search', 'git', 'settings', 'close', 'folder', 'error', 'warning']) assert.ok(CODICONS[name], name);
});

test('file icons: exact names, then the longest extension, then the generic file', () => {
  assert.equal(fileIconName('main.js', table), 'javascript');
  assert.equal(fileIconName('App.TSX', table), 'react_ts');
  assert.equal(fileIconName('types.d.ts', table), 'typescript-def');
  assert.equal(fileIconName('index.ts', table), 'typescript');
  assert.equal(fileIconName('package.json', table), 'nodejs');
  assert.equal(fileIconName('data.json', table), 'json');
  assert.equal(fileIconName('README.md', table), 'readme');
  assert.equal(fileIconName('.gitignore', table), 'git');
  assert.equal(fileIconName('.env', table), 'settings');
  assert.equal(fileIconName('Dockerfile', table), 'docker');
  assert.equal(fileIconName('notes', table), 'file');
  assert.equal(fileIconName('archive.weird', table), 'file');
  for (const name of new Set([...Object.values(table.FILE_EXT), ...Object.values(table.FILE_NAMES), 'file'])) assert.ok(table.FILE_ICON_SVG[name], name);
});

test('folder icons: known names get their own, open folders the open variant', () => {
  assert.equal(folderIconName('src', false, table), 'folder-src');
  assert.equal(folderIconName('Tests', true, table), 'folder-test-open');
  assert.equal(folderIconName('whatever', true, table), 'folder-open');
  for (const name of new Set(Object.values(table.FOLDER_NAMES))) {
    assert.ok(table.FILE_ICON_SVG[name] && table.FILE_ICON_SVG[`${name}-open`], name);
  }
});
