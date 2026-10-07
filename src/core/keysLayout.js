// core/keysLayout.js — the symbol toolbar's per-language layouts (spec §2, §3.1).
//
// A layout is a plain string so users can edit it in Settings (spec: toolbar
// customization is *data*, not a plugin). Tokens are separated by spaces.
// A token may carry a swipe-up alternate after "^":  "(^)" means
// tap → "(", swipe up → ")".  A lone "^" is just the caret character.

export const DEFAULT_LAYOUTS = Object.freeze({
  js: '{^} (^) [^] ;^: =^=> "^\' `^$ .^, <^> !^? &^| +^- *^/ _^# \\^% @^~',
  html: '<^> /^\\ =^" "^\' {^} (^) !^- #^. :^; &^@ [^] _^* +^%',
  css: '{^} :^; .^# (^) -^_ %^! "^\' ,^> *^+ [^] @^& /^= ~^$',
  python: ':^= (^) [^] {^} "^\' _^# .^, =^== *^/ +^- <^> !^? @^% \\^|',
  clike: '{^} (^) ;^: [^] =^== "^\' <^> &^* .^, ->^:: !^? +^- /^% |^^ #^_',
  markdown: '#^* -^+ `^~ [^] (^) *^_ >^| !^? :^; "^\' \\^/ <^> =^&',
  json: '{^} [^] "^: ,^. -^+ true^false null^0 \\^/',
  plain: '(^) [^] {^} "^\' ;^: .^, -^_ =^+ /^\\ !^? @^# &^| *^%',
});

export const LANGUAGE_GROUPS = Object.freeze({
  javascript: 'js', typescript: 'js', jsx: 'js', tsx: 'js',
  html: 'html', xml: 'html', svg: 'html', vue: 'html',
  css: 'css', scss: 'css', less: 'css',
  python: 'python',
  c: 'clike', cpp: 'clike', java: 'clike', kotlin: 'clike', csharp: 'clike', go: 'clike', rust: 'clike', swift: 'clike', dart: 'clike', php: 'clike',
  markdown: 'markdown',
  json: 'json',
});

export function groupForLanguage(langId) {
  return LANGUAGE_GROUPS[langId] || 'plain';
}

/** @returns {{label:string, insert:string, alt:string|null}[]} */
export function parseLayout(layout) {
  return layout.trim().split(/\s+/).filter(Boolean).map(parseToken);
}

export function parseToken(token) {
  // Split at the first "^" that has text on both sides.
  for (let i = 1; i < token.length - 1; i++) {
    if (token[i] === '^') {
      const primary = token.slice(0, i);
      const alt = token.slice(i + 1);
      return { label: primary, insert: primary, alt };
    }
  }
  return { label: token, insert: token, alt: null };
}

export function formatLayout(keys) {
  return keys.map((k) => (k.alt ? `${k.insert}^${k.alt}` : k.insert)).join(' ');
}

/**
 * Pairs inserted as a unit with the cursor in between, when auto-close is on
 * (matches what typing "(" does with closeBrackets).
 */
export const AUTO_PAIRS = Object.freeze({ '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' });
