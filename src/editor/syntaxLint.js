// editor/syntaxLint.js — syntax error markers without a language server
// (spec §2 Phase 2). The incremental parser keeps going after a mistake by
// inserting error nodes into the tree ("⚠"); underlining those is real
// syntax-error detection, for free.

import { linter } from '@codemirror/lint';
import { ensureSyntaxTree } from '@codemirror/language';

const MAX_DIAGNOSTICS = 50;

export function syntaxDiagnostics(state, { timeout = 200 } = {}) {
  const tree = ensureSyntaxTree(state, state.doc.length, timeout);
  if (!tree) return [];
  const out = [];
  tree.iterate({
    enter(node) {
      if (out.length >= MAX_DIAGNOSTICS) return false;
      if (node.type.isError) {
        const line = state.doc.lineAt(node.from);
        let from = node.from;
        let to = node.to;
        if (to <= from) {
          // Zero-width error: something is missing. Mark one character (or the
          // previous one at end of line) so there's something to see.
          if (from < line.to) to = from + 1;
          else if (from > line.from) { from -= 1; to = node.from; }
        }
        const text = state.sliceDoc(node.from, Math.min(node.to, line.to)).trim();
        out.push({
          from, to,
          severity: 'error',
          source: 'syntax',
          message: node.to > node.from && text
            ? `Syntax error: unexpected "${text.length > 30 ? text.slice(0, 30) + '…' : text}"`
            : 'Syntax error: something is missing here',
        });
        return false;
      }
      // HTML's parser records mismatched tags as named nodes, not errors.
      if (node.name === 'MismatchedCloseTag') {
        out.push({ from: node.from, to: node.to, severity: 'warning', source: 'syntax', message: 'Closing tag does not match the open element' });
      }
      return undefined;
    },
  });
  return out;
}

export function syntaxLinter() {
  return linter((view) => syntaxDiagnostics(view.state), { delay: 600 });
}
