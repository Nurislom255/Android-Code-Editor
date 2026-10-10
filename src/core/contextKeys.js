// core/contextKeys.js — the keys bar's context row: keys predicted from where
// the cursor is (ROADMAP 2.5). Pure rules over a "situation" that
// editor/keysContext.js reads from the syntax tree.
//
// A key is a string:
//   "@name"     an action (a command, see ACTION_KEYS in keysLayout.js)
//   "class=\"|\"" text to type; "|" marks where the cursor ends up ("\|" is a
//               literal bar). Without "|", the cursor goes after the text.

/**
 * @typedef {object} Situation
 * @property {string} group      'js' | 'clike' | 'python' | 'html' | 'css' | 'markdown' | 'json' | 'plain'
 * @property {string} lang       language id (cpp, c, java, javascript, …)
 * @property {string} before     the line's text before the cursor
 * @property {string|null} inString  the open quote when inside a string
 * @property {boolean} inComment
 * @property {boolean} inTag      HTML: inside a start tag (not an attribute value)
 * @property {boolean} inCssBlock CSS: inside { }
 * @property {boolean} selection  some text is selected
 * @property {boolean} template   JS: the string is a `template`
 */

const SELECTION = ['@cut', '@copy', '@paste', '@toggleComment', '@indent', '(', '[', '{', '"'];

/** @param {Situation} s  @returns {string[]} best first */
export function contextKeys(s) {
  if (s.selection) return SELECTION;
  if (s.inComment) return []; // (the row shows the language's symbols)
  if (s.inString) return stringKeys(s);
  const at = lineContext(s.before);
  switch (s.group) {
    case 'clike': return clikeKeys(s, at);
    case 'js': return jsKeys(at);
    case 'python': return pythonKeys(at);
    case 'html': return s.inTag ? ['="|"', '/>', 'class="|"', 'id="|"', 'href="|"', 'src="|"'] : ['</', '<br>', '&nbsp;', '"|"'];
    case 'css': return s.inCssBlock ? [':', ';', 'px', '%', '#', '!important'] : ['{|}', '.', '#', ':hover', '@media ', ','];
    case 'markdown': return ['# ', '**|**', '`|`', '[|]()', '- ', '> '];
    case 'json': return ['"|"', ': ', ',', '{|}', '[|]', 'true'];
    default: return [];
  }
}

/** What the text before the cursor on this line says about the next token. */
export function lineContext(before) {
  const t = before.replace(/\s+$/, '');
  return {
    statementStart: /(^|[;{}])\s*$/.test(before) && !/\belse\s*$/.test(t),
    afterEquals: /=$/.test(t) && !/[=!<>]=$/.test(t),
    afterName: /[\w$)\]]$/.test(before) && !/\b(return|else|new|case|typeof|in|of)$/.test(before),
    cout: /\bcout\b[^;]*$/.test(before),
    cin: /\bcin\b[^;]*$/.test(before),
  };
}

function clikeKeys(s, at) {
  const cpp = s.lang === 'cpp';
  const c = s.lang === 'c';
  if (cpp && at.cout) return ['<< ', 'endl', '"\\n"', '"|"'];
  if (cpp && at.cin) return ['>> '];
  if (at.statementStart) {
    if (cpp) return ['std::', 'cout << ', 'auto ', 'for (|)', 'if (|)', 'return '];
    if (c) return ['printf("|")', 'int ', 'for (|)', 'if (|)', 'return ', 'struct '];
    if (s.lang === 'java') return ['System.out.println(|);', 'int ', 'String ', 'for (|)', 'if (|)', 'return '];
    if (s.lang === 'csharp') return ['Console.WriteLine(|);', 'var ', 'for (|)', 'if (|)', 'return ', 'new '];
    return ['if (|)', 'for (|)', 'return ', '{|}'];
  }
  if (at.afterEquals) {
    // (no power operator in C / C++: pow(a, b) from <cmath> / <math.h>)
    if (cpp) return ['{|}', '"|"', 'pow(|)', 'nullptr', 'new ', 'std::', '[|]'];
    if (c) return ['{|}', '"|"', 'pow(|)', 'NULL', 'malloc(|)'];
    if (s.lang === 'java' || s.lang === 'csharp') return ['new ', 'null', '"|"', '{|}'];
    return ['{|}', '"|"', '[|]'];
  }
  if (at.afterName) {
    if (cpp) return ['.', '(|)', ' = ', ';', '->', '::'];
    if (c) return ['.', '(|)', ' = ', ';', '->', '[|]'];
    return ['.', '(|)', ' = ', ';', '[|]'];
  }
  return ['(|)', ';', '{|}', ' = ', '"|"'];
}

function jsKeys(at) {
  if (at.statementStart) return ['const ', 'let ', 'if (|)', 'for (|)', 'return ', 'function '];
  if (at.afterEquals) return ['{|}', '[|]', '"|"', '() => ', 'new ', 'null'];
  if (at.afterName) return ['.', '(|)', ' = ', ';', '?.', ' => '];
  return ['(|)', '{|}', ';', '"|"', '=> '];
}

function pythonKeys(at) {
  if (at.statementStart) return ['def ', 'if ', 'for ', 'print(|)', 'return ', 'self.'];
  if (at.afterEquals) return ['[|]', '{|}', '"|"', 'None', 'True', 'False'];
  if (at.afterName) return ['(|)', '.', ' = ', ':', '[|]'];
  return [':', 'self.', '(|)', '[|]', 'def ', 'print(|)'];
}

function stringKeys(s) {
  const q = s.inString;
  if (s.group === 'js') return s.template ? ['${|}', '\\', q] : ['\\', q, '\\n'];
  if (s.group === 'python') return ['\\n', '{|}', '\\', q];
  if (s.group === 'clike') return s.lang === 'c' ? ['\\n', '%d', '%s', '\\', q] : ['\\n', '\\', q];
  return ['\\', q];
}

/** Splits a text key at its cursor marker. → {text, cursor} (cursor: offset in text). */
export function parseTextKey(key) {
  let text = '', cursor = -1;
  for (let i = 0; i < key.length; i++) {
    const ch = key[i];
    if (ch === '\\' && key[i + 1] === '|') { text += '|'; i++; continue; }
    if (ch === '|' && cursor < 0) { cursor = text.length; continue; }
    text += ch;
  }
  return { text, cursor: cursor < 0 ? text.length : cursor };
}

/** What a text key shows: no cursor marker, no padding spaces ("() =>", "<<"). */
export function keyLabel(key) {
  const { text } = parseTextKey(key);
  return text.trim() || text;
}
