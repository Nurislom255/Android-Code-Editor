// core/editorconfig.js — `.editorconfig` parsing and resolution (spec §2 Phase 2).
//
// An .editorconfig file is INI: an optional `root = true` preamble, then
// `[glob]` sections with `key = value` pairs. For a given file, every
// .editorconfig from the file's folder up to the nearest `root = true` applies;
// files closer to the file win, and later sections in one file beat earlier
// ones. Spec: https://spec.editorconfig.org

/** @returns {{root:boolean, sections:{glob:string, props:Object<string,string>}[]}} */
export function parseEditorConfig(text) {
  const result = { root: false, sections: [] };
  let current = null;
  for (const rawLine of text.split(/\r\n?|\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const section = line.match(/^\[(.*)\]$/);
    if (section) {
      current = { glob: section[1], props: {} };
      result.sections.push(current);
      continue;
    }
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim().toLowerCase();
    let value = line.slice(eq + 1).trim();
    if (!current) {
      if (key === 'root') result.root = value.toLowerCase() === 'true';
      continue;
    }
    if (key.length > 1024 || value.length > 4096) continue;
    // Values are case-insensitive except where they aren't meaningful as enums.
    if (/^(true|false|lf|crlf|cr|tab|space|unset)$/i.test(value)) value = value.toLowerCase();
    current.props[key] = value;
  }
  return result;
}

/**
 * Converts an EditorConfig glob to a RegExp tested against a path relative to
 * the .editorconfig's folder (no leading slash).
 * @returns {{re:RegExp, ranges:[number,number][]}}
 */
export function globToRegExp(glob) {
  let g = glob;
  // A glob without "/" matches the file name in any subfolder.
  if (!g.includes('/')) g = '**/' + g;
  else if (g.startsWith('/')) g = g.slice(1);

  const ranges = [];
  let re = '';
  let braceDepth = 0;
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '\\' && i + 1 < g.length) {
      re += escapeRe(g[++i]);
    } else if (c === '*') {
      if (g[i + 1] === '*') {
        i++;
        if (g[i + 1] === '/') {
          i++;
          re += '(?:.*/)?'; // "**/" also matches zero folders
        } else {
          re += '.*';
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if (c === '[') {
      const close = g.indexOf(']', i + 1);
      if (close < 0) { re += '\\['; continue; }
      let body = g.slice(i + 1, close);
      if (body.includes('/')) { re += '\\['; continue; }
      const negate = body.startsWith('!');
      if (negate) body = body.slice(1);
      re += '[' + (negate ? '^' : '') + body.replace(/\\/g, '\\\\').replace(/\^/g, '\\^') + ']';
      i = close;
    } else if (c === '{') {
      const close = findBraceClose(g, i);
      if (close < 0) { re += '\\{'; continue; }
      const body = g.slice(i + 1, close);
      const range = body.match(/^([+-]?\d+)\.\.([+-]?\d+)$/);
      if (range) {
        ranges.push([Number(range[1]), Number(range[2])]);
        re += '([+-]?\\d+)';
        i = close;
      } else if (!body.includes(',')) {
        re += '\\{' ; // "{single}" is literal per spec
      } else {
        re += '(?:';
        braceDepth++;
      }
    } else if (c === ',' && braceDepth > 0) {
      re += '|';
    } else if (c === '}' && braceDepth > 0) {
      re += ')';
      braceDepth--;
    } else {
      re += escapeRe(c);
    }
  }
  return { re: new RegExp('^' + re + '$'), ranges };
}

function findBraceClose(s, open) {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '\\') { i++; continue; }
    if (s[i] === '{') depth++;
    else if (s[i] === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

function escapeRe(c) {
  return c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

export function globMatches(glob, relPath) {
  const { re, ranges } = globToRegExp(glob);
  const m = relPath.match(re);
  if (!m) return false;
  // Numeric `{a..b}` captures are the only capturing groups we create.
  const nums = m.slice(1).filter((v) => v !== undefined);
  return ranges.every(([lo, hi], idx) => {
    const n = Number(nums[idx]);
    return n >= Math.min(lo, hi) && n <= Math.max(lo, hi);
  });
}

/**
 * @param {string} filePath  project-relative path, e.g. "src/app.js"
 * @param {{dir:string, text:string}[]} configs  every .editorconfig found from the
 *        project root down to the file's folder (any order; sorted here).
 * @returns {{indentStyle?:'tab'|'space', indentSize?:number, tabWidth?:number,
 *            endOfLine?:'lf'|'crlf'|'cr', charset?:string,
 *            trimTrailingWhitespace?:boolean, insertFinalNewline?:boolean}}
 */
export function resolveEditorConfig(filePath, configs) {
  const parsed = configs
    .map((c) => ({ dir: c.dir.replace(/^\/+|\/+$/g, ''), cfg: parseEditorConfig(c.text) }))
    .filter(({ dir }) => dir === '' || filePath === dir || filePath.startsWith(dir + '/'))
    .sort((a, b) => depth(a.dir) - depth(b.dir));

  // Only configs below the deepest `root = true` count.
  let startIdx = 0;
  parsed.forEach((p, i) => { if (p.cfg.root) startIdx = i; });

  const props = {};
  for (const { dir, cfg } of parsed.slice(startIdx)) {
    const rel = dir ? filePath.slice(dir.length + 1) : filePath;
    for (const section of cfg.sections) {
      if (globMatches(section.glob, rel)) Object.assign(props, section.props);
    }
  }
  return normalizeProps(props);
}

function depth(dir) {
  return dir === '' ? 0 : dir.split('/').length;
}

function normalizeProps(p) {
  const out = {};
  const unset = (v) => v === undefined || v === 'unset';
  if (!unset(p.indent_style) && (p.indent_style === 'tab' || p.indent_style === 'space')) out.indentStyle = p.indent_style;
  const tabWidth = parseInt(p.tab_width, 10);
  if (tabWidth > 0) out.tabWidth = tabWidth;
  if (p.indent_size === 'tab') {
    if (out.tabWidth) out.indentSize = out.tabWidth;
  } else {
    const size = parseInt(p.indent_size, 10);
    if (size > 0) out.indentSize = size;
  }
  if (out.indentSize && !out.tabWidth) out.tabWidth = out.indentSize;
  if (out.indentStyle === 'tab' && !out.indentSize && out.tabWidth) out.indentSize = out.tabWidth;
  if (['lf', 'crlf', 'cr'].includes(p.end_of_line)) out.endOfLine = p.end_of_line;
  if (!unset(p.charset)) out.charset = String(p.charset).toLowerCase();
  if (p.trim_trailing_whitespace === 'true') out.trimTrailingWhitespace = true;
  if (p.trim_trailing_whitespace === 'false') out.trimTrailingWhitespace = false;
  if (p.insert_final_newline === 'true') out.insertFinalNewline = true;
  if (p.insert_final_newline === 'false') out.insertFinalNewline = false;
  return out;
}
