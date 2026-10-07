// core/semicolons.js — when does a statement need a `;`? Pure text analysis,
// used by editor/semicolons.js (the pending-semicolon feature and "Complete
// statement") and unit-tested in Node with a table of cases per language.
//
// THE MODEL. Instead of a full parser, a small scanner walks the code before
// the cursor and keeps what matters:
//   • comments, strings, template literals and preprocessor lines (never code),
//   • a stack of open brackets: ( [ , and { split into kinds —
//       'body'  a block of statements (function, if, loop, lambda body…)
//       'class' a class/struct/enum/interface body (declarations, not statements)
//       'ns'    a namespace / extern "C" body (like the top level)
//       'expr'  an object literal, array/brace initializer, import { … }
//   • the text of the current statement: since the last `;`, `{` or `}` at
//     the current level. `;` inside ( ) — a for header — doesn't end it, and
//     a function body inside a statement (`const f = () => { … }`) is skipped
//     over so the statement continues after its `}`.
// Then the statement's text is classified: control headers, function/class
// headers, labels, preprocessor lines never get a `;`; declarations,
// assignments, calls, return/break/continue/throw, `std::cout << …` do.

export const SEMICOLON_LANGS = new Set(['c', 'cpp', 'java', 'csharp', 'javascript', 'jsx', 'typescript', 'tsx']);
const JS_LANGS = new Set(['javascript', 'jsx', 'typescript', 'tsx']);
const TS_LANGS = new Set(['typescript', 'tsx']);
const PREPROCESSOR_LANGS = new Set(['c', 'cpp', 'csharp']);
const BLOCK_KINDS = new Set(['body', 'class', 'ns']);

export const isJsLike = (lang) => JS_LANGS.has(lang);

/** Is the innermost open bracket an expression bracket (not a statement block)? */
const inGroup = (stack) => stack.length > 0 && !BLOCK_KINDS.has(stack[stack.length - 1].kind);

const norm = (s) => s.replace(/\s+/g, ' ').trim();

/** Index of the `)` matching the `(` at `open`, or -1. */
function matchParen(s, open) {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      for (i++; i < s.length && s[i] !== q; i++) if (s[i] === '\\') i++;
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return i;
  }
  return -1;
}

/** Index of the first `ch` outside brackets and strings, or -1. */
function topLevelIndex(s, test) {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      for (i++; i < s.length && s[i] !== q; i++) if (s[i] === '\\') i++;
      continue;
    }
    if (depth === 0 && test(s, i)) return i;
    if (c === '(' || c === '[' || c === '{') depth++;
    else if ((c === ')' || c === ']' || c === '}') && depth > 0) depth--;
  }
  return -1;
}

/** `=` that assigns (not == != <= >= => and not `operator=`). Also += -= … */
const isAssignAt = (s, i) => {
  if (s[i] !== '=') return false;
  const prev = s[i - 1], next = s[i + 1];
  if (next === '=' || next === '>') return false;
  if (prev === '=' || prev === '!') return false;
  if ((prev === '<' || prev === '>') && s[i - 2] !== prev) return false; // <= >= but not <<= >>=
  if (/operator\s*[-+*/%^&|<>]*$/.test(s.slice(0, i))) return false;
  return true;
};
const topLevelAssign = (s) => topLevelIndex(s, isAssignAt);
const topLevelParen = (s) => topLevelIndex(s, (str, i) => str[i] === '(');

// ---- scanner -------------------------------------------------------------------

/** Kind of a `{` given the statement text before it. */
function braceKind(buf, stack, lang) {
  const top = stack[stack.length - 1];
  if (inGroup(stack)) {
    // Inside ( [ or an expression: a function/lambda body, an anonymous
    // class, or an object literal.
    const inner = norm(buf.slice(top.at + 1));
    if (/\bnew\s+[\w.$<>[\], ]+\([^()]*\)$/.test(inner) && lang === 'java') return 'class';
    if (/(?:\)|=>|->)\s*(?:(?:const|mutable|noexcept|override)\s*)*(?:->\s*[\w:<>*&\s]+)?$/.test(inner)) return 'body';
    return 'expr';
  }
  const t = norm(buf);
  if (!t) return 'body';
  if (JS_LANGS.has(lang) && /^(?:import|export)\b/.test(t) && !/\b(?:function|class)\b/.test(t)) return 'expr';
  if (/(?:=>|->)$/.test(t)) return 'body';
  if (/\bnew\s+[\w.$<>[\], ]+(?:\([^()]*\))?$/.test(t)) return lang === 'java' && /\)$/.test(t) ? 'class' : 'expr';
  if (/(?:^|[^\w$])(?:const|let|var|return|case|typeof|in|of|yield|await|throw|new|import|export)$/.test(t)) return 'expr';
  if (/(?:[=([,:?+\-*/%!~^]|&&|\|\||\?\?|<<|>>)$/.test(t)) return 'expr';
  if (/^(?:[\w$]+\s+)*(?:class|struct|union|interface|enum|record)\b/.test(t) || /^template\s*<.*>\s*(?:class|struct)\b/.test(t)) return 'class';
  if (/^(?:inline\s+)?namespace\b/.test(t) || /^extern\s*"C(?:\+\+)?"$/.test(t)) return 'ns';
  if (/\)(?:\s*(?:const|override|final|noexcept(?:\([^)]*\))?|mutable|volatile|&&?|throws\s+[\w.$, ]+|->\s*[\w:<>*&\s]+|:\s*.*))*$/.test(t)) return 'body';
  if (/(?:^|[^\w$])(?:else|do|try|finally|static|get|set|init|unsafe|checked|unchecked)$/.test(t)) return 'body';
  // `Foo f{1, 2}` / `std::vector<int>{…}` — C++ brace initialization
  if ((lang === 'cpp' || lang === 'c') && /[\w$>]$/.test(t)) return 'expr';
  return 'body';
}

/** Does a `{ body }` opened after this statement text belong to an expression? */
const embedsBody = (buf) => {
  const t = norm(buf);
  return topLevelAssign(t) >= 0 || /^(?:return|yield|await|throw|export\s+default)\b/.test(t);
};

/**
 * Scans code (everything before the cursor) and returns the context at its
 * end: {mode, quote, stack, stmt, scope}.
 * mode: 'code' | 'line' (// comment) | 'block' (/* comment) | 'pre' (#directive)
 *       | 'string' | 'template'
 */
export function scan(text, lang) {
  const js = JS_LANGS.has(lang);
  const pre = PREPROCESSOR_LANGS.has(lang);
  let mode = 'code', quote = '', buf = '', lineStart = true, saved = '';
  const stack = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i + 1];
    if (mode === 'line') {
      if (ch === '\n') { mode = 'code'; lineStart = true; buf += '\n'; }
      continue;
    }
    if (mode === 'block') {
      if (ch === '*' && next === '/') { mode = 'code'; i++; buf += ' '; }
      continue;
    }
    if (mode === 'pre') {
      if (ch === '\n' && text[i - 1] !== '\\') { mode = 'code'; lineStart = true; buf = saved; }
      continue;
    }
    if (mode === 'string') {
      buf += ch;
      if (ch === '\\') { if (next !== undefined) buf += next; i++; } else if (ch === quote || ch === '\n') mode = 'code';
      continue;
    }
    if (mode === 'template') {
      buf += ch;
      if (ch === '\\') { if (next !== undefined) buf += next; i++; } else if (ch === '`') mode = 'code';
      else if (ch === '$' && next === '{') { buf += '{'; i++; stack.push({ ch: '${', kind: 'texpr', at: buf.length - 1 }); mode = 'code'; }
      continue;
    }
    // ---- code
    if (ch === '\n') { lineStart = true; buf += ch; continue; }
    if (ch === ' ' || ch === '\t' || ch === '\r') { buf += ch; continue; }
    const atLineStart = lineStart;
    lineStart = false;
    if (ch === '/' && next === '/') { mode = 'line'; i++; continue; }
    if (ch === '/' && next === '*') { mode = 'block'; i++; continue; }
    if (ch === '#' && atLineStart && pre) { mode = 'pre'; saved = buf.trim() ? buf : ''; continue; }
    if (ch === '"' || ch === "'") { mode = 'string'; quote = ch; buf += ch; continue; }
    if (ch === '`' && js) { mode = 'template'; buf += ch; continue; }
    if (ch === '(' || ch === '[') { stack.push({ ch, kind: 'group', at: buf.length }); buf += ch; continue; }
    if (ch === ')' || ch === ']') {
      const top = stack[stack.length - 1];
      if (top && top.kind === 'group' && top.ch === (ch === ')' ? '(' : '[')) stack.pop();
      buf += ch;
      continue;
    }
    if (ch === '{') {
      const kind = braceKind(buf, stack, lang);
      if (kind === 'expr') {
        stack.push({ ch, kind, at: buf.length });
        buf += ch;
      } else {
        stack.push({ ch, kind, outer: buf, embedded: inGroup(stack) || (kind !== 'ns' && embedsBody(buf)) });
        buf = '';
      }
      continue;
    }
    if (ch === '}') {
      const top = stack[stack.length - 1];
      if (top && top.kind === 'texpr') { stack.pop(); mode = 'template'; buf += ch; continue; }
      if (top && top.ch === '{') {
        stack.pop();
        if (top.kind === 'expr') buf += ch;
        else buf = top.embedded ? top.outer + '{}' : '';
      }
      continue;
    }
    if (ch === ';') {
      if (inGroup(stack)) buf += ch; else buf = '';
      continue;
    }
    buf += ch;
  }
  let scope = js ? 'body' : 'top';
  for (let i = stack.length - 1; i >= 0; i--) {
    const k = stack[i].kind;
    if (BLOCK_KINDS.has(k)) { scope = k === 'ns' ? 'top' : k; break; }
  }
  return { mode, quote, stack, stmt: buf, scope };
}

/**
 * Applies auto-inserted closing characters (`)`, `]`, `}` of an expression,
 * a closing quote) that sit after the cursor. Returns the context after them,
 * or null if they don't simply close what is open.
 */
function applyClosers(ctx, closers) {
  const stack = ctx.stack.slice();
  let { mode } = ctx;
  let buf = ctx.stmt;
  for (const ch of closers) {
    const top = stack[stack.length - 1];
    if (mode === 'string') {
      if (ch !== ctx.quote) return null;
      mode = 'code';
    } else if (mode === 'template') {
      if (ch !== '`') return null;
      mode = 'code';
    } else if (ch === ')' || ch === ']') {
      if (!top || top.kind !== 'group' || top.ch !== (ch === ')' ? '(' : '[')) return null;
      stack.pop();
    } else if (ch === '}') {
      if (!top || top.kind !== 'expr') return null; // closing a code block: not one statement
      stack.pop();
    } else if (ch === '"' || ch === "'" || ch === '`') {
      return null;
    }
    buf += ch;
  }
  return { mode, stack, stmt: buf };
}

// ---- classification -------------------------------------------------------------

const MODIFIERS = '(?:(?:export|default|declare|public|private|protected|internal|static|abstract|final|sealed|partial|async|virtual|override|inline|extern|constexpr|consteval|explicit|friend|unsafe|new)\\s+)*';
const HEADER = new RegExp(`^${MODIFIERS}(?:function\\b|class\\b|interface\\b|namespace\\b|module\\b|enum\\b|union\\b|record\\b|template\\s*<|extern\\s*"C|struct(?:\\s+[\\w:]+)?\\s*(?:final\\s*)?(?::.*)?$)`);
const DECL_MODS = '(?:(?:export|public|private|protected|internal|static|final|virtual|explicit|friend|const|constexpr|constinit|inline|extern|volatile|unsigned|signed|long|short|mutable|register|thread_local|readonly|transient|volatile|unsafe|struct|enum|class|typename)\\s+)*';
const TYPE = '[A-Za-z_$][\\w$]*(?:\\s*::\\s*[A-Za-z_$][\\w$]*)*(?:\\s*<[^;{}()]*>)?(?:\\s*\\[\\s*\\])*\\??';
const DECL = new RegExp(`^${DECL_MODS}${TYPE}(?:\\s*[*&]+\\s*|\\s+)(?:[*&]\\s*)*[A-Za-z_$][\\w$]*(?:\\s*\\[[^\\]]*\\])*(?:\\s*$|\\s*[=({,\\[;:]|\\s*$)`);
const CONTINUES = /(?:[-+*/%=&|^<>!?:,.~(\[{]|->|::)$/;

/**
 * Removes a leading control header whose body is a single statement on the
 * same line (`if (x) return y` → `return y`). Returns null if what remains
 * is only a header (`if (x)`, `else`, `for (…)`).
 */
function stripControl(s) {
  for (let guard = 0; guard < 8; guard++) {
    const m = /^(?:if|while|for|foreach|for\s+each)\s*\(/.exec(s);
    if (m) {
      const end = matchParen(s, m[0].length - 1);
      if (end < 0) return null;
      s = s.slice(end + 1).trim();
      if (!s) return null;
      continue;
    }
    const e = /^(?:else|do)\b\s*/.exec(s);
    if (e) {
      s = s.slice(e[0].length);
      if (!s) return null;
      continue;
    }
    return s;
  }
  return s;
}

/** Does this statement text (from its start up to the cursor/closers) want a `;`? */
export function statementWantsSemicolon(stmt, scope, lang) {
  const js = JS_LANGS.has(lang);
  let s = norm(stmt).replace(/^(?:@[\w.$]+(?:\([^()]*\))?\s+)+/, ''); // Java/TS annotations, decorators
  if (!s || /^@/.test(s)) return false;
  s = stripControl(s);
  if (!s) return false;
  if (/[,;]$/.test(s)) return false;
  if (/^(?:switch|try|catch|finally|case|default|lock|synchronized|fixed|checked|unchecked)\b/.test(s) || /^using\s*\(/.test(s)) return false;
  if (/^[A-Za-z_$][\w$]*\s*:$/.test(s)) return false; // label, `public:`
  if (HEADER.test(s)) return false;

  if (/^(?:break|continue)(?:\s+[A-Za-z_$][\w$]*)?$/.test(s)) return true;
  if (/^(?:using|typedef|import|package)\b/.test(s)) return true;
  if (js && /^export\s+(?:\*|\{|default\b)/.test(s)) return !/^export\s+default\s+(?:async\s+)?(?:function|class)\b/.test(s);
  if (js && /^(?:export\s+)?(?:declare\s+)?(?:const|let|var)\s+\S/.test(s)) return scope !== 'class';
  if (TS_LANGS.has(lang) && /^(?:export\s+)?(?:declare\s+)?type\s+[\w$]+/.test(s)) return true;
  if (scope === 'body' && /^(?:return|throw|goto|yield|await|delete|new|super|this|typeof|void|assert)\b/.test(s)) return true;

  if (!js) {
    if (DECL.test(s) && !/^(?:return|throw|goto|delete|new|else|case|using)\b/.test(s)) {
      if (scope === 'body') return true;
      // At the top level or in a class body, a parameter list before any
      // `=` makes it a function header: `int main()`, `void run() const`.
      const p = topLevelParen(s), e = topLevelAssign(s);
      if (p >= 0 && (e < 0 || p < e)) {
        // …except `virtual void f() = 0`, `Foo() = default`
        const close = matchParen(s, p);
        return close > 0 && /^\s*(?:const\s*)?(?:noexcept\s*)?(?:override\s*)?=\s*(?:0|default|delete)$/.test(s.slice(close + 1));
      }
      // A global without an initializer (`int count`) is left alone; a
      // field in a class/struct gets one.
      return scope === 'class' || e >= 0;
    }
  }
  if (scope === 'class') {
    if (js && topLevelAssign(s) >= 0 && topLevelParen(s) < 0) return true;   // class field `x = 1`
    if (TS_LANGS.has(lang) && /^(?:(?:public|private|protected|readonly|static|declare|override|abstract)\s+)*[\w$]+[?!]?\s*:\s*[^(]+$/.test(s)) return true;
    return false;
  }
  if (scope !== 'body') return false;
  // statements in a function body (or a JS script)
  if (topLevelAssign(s) >= 0) return true;
  if (/^(?:\+\+|--)\s*[\w$(]/.test(s) || /[\w$)\]](?:\+\+|--)$/.test(s)) return true;
  if (/^(?:std\s*::\s*)?(?:cout|cerr|clog|cin|wcout|wcin)\b/.test(s)) return true;
  if (/^[A-Za-z_$*(\[]/.test(s) && topLevelParen(s) >= 0) return true; // a call
  return false;
}

/**
 * Should a pending `;` follow the cursor?
 * @param {string} before  code before the cursor (the last ~20 000 chars are plenty)
 * @param {string} after   the rest of the cursor's line
 */
export function wantsSemicolon(before, after, lang) {
  if (!SEMICOLON_LANGS.has(lang)) return false;
  if (!/^[)\]}"'`]*\s*$/.test(after)) return false;
  const ctx = scan(before, lang);
  if (ctx.mode === 'line' || ctx.mode === 'block' || ctx.mode === 'pre') return false;
  const closed = applyClosers(ctx, after.trim());
  if (!closed || closed.mode !== 'code' || inGroup(closed.stack)) return false;
  return statementWantsSemicolon(closed.stmt, ctx.scope, lang);
}

/**
 * Enter right before a pending `;`: may it step over the `;` and open a new
 * line? Only if the statement is complete — nothing left open once the
 * auto-inserted closers between cursor and `;` are counted, and the line
 * doesn't end with something that continues (`=`, `,`, `<<`, `.`, `->`, …).
 */
export function canStepOver(before, between, lang) {
  if (!/^[)\]}"'`\s]*$/.test(between)) return false;
  const ctx = scan(before, lang);
  if (ctx.mode !== 'code' && ctx.mode !== 'string' && ctx.mode !== 'template') return false;
  const closed = applyClosers(ctx, between.replace(/\s+/g, ''));
  if (!closed || closed.mode !== 'code' || inGroup(closed.stack)) return false;
  if (ctx.mode === 'code') {
    const code = ctx.stmt.trimEnd();
    if (!code) return false;
    if (CONTINUES.test(code) && !/(?:\+\+|--)$/.test(code)) return false;
  }
  return true;
}

/** `break` / `continue` / `return` alone on the line: Enter adds the `;`. */
export function isBareJump(before, lang) {
  if (!SEMICOLON_LANGS.has(lang)) return false;
  const ctx = scan(before, lang);
  if (ctx.mode !== 'code' || inGroup(ctx.stack) || ctx.scope !== 'body') return false;
  const s = stripControl(norm(ctx.stmt));
  return !!s && /^(?:break|continue|return)$/.test(s);
}

/**
 * Plan for "Complete statement" (⏎; key, Ctrl+Shift+Enter): what to append at
 * the end of the line before opening a new one.
 * @returns {{append:string, block:boolean}}
 */
export function completionPlan(before, lang) {
  if (lang === 'python') {
    const line = before.slice(before.lastIndexOf('\n') + 1).trim();
    const header = /^(?:if|elif|else|for|while|def|class|try|except|finally|with|async\s+(?:def|for|with)|match|case)\b/.test(line);
    return { append: header && !/:\s*(?:#.*)?$/.test(line) ? ':' : '', block: false };
  }
  if (!SEMICOLON_LANGS.has(lang)) return { append: '', block: false };
  const ctx = scan(before, lang);
  if (ctx.mode !== 'code') return { append: '', block: false };
  // close what this statement left open: `foo(a` → `foo(a)`
  let append = '';
  let k = ctx.stack.length;
  while (k > 0 && ctx.stack[k - 1].kind === 'group') append += ctx.stack[--k].ch === '(' ? ')' : ']';
  if (inGroup(ctx.stack.slice(0, k))) return { append, block: false }; // inside an object literal etc.
  const s = norm(ctx.stmt + append);
  if (!s || /[;,{}]$/.test(s)) return { append, block: false };
  const cppType = (lang === 'cpp' || lang === 'c') && /^(?:[\w$]+\s+)*(?:class|struct|union|enum)\b/.test(s);
  if (HEADER.test(s)) return { append: append + (cppType ? ' {};' : ' {}'), block: true };
  if (/^(?:if|while|for|foreach|switch|catch|using|lock|synchronized|fixed)\s*\(.*\)$/.test(s) && (stripControl(s) === null || /^(?:switch|catch|using|lock|synchronized|fixed)\b/.test(s))) {
    return { append: append + ' {}', block: true };
  }
  if (/^(?:else(?:\s+if\s*\(.*\))?|do|try|finally)$/.test(s)) return { append: append + ' {}', block: true };
  if (/(?:=>|->)$/.test(s)) return { append: append + (topLevelAssign(s) >= 0 ? ' {};' : ' {}'), block: true };
  // a function / method header: `int main()`, `void run() const`, `render()` in a JS class
  const p = topLevelParen(s), e = topLevelAssign(s);
  if (ctx.scope !== 'body' && p >= 0 && (e < 0 || p < e) && /\)(?:\s*(?:const|override|final|noexcept|throws\s+[\w.$, ]+|:\s*[\w$<>[\]|& ]+))*$/.test(s)) {
    return { append: append + ' {}', block: true };
  }
  return { append: append + ';', block: false };
}

/**
 * JS/TS files written without semicolons (standard style): don't add them.
 * True when, of the lines that end a statement, fewer than 30 % use `;`.
 */
export function prefersNoSemicolons(text) {
  let semi = 0, bare = 0;
  const lines = text.split('\n', 3000);
  for (const raw of lines) {
    const l = raw.trim();
    if (!l || /^(?:\/\/|\/\*|\*)/.test(l)) continue;
    if (/;$/.test(l)) { semi++; continue; }
    if (/^(?:const|let|var|return|import|export|throw)\b/.test(l) && /[\w$)\]'"`]$/.test(l)) bare++;
    else if (/^[\w$.]+\(.*\)$/.test(l)) bare++;
  }
  return semi + bare >= 4 && semi / (semi + bare) < 0.3;
}
