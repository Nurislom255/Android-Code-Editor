// workers/format.worker.js — Prettier, bundled and offline (spec §4.8).
//
// Runs in a worker so formatting a big file never blocks typing, and so the
// ~1 MB of Prettier code is only downloaded the first time you format.

import * as prettier from 'prettier/standalone';
import * as babel from 'prettier/plugins/babel';
import * as estree from 'prettier/plugins/estree';
import * as html from 'prettier/plugins/html';
import * as postcss from 'prettier/plugins/postcss';
import * as markdown from 'prettier/plugins/markdown';
import * as yaml from 'prettier/plugins/yaml';

const plugins = [babel, estree, html, postcss, markdown, yaml];

self.onmessage = async (e) => {
  const { id, text, parser, cursorOffset, options } = e.data;
  try {
    const res = await prettier.formatWithCursor(text, {
      parser, plugins, cursorOffset: Math.max(0, Math.min(cursorOffset, text.length)),
      endOfLine: 'lf', ...options,
    });
    self.postMessage({ id, ok: true, formatted: res.formatted, cursorOffset: res.cursorOffset });
  } catch (err) {
    // Prettier's messages include "(line:col)" and a code frame.
    self.postMessage({ id, ok: false, error: String(err && err.message ? err.message : err) });
  }
};
