// core/semicolons.js — automatic semicolons, kept deliberately small.
//
// THE RULE OF THUMB: only obvious statements, judged from the current line.
// The check runs only when one of a few trigger characters is typed
// (space, `=`, `(`, `<`, `>`, `+`, `-`) at the end of a line, so typing
// costs nothing the rest of the time. Only when a rule matches does
// `scopeAt` look at the code above: is this line a statement in a function
// body, a field in a class, or neither (inside a parameter list, an object
// literal, a string, a comment…)?
//
//   `return ` `throw `          → `return |;`      (in a function body)
//   `int x =`  `const a =`  `x +=`  `this.y =`  → `x =|;`
//   `foo(`  `obj.run(`  `std::sort(`  `.then(`   → `foo(|);`   (in a body)
//   `cout <<`  `cin >>`         → `cout <<|;`
//   `i++`  `n--`                → `i++|;`
//
// The `;` is added once and never re-checked; Tab / swipe right / Enter jump
// over it, Backspace right after it appears removes it. Anything less
// obvious (multi-line statements, headers, `for (;;)`, …) is left alone.

export const SEMICOLON_LANGS = new Set(['c', 'cpp', 'java', 'csharp', 'javascript', 'jsx', 'typescript', 'tsx']);
const JS_LANGS = new Set(['javascript', 'jsx', 'typescript', 'tsx']);

export const isJsLike = (lang) => JS_LANGS.has(lang);

/** Characters whose typing can start an obvious statement. */
export const TRIGGERS = new Set([' ', '=', '(', '<', '>', '+', '-']);

const CONTROL = /^(?:if|else|for|while|do|switch|case|default|catch|try|finally|return|throw|function|class|struct|enum|union|namespace|template|typedef|using|lock|foreach|synchronized|with|sizeof|typeof|new|delete|await|yield|import|export|package|goto)$/;

// `int x`, `std::vector<int> v`, `const char* p`, `let n: number`, `this.a`, `arr[i]`, `*p`
const TARGET = String.raw`(?:(?:export\s+)?(?:const|let|var)\s+(?:[\w$]+|\{[^{}]*\}|\[[^\[\]]*\])(?:\s*:\s*[^=;(){}]+?)?|[A-Za-z_$][\w$:<>,\s*&\[\]]*?\s+[*&]*[A-Za-z_$][\w$]*(?:\s*\[[^\]]*\])*|\*?[A-Za-z_$][\w$]*(?:(?:\.|->|::|\?\.)[A-Za-z_$][\w$]*|\[[^\]]*\])*)`;
const ASSIGN = new RegExp(String.raw`^${TARGET}\s*(?:[-+*/%&|^]|<<|>>|\?\?)?=$`);
// `foo(`, `obj.method(`, `a.b('x').c(`, `std::sort(`, `p->run(`, `.then(` (a chain line), `await load(`
const CALL = /^(?:await\s+|new\s+|delete\s+)?(?:\.|\?\.)?[A-Za-z_$][\w$]*(?:(?:\.|->|::|\?\.)[A-Za-z_$][\w$]*|\([^()]*\))*(?:<[^<>()]*>)?\($/;

/**
 * Should a `;` be added at the end of the line?
 * @param {string} lineBefore  the line up to the cursor (after the typing)
 * @param {string} lineAfter   the rest of the line
 * @param {string} typed       the character just typed (first of the inserted text)
 * @param {string} lang
 * @param {'body'|'class'|'top'|'none'} scope  where the line's statement sits (syntax tree)
 */
export function autoSemicolon(lineBefore, lineAfter, typed, lang, scope = 'body') {
  if (!SEMICOLON_LANGS.has(lang) || !TRIGGERS.has(typed) || scope === 'none') return false;
  if (!/^[)\]]*\s*$/.test(lineAfter)) return false; // only auto-closed brackets after the cursor
  const s = lineBefore.trimStart();
  if (!s || /^(?:\/\/|\/\*|\*(?:\s|$)|#|@)/.test(s)) return false; // comments, directives, annotations
  const first = /^[A-Za-z_$]+/.exec(s);
  const body = scope === 'body';
  switch (typed) {
    case ' ':
      return body && /^(?:return|throw)\s$/.test(s);
    case '=': {
      if (!ASSIGN.test(s) || /\boperator\s*[^\w\s]*=$/.test(s)) return false;
      if (first && CONTROL.test(first[0]) && !/^(?:const|let|var|export|using|typedef|struct|enum|union)\b/.test(s)) return false;
      return true; // a statement, a class field or a global with an initializer
    }
    case '(':
      if (!body || !CALL.test(s)) return false;
      return !(first && CONTROL.test(first[0]) && !/^(?:await|new|delete)\b/.test(s));
    case '<': case '>':
      return body && /^(?:std\s*::\s*)?(?:cout|cerr|clog|wcout|cin|wcin)\s*(?:<<|>>)$/.test(s);
    case '+': case '-':
      return body && /^[A-Za-z_$][\w$.]*(?:\[[^\]]*\])?(?:\+\+|--)$/.test(s);
    default:
      return false;
  }
}

// ---- where does a line's statement sit? ------------------------------------------
//
// Only asked after a line already matched one of the rules above, so it may
// read a few thousand characters: it walks the text before the line, keeps a
// stack of open ( [ { and classifies each { by the text in front of it.
// (The syntax tree can't be trusted here: a statement still being typed,
// like `foo` in `int main() { foo }`, parses as a brace initializer.)

const norm = (t) => t.replace(/\s+/g, ' ').trim();

function braceKind(header, inGroup, lang) {
  const t = norm(header);
  if (inGroup) { // `foo(function () {`, `sort(…, [](int a) {`, `run(new Runnable() {`, `f({`
    if (lang === 'java' && /\bnew\s+[\w.$<>[\], ]+\([^()]*\)$/.test(t)) return 'class';
    return /(?:\)|=>|->)\s*(?:(?:const|mutable|noexcept)\s*)*(?:->\s*[\w:<>*&\s]+)?$/.test(t) ? 'body' : 'none';
  }
  if (!t) return 'body';
  if (/(?:=>|->)$/.test(t)) return 'body';
  if (JS_LANGS.has(lang) && /^(?:import|export)\b/.test(t) && !/\b(?:function|class)\b/.test(t)) return 'none';
  if (/(?:^|[^\w$])(?:const|let|var|return|case|in|of|yield|await|throw)$/.test(t)) return 'none';
  if (/(?:[=([,:?+\-*/%!~^|&]|<<|>>)$/.test(t)) return 'none';
  if (/^(?:[\w$]+\s+)*enum\b/.test(t)) return 'none';
  if (/^(?:[\w$]+\s+)*(?:class|struct|union|interface|record)\b/.test(t) || /^template\s*<.*>\s*(?:class|struct)\b/.test(t)) return 'class';
  if (/^(?:inline\s+)?namespace\b/.test(t) || /^extern\s*"C(?:\+\+)?"$/.test(t)) return 'top';
  if (/\bnew\s+[\w.$<>[\], ]+(?:\([^()]*\))?$/.test(t)) return lang === 'java' && /\)$/.test(t) ? 'class' : 'none';
  if (/\)(?:\s*(?:const|override|final|noexcept(?:\([^)]*\))?|mutable|&&?|throws\s+[\w.$, ]+|->\s*[\w:<>*&\s]+|:\s*.*))*$/.test(t)) return 'body';
  if (/(?:^|[^\w$])(?:else|do|try|finally|static|get|set|unsafe)$/.test(t)) return 'body';
  if ((lang === 'cpp' || lang === 'c') && /[\w$>]$/.test(t)) return 'none'; // `Foo f{1, 2}`
  return 'body';
}

/**
 * Scope of a statement starting right after `text` (the code before the
 * line): 'body' (function body, or a JS script), 'class' (class/struct
 * body), 'top' (C-family top level / namespace) or 'none' (inside ( ), [ ],
 * an object literal, an initializer or enum).
 */
export function scopeAt(text, lang) {
  const js = JS_LANGS.has(lang);
  const stack = [];
  let header = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (c === '/' && n === '/') { const e = text.indexOf('\n', i); i = e < 0 ? text.length : e; header += ' '; continue; }
    if (c === '/' && n === '*') { const e = text.indexOf('*/', i + 2); i = e < 0 ? text.length : e + 1; header += ' '; continue; }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      for (; j < text.length && text[j] !== c; j++) {
        if (text[j] === '\\') j++;
        else if (text[j] === '\n' && c !== '`') break;
      }
      header += '""';
      i = j;
      continue;
    }
    if (c === '#' && !js && /(?:^|\n)[ \t]*$/.test(text.slice(Math.max(0, i - 40), i))) { const e = text.indexOf('\n', i); i = e < 0 ? text.length : e; continue; }
    if (c === '(' || c === '[') { stack.push({ ch: c }); header += c; continue; }
    if (c === ')' || c === ']') { if (stack.length && stack[stack.length - 1].ch !== '{') stack.pop(); header += c; continue; }
    if (c === '{') {
      const inGroup = stack.length > 0 && stack[stack.length - 1].ch !== '{';
      stack.push({ ch: '{', kind: braceKind(header, inGroup, lang), header });
      header = '';
      continue;
    }
    if (c === '}') {
      const top = stack.pop();
      header = top && top.kind === 'none' ? top.header + '{}' : '';
      continue;
    }
    if (c === ';') { if (!stack.length || stack[stack.length - 1].ch === '{') header = ''; else header += c; continue; }
    header += c;
  }
  const top = stack[stack.length - 1];
  if (!top) return js ? 'body' : 'top';
  return top.ch === '{' ? top.kind : 'none';
}

/** The line ends with something that continues on the next line. */
const CONTINUES = /(?:[-+*/%=&|^<>!?:,.~(\[{]|->|::)$/;

/**
 * Enter with the cursor before the pending `;` (only auto-closed brackets
 * or a closing quote in between): step over it, unless the line so far ends
 * with something that continues (`=`, `,`, `<<`, `.`, `->`, `(` …).
 */
export function enterStepsOver(lineBefore, between) {
  if (!/^[)\]"'`]*$/.test(between.replace(/\s+/g, ''))) return false;
  const code = lineBefore.trimEnd();
  if (!code.trim()) return false;
  return !CONTINUES.test(code) || /(?:\+\+|--)$/.test(code);
}

/** `break` / `continue` / `return` alone on a line: Enter adds the `;`. */
export function isBareJump(lineText) {
  return /^\s*(?:break|continue|return)\s*$/.test(lineText);
}

/** The code part of a line: without a trailing // comment, without trailing spaces. */
export function codePart(line) {
  let quote = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '/' && line[i + 1] === '/') return line.slice(0, i).trimEnd();
  }
  return line.trimEnd();
}

/** Closing brackets for what the line left open: `foo(a, [b` → `])`. */
function unclosed(code) {
  const stack = [];
  let quote = '';
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '(' || c === '[') stack.push(c === '(' ? ')' : ']');
    else if ((c === ')' || c === ']') && stack[stack.length - 1] === c) stack.pop();
  }
  return stack.reverse().join('');
}

const HEADER = /^(?:(?:export|default|declare|public|private|protected|internal|static|abstract|final|sealed|partial|async|virtual|inline)\s+)*(?:function\b|class\b|interface\b|namespace\b|enum\b|union\b|record\b|template\s*<|struct(?:\s+[\w:]+)?\s*(?::.*)?$)/;

/**
 * Plan for "Complete statement" (⏎; key, Ctrl+Shift+Enter): what to append
 * after the code on the cursor's line before opening a new line.
 * @param {string} code   the line's code (see `codePart`)
 * @param {'body'|'class'|'top'|'none'} scope
 * @returns {{append:string, block:boolean}}
 */
export function completionPlan(code, lang, scope = 'body') {
  const line = code.trim();
  if (lang === 'python') {
    const header = /^(?:if|elif|else|for|while|def|class|try|except|finally|with|async\s+(?:def|for|with)|match|case)\b/.test(line);
    return { append: header && !line.endsWith(':') ? ':' : '', block: false };
  }
  if (!SEMICOLON_LANGS.has(lang) || !line || line.startsWith('#') || line.startsWith('//')) return { append: '', block: false };
  const close = unclosed(line);
  const s = (line + close).replace(/^\}\s*(?=\S)/, ''); // `} else if (x)` → judge `else if (x)`
  if (/[;,{}]$/.test(s) || scope === 'none') return { append: close, block: false };
  const cppType = (lang === 'cpp' || lang === 'c') && /^(?:[\w$]+\s+)*(?:class|struct|union|enum)\b/.test(s);
  if (HEADER.test(s)) return { append: close + (cppType ? ' {};' : ' {}'), block: true };
  if (/^(?:(?:else\s+)?if|while|for|foreach|switch|catch|using|lock|synchronized)\s*\(.*\)$/.test(s) || /^(?:else|do|try|finally)$/.test(s)) {
    return { append: close + ' {}', block: true };
  }
  if (/(?:=>|->)$/.test(s)) return { append: close + (/^(?:const|let|var|auto)\b|\s=\s/.test(s) ? ' {};' : ' {}'), block: true };
  // `int main()`, `void run() const`, `render()` in a JS class: a function header
  if (scope !== 'body' && /\)(?:\s*(?:const|override|final|noexcept|throws\s+[\w.$, ]+|:\s*[\w$<>[\]|& ]+))*$/.test(s) && !/^[^(]*\s=\s/.test(s)) {
    return { append: close + ' {}', block: true };
  }
  return { append: close + ';', block: false };
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
