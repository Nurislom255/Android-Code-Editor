// editor/outline.js — symbols (functions, classes, headings…) from the syntax
// tree. Feeds three features (spec §2 Phase 2): the Outline panel, the
// breadcrumbs bar, and sticky scroll.
//
// Every language's parser names its nodes differently ("FunctionDeclaration"
// in JS, "FunctionDefinition" in Python and C++, "MethodDeclaration" in
// Java…), so RULES maps node names → kind + how to find the symbol's name.

import { syntaxTree, ensureSyntaxTree } from '@codemirror/language';

const child = (...names) => (node, state) => {
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (names.includes(c.name)) return state.sliceDoc(c.from, c.to);
  }
  return null;
};

/** A variable whose value is a function/class counts as a function/class. */
const jsVariable = (node, state) => {
  let name = null, isFn = false;
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (c.name === 'VariableDefinition' && !name) name = state.sliceDoc(c.from, c.to);
    if (['ArrowFunction', 'FunctionExpression', 'ClassExpression'].includes(c.name)) isFn = true;
  }
  return isFn ? name : null;
};

const cFunction = (node, state) => {
  const decl = node.getChild('FunctionDeclarator') || node.getChild('PointerDeclarator')?.getChild('FunctionDeclarator')
    || node.getChild('ReferenceDeclarator')?.getChild('FunctionDeclarator');
  if (!decl) return null;
  const id = decl.firstChild;
  return id ? state.sliceDoc(id.from, id.to) : null;
};

/** The rule's header: everything before its `{ … }` block, on one line. */
const firstLineText = (max) => (node, state) => {
  const block = node.getChild('Block');
  const end = Math.min(block ? block.from : node.to, state.doc.lineAt(node.from).to);
  const text = state.sliceDoc(node.from, end).replace(/\s+/g, ' ').replace(/\s*\{?\s*$/, '').trim();
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
};

const heading = (node, state) => state.sliceDoc(node.from, node.to).split('\n')[0].replace(/^#+\s*/, '').replace(/\s*#+\s*$/, '');

const RULES = {
  // JavaScript / TypeScript
  FunctionDeclaration: { kind: 'function', name: child('VariableDefinition') },
  ClassDeclaration: { kind: 'class', name: child('VariableDefinition', 'Definition') },
  MethodDeclaration: { kind: 'method', name: child('PropertyDefinition', 'Definition') },
  PropertyDeclaration: { kind: 'method', name: (n, s) => (n.getChild('ArrowFunction') || n.getChild('FunctionExpression') ? child('PropertyDefinition')(n, s) : null) },
  VariableDeclaration: { kind: 'function', name: jsVariable },
  InterfaceDeclaration: { kind: 'interface', name: child('TypeDefinition', 'Definition') },
  TypeAliasDeclaration: { kind: 'type', name: child('TypeDefinition') },
  EnumDeclaration: { kind: 'enum', name: child('TypeDefinition', 'Definition') },
  // Python
  FunctionDefinition: { kind: 'function', name: (n, s) => child('VariableName')(n, s) || cFunction(n, s) },
  ClassDefinition: { kind: 'class', name: child('VariableName') },
  // Java
  ConstructorDeclaration: { kind: 'method', name: child('Definition') },
  // C / C++
  ClassSpecifier: { kind: 'class', name: (n, s) => (n.getChild('FieldDeclarationList') ? child('TypeIdentifier')(n, s) : null) },
  StructSpecifier: { kind: 'class', name: (n, s) => (n.getChild('FieldDeclarationList') ? child('TypeIdentifier')(n, s) : null) },
  NamespaceDefinition: { kind: 'namespace', name: child('Identifier', 'NamespaceIdentifier') },
  // CSS
  RuleSet: { kind: 'rule', name: firstLineText(60) },
  MediaStatement: { kind: 'rule', name: firstLineText(60) },
  KeyframesStatement: { kind: 'rule', name: firstLineText(60) },
  // Markdown
  ATXHeading1: { kind: 'heading', level: 1, name: heading },
  ATXHeading2: { kind: 'heading', level: 2, name: heading },
  ATXHeading3: { kind: 'heading', level: 3, name: heading },
  ATXHeading4: { kind: 'heading', level: 4, name: heading },
  ATXHeading5: { kind: 'heading', level: 5, name: heading },
  ATXHeading6: { kind: 'heading', level: 6, name: heading },
  SetextHeading1: { kind: 'heading', level: 1, name: heading },
  SetextHeading2: { kind: 'heading', level: 2, name: heading },
};

const MAX_SYMBOLS = 2000;

/**
 * @returns {{name:string, kind:string, from:number, to:number, line:number, depth:number, children:any[]}[]}
 *          a forest of symbols (children nested by containment)
 */
export function getSymbols(state, { timeout = 50 } = {}) {
  const tree = ensureSyntaxTree(state, state.doc.length, timeout) || syntaxTree(state);
  const flat = [];
  tree.iterate({
    enter(ref) {
      if (flat.length >= MAX_SYMBOLS) return false;
      const rule = RULES[ref.name];
      if (!rule) return undefined;
      const node = ref.node;
      const name = rule.name(node, state);
      if (!name || !name.trim()) return undefined;
      // Markdown headings "contain" everything until the next heading of the
      // same or higher level, which the tree doesn't express; fixed below.
      flat.push({ name: name.trim(), kind: rule.kind, level: rule.level, from: ref.from, to: ref.to, line: state.doc.lineAt(ref.from).number });
      return undefined;
    },
  });
  if (flat.length && flat[0].kind === 'heading') extendHeadings(flat, state.doc.length);
  return nest(flat);
}

function extendHeadings(flat, docLength) {
  for (let i = 0; i < flat.length; i++) {
    let end = docLength;
    for (let j = i + 1; j < flat.length; j++) {
      if (flat[j].level <= flat[i].level) { end = flat[j].from - 1; break; }
    }
    flat[i].to = Math.max(flat[i].to, end);
  }
}

function nest(flat) {
  const roots = [];
  const stack = [];
  for (const sym of flat.sort((a, b) => a.from - b.from || b.to - a.to)) {
    while (stack.length && stack[stack.length - 1].to < sym.to) stack.pop();
    sym.children = [];
    sym.depth = stack.length;
    if (stack.length) stack[stack.length - 1].children.push(sym);
    else roots.push(sym);
    stack.push(sym);
  }
  return roots;
}

/** Flattens the forest in document order. */
export function flattenSymbols(forest, out = []) {
  for (const s of forest) { out.push(s); flattenSymbols(s.children, out); }
  return out;
}

/** Symbols containing `pos`, outermost first (for breadcrumbs). */
export function symbolPathAt(forest, pos) {
  const path = [];
  let level = forest;
  for (;;) {
    const hit = level.find((s) => s.from <= pos && pos <= s.to);
    if (!hit) return path;
    path.push(hit);
    level = hit.children;
  }
}

/** Symbols whose header line is above `line` but whose body continues past it. */
export function stickySymbolsAt(forest, line, doc) {
  const out = [];
  let level = forest;
  for (;;) {
    const hit = level.find((s) => s.line < line && doc.lineAt(s.to).number > line);
    if (!hit) return out;
    out.push(hit);
    level = hit.children;
  }
}

export const KIND_ICONS = {
  function: 'ƒ', method: 'm', class: 'C', interface: 'I', type: 'T', enum: 'E',
  namespace: 'N', rule: '#', heading: 'H',
};
