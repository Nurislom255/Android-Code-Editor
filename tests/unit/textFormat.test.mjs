import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeBytes, encodeText, detectEol, applySaveTransforms, degradeFor, hashString, normalizeNewlines, EOL,
} from '../../src/core/textFormat.js';

const enc = (s) => new TextEncoder().encode(s);

test('plain UTF-8 LF file round-trips byte for byte', () => {
  const bytes = enc('a\nb\n');
  const info = decodeBytes(bytes);
  assert.equal(info.text, 'a\nb\n');
  assert.equal(info.eol, EOL.LF);
  assert.equal(info.bom, false);
  assert.equal(info.finalNewline, true);
  assert.deepEqual(encodeText(normalizeNewlines(info.text), info), bytes);
});

test('CRLF + BOM are detected and restored on save', () => {
  const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...enc('x\r\ny\r\n')]);
  const info = decodeBytes(bytes);
  assert.equal(info.bom, true);
  assert.equal(info.eol, EOL.CRLF);
  assert.equal(info.text.startsWith('﻿'), false, 'BOM is not part of the text');
  const edited = normalizeNewlines(info.text) + 'z\n';
  const out = encodeText(edited, info);
  assert.deepEqual([...out.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.equal(new TextDecoder().decode(out.slice(3)), 'x\r\ny\r\nz\r\n');
});

test('no final newline stays without one', () => {
  const info = decodeBytes(enc('one\ntwo'));
  assert.equal(info.finalNewline, false);
  assert.equal(new TextDecoder().decode(encodeText('one\ntwo', info)), 'one\ntwo');
});

test('mixed line endings are reported, majority wins', () => {
  const r = detectEol('a\r\nb\r\nc\nd\r\n');
  assert.equal(r.eol, EOL.CRLF);
  assert.equal(r.mixed, true);
  assert.equal(detectEol('only one line').eol, EOL.LF);
});

test('invalid UTF-8 opens read-only with a reason', () => {
  const info = decodeBytes(new Uint8Array([0x61, 0xff, 0xfe, 0x62, 0x0a]));
  assert.equal(info.encoding, 'unknown');
  assert.match(info.readOnlyReason, /not valid UTF-8/);
});

test('binary files are flagged', () => {
  const info = decodeBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 1]));
  assert.equal(info.binary, true);
  assert.ok(info.readOnlyReason);
});

test('UTF-16LE with BOM round-trips', () => {
  const src = 'héllo\r\nwörld 😀\r\n';
  const le = encodeText(src.replace(/\r\n/g, '\n'), { encoding: 'utf-16le', bom: true, eol: EOL.CRLF });
  assert.deepEqual([...le.slice(0, 2)], [0xff, 0xfe]);
  const info = decodeBytes(le);
  assert.equal(info.encoding, 'utf-16le');
  assert.equal(info.text, src);
  assert.equal(info.eol, EOL.CRLF);
  assert.deepEqual(encodeText(normalizeNewlines(info.text), info), le);
});

test('save transforms: trim trailing whitespace and final newline', () => {
  assert.equal(applySaveTransforms('a  \nb\t\n', { trimTrailingWhitespace: true }), 'a\nb\n');
  assert.equal(applySaveTransforms('a', { insertFinalNewline: true }), 'a\n');
  assert.equal(applySaveTransforms('a\n\n', { insertFinalNewline: false }), 'a');
  assert.equal(applySaveTransforms('a  ', {}), 'a  ', 'no options = untouched');
});

test('degrade: minified one-liner disables highlighting and wrap', () => {
  const d = degradeFor('x'.repeat(10000));
  assert.equal(d.highlight, false);
  assert.equal(d.wrap, false);
  assert.match(d.reason, /10,000 characters/);
  assert.equal(degradeFor('short\nfile').highlight, true);
});

test('hashString is stable and sensitive', () => {
  assert.equal(hashString('abc'), hashString('abc'));
  assert.notEqual(hashString('abc'), hashString('abd'));
});
