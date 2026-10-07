// core/textFormat.js — reading and writing file bytes without damaging them.
//
// Spec §6 "File correctness": preserve encoding, BOM, line endings and the
// final-newline state unless the user changes them. The editor (CodeMirror)
// always works with "\n" internally, so on open we *record* what the file used
// and on save we put it back.
//
// Python analogy: this is what `open(path, newline='')` + manual handling
// does; by default Python silently converts line endings, which is exactly the
// behaviour a code editor must NOT have.

export const EOL = Object.freeze({ LF: '\n', CRLF: '\r\n', CR: '\r' });

const BINARY_SNIFF_BYTES = 8000;

/**
 * @param {Uint8Array} bytes
 * @returns {{text:string, encoding:string, bom:boolean, eol:string, mixedEol:boolean,
 *            finalNewline:boolean, binary:boolean, readOnlyReason:string|null}}
 */
export function decodeBytes(bytes) {
  let encoding = 'utf-8';
  let bom = false;
  let offset = 0;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    bom = true; offset = 3;
  } else if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    bom = true; offset = 2; encoding = 'utf-16le';
  } else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    bom = true; offset = 2; encoding = 'utf-16be';
  }
  const body = bytes.subarray(offset);

  let readOnlyReason = null;
  let binary = false;
  if (encoding === 'utf-8') {
    const sniff = body.subarray(0, BINARY_SNIFF_BYTES);
    if (sniff.includes(0)) binary = true;
  }

  let text;
  if (binary) {
    text = '';
    readOnlyReason = 'This looks like a binary file, so it was not opened as text.';
  } else if (encoding === 'utf-8') {
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(body);
    } catch {
      text = new TextDecoder('utf-8').decode(body);
      encoding = 'unknown';
      readOnlyReason = 'This file is not valid UTF-8. It is open read-only so saving cannot corrupt it.';
    }
  } else {
    text = decodeUtf16(body, encoding === 'utf-16le');
  }

  const eolInfo = detectEol(text);
  return {
    text,
    encoding,
    bom,
    eol: eolInfo.eol,
    mixedEol: eolInfo.mixed,
    finalNewline: /[\r\n]$/.test(text),
    binary,
    readOnlyReason,
  };
}

function decodeUtf16(bytes, littleEndian) {
  // TextDecoder supports utf-16le everywhere and utf-16be in modern engines,
  // but doing it by hand keeps both paths identical and testable.
  let out = '';
  const chunk = [];
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    chunk.push(littleEndian ? bytes[i] | (bytes[i + 1] << 8) : (bytes[i] << 8) | bytes[i + 1]);
    if (chunk.length === 8192) { out += String.fromCharCode(...chunk); chunk.length = 0; }
  }
  return out + String.fromCharCode(...chunk);
}

/** Counts each line-ending style; the most common one wins. */
export function detectEol(text) {
  let crlf = 0, lf = 0, cr = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 13) {
      if (text.charCodeAt(i + 1) === 10) { crlf++; i++; } else cr++;
    } else if (c === 10) lf++;
  }
  const kinds = [crlf, lf, cr].filter((n) => n > 0).length;
  let eol = EOL.LF;
  if (crlf > lf && crlf >= cr) eol = EOL.CRLF;
  else if (cr > lf && cr > crlf) eol = EOL.CR;
  return { eol, mixed: kinds > 1, counts: { crlf, lf, cr } };
}

export function normalizeNewlines(text) {
  return text.replace(/\r\n?/g, '\n');
}

/**
 * Applies save-time transforms (EditorConfig `trim_trailing_whitespace`,
 * `insert_final_newline`). Works on "\n"-normalized text.
 */
export function applySaveTransforms(text, { trimTrailingWhitespace = false, insertFinalNewline = null } = {}) {
  let out = text;
  if (trimTrailingWhitespace) out = out.replace(/[ \t]+$/gm, '');
  if (insertFinalNewline === true && out.length > 0 && !out.endsWith('\n')) out += '\n';
  if (insertFinalNewline === false) out = out.replace(/\n+$/, '');
  return out;
}

/**
 * @param {string} text  editor text with "\n" line breaks
 * @param {{encoding?:string, bom?:boolean, eol?:string}} format
 * @returns {Uint8Array}
 */
export function encodeText(text, format = {}) {
  const eol = format.eol || EOL.LF;
  const withEol = eol === EOL.LF ? text : text.replace(/\n/g, eol);
  const encoding = format.encoding || 'utf-8';

  if (encoding === 'utf-16le' || encoding === 'utf-16be') {
    const le = encoding === 'utf-16le';
    const out = new Uint8Array(withEol.length * 2 + (format.bom ? 2 : 0));
    let o = 0;
    if (format.bom) { out[o++] = le ? 0xff : 0xfe; out[o++] = le ? 0xfe : 0xff; }
    for (let i = 0; i < withEol.length; i++) {
      const c = withEol.charCodeAt(i);
      if (le) { out[o++] = c & 0xff; out[o++] = c >> 8; } else { out[o++] = c >> 8; out[o++] = c & 0xff; }
    }
    return out;
  }

  const body = new TextEncoder().encode(withEol);
  if (!format.bom) return body;
  const out = new Uint8Array(body.length + 3);
  out.set([0xef, 0xbb, 0xbf], 0);
  out.set(body, 3);
  return out;
}

/** FNV-1a 32-bit — a cheap fingerprint to notice "the file on disk changed". */
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export const LIMITS = Object.freeze({
  noHighlightLineLength: 3000,     // minified JS: one 200 KB line
  noHighlightBytes: 2 * 1024 * 1024,
  readOnlyBytes: 8 * 1024 * 1024,
});

/**
 * Spec §4.1/§6: past a size or line-length threshold, degrade instead of
 * freezing. Returns what to switch off for this text.
 */
export function degradeFor(text) {
  let longest = 0;
  let start = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text.charCodeAt(i) === 10) {
      longest = Math.max(longest, i - start);
      start = i + 1;
    }
  }
  const size = text.length;
  const reasons = [];
  let highlight = true, wrap = true, readOnly = false;
  if (longest > LIMITS.noHighlightLineLength) {
    highlight = false; wrap = false;
    reasons.push(`a line is ${longest.toLocaleString('en')} characters long`);
  }
  if (size > LIMITS.noHighlightBytes) {
    highlight = false;
    reasons.push(`the file is ${(size / 1048576).toFixed(1)} MB`);
  }
  if (size > LIMITS.readOnlyBytes) readOnly = true;
  return { highlight, wrap, readOnly, longestLine: longest, reason: reasons.join(' and ') || null };
}

export function eolLabel(eol) {
  return eol === EOL.CRLF ? 'CRLF' : eol === EOL.CR ? 'CR' : 'LF';
}
