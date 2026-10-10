// editor/keysContext.js — reads where the cursor is from the syntax tree, for
// the keys bar's context row (rules in core/contextKeys.js).

import { syntaxTree } from '@codemirror/language';
import { groupForLanguage } from '../core/keysLayout.js';

const STRING = /^(String|TemplateString|FormatString|StringLiteral|RawString|CharLiteral|CharacterLiteral|TextBlock|AttributeValue)$/;
const QUOTES = '"\'`';

/**
 * @param {import('@codemirror/state').EditorState} state
 * @param {string} langId  the document's language id
 * @returns {import('../core/contextKeys.js').Situation}
 */
export function situationAt(state, langId) {
  const sel = state.selection;
  const head = sel.main.head;
  const line = state.doc.lineAt(head);
  const s = {
    group: groupForLanguage(langId), lang: langId,
    before: state.sliceDoc(line.from, head),
    inString: null, template: false, inComment: false, inTag: false, inCssBlock: false,
    selection: sel.ranges.some((r) => !r.empty),
  };
  if (s.selection) return s;
  let tree;
  try { tree = syntaxTree(state); } catch { return s; }
  let block = false, tag = false;
  for (let n = tree.resolveInner(head, -1); n; n = n.parent) {
    const name = n.name;
    if (/Comment/.test(name)) {
      const start = state.sliceDoc(n.from, n.from + 4);
      const lineComment = start.startsWith('//') || start[0] === '#';
      const closed = lineComment || /(\*\/|-->)$/.test(state.sliceDoc(Math.max(n.from, n.to - 3), n.to));
      // the end of a line comment, or of an unclosed block comment, is still inside it
      if (head < n.to || !closed || (lineComment && head === n.to)) { s.inComment = true; return s; }
    }
    if (STRING.test(name)) {
      const text = state.sliceDoc(n.from, Math.min(n.to, n.from + 4));
      const qi = [...text].findIndex((c) => QUOTES.includes(c));
      const q = qi >= 0 ? text[qi] : null;
      const closed = n.to - n.from > qi + 1 && state.sliceDoc(n.to - 1, n.to) === q;
      if (q && (head < n.to || !closed)) {
        s.inString = q;
        s.template = name === 'TemplateString';
        return s;
      }
    }
    if (name === 'Block') block = true;
    if ((name === 'OpenTag' || name === 'SelfClosingTag') && !(head >= n.to && state.sliceDoc(n.to - 1, n.to) === '>')) tag = true;
    // code embedded in another language: <script> / <style> in HTML
    if (name === 'Script' && s.group === 'html') s.group = 'js';
    if (name === 'StyleSheet' && s.group === 'html') s.group = 'css';
  }
  s.inCssBlock = s.group === 'css' && block;
  s.inTag = s.group === 'html' && tag;
  return s;
}
