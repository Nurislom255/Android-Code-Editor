// editor/linkedTags.js — renaming <div> also renames its </div> (and the other
// way round), like VS Code's linked editing in HTML/XML.
//
// HOW: a transaction filter looks at each single typing/deleting edit. If the
// edit is inside a tag name whose element has a matching close (or open) tag,
// the same new name is written there too, in the same transaction — so one
// undo reverts both. The pair of ranges is then remembered in a state field
// and mapped through later edits, because once the name is fully deleted
// (`<>`) the syntax tree no longer has a tag name to find; the remembered
// pair keeps the link alive until the cursor leaves the tag.

import { EditorState, StateField, StateEffect } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';

const setPair = StateEffect.define();

/** {a:{from,to}, b:{from,to}} — open and close tag name ranges, or null. */
const pairField = StateField.define({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setPair)) return e.value;
    if (!value) return null;
    if (tr.docChanged) {
      const map = (r) => ({ from: tr.changes.mapPos(r.from, -1), to: tr.changes.mapPos(r.to, 1) });
      value = { a: map(value.a), b: map(value.b) };
    }
    if (tr.docChanged) {
      // typing a space or `>` right after the name ends the link
      const valid = (r) => NAME_CHARS.test(tr.state.sliceDoc(r.from, r.to));
      if (!valid(value.a) || !valid(value.b)) return null;
    }
    if (tr.selection || tr.docChanged) {
      const head = tr.state.selection.main.head;
      const inside = (r) => head >= r.from && head <= r.to;
      if (tr.state.selection.ranges.length > 1 || (!inside(value.a) && !inside(value.b))) return null;
    }
    return value;
  },
});

const NAME_CHARS = /^[\w\-.:]*$/;

function tagNameAt(tree, pos) {
  for (const side of [-1, 1]) {
    const node = tree.resolveInner(pos, side);
    if (node.name === 'TagName' && node.from <= pos && node.to >= pos) return node;
  }
  return null;
}

/** For a TagName node, the counterpart name node in the same element (only if both names match). */
function counterpart(state, nameNode) {
  const tag = nameNode.parent;
  if (!tag || (tag.name !== 'OpenTag' && tag.name !== 'CloseTag')) return null;
  const element = tag.parent;
  if (!element || element.name !== 'Element') return null;
  const open = element.firstChild;
  const close = element.lastChild;
  if (!open || open.name !== 'OpenTag' || !close || close.name !== 'CloseTag' || open === close) return null;
  // An open tag still being typed (`<div` without `>`) isn't linked yet.
  if (!open.lastChild || open.lastChild.name !== 'EndTag') return null;
  const openName = open.getChild('TagName');
  const closeName = close.getChild('TagName');
  if (!openName || !closeName) return null;
  if (state.sliceDoc(openName.from, openName.to) !== state.sliceDoc(closeName.from, closeName.to)) return null;
  return tag.name === 'OpenTag'
    ? { self: { from: openName.from, to: openName.to }, other: { from: closeName.from, to: closeName.to } }
    : { self: { from: closeName.from, to: closeName.to }, other: { from: openName.from, to: openName.to } };
}

const filter = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || !(tr.isUserEvent('input') || tr.isUserEvent('delete'))) return tr;
  if (tr.startState.selection.ranges.length > 1) return tr;
  let change = null, count = 0;
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => { count++; change = { fromA, toA, text: inserted.toString() }; });
  if (count !== 1 || !NAME_CHARS.test(change.text)) return tr;
  const { fromA, toA, text } = change;
  const start = tr.startState;

  // 1. an edit inside a remembered pair
  let link = null;
  const pair = start.field(pairField, false);
  if (pair) {
    const within = (r) => fromA >= r.from && toA <= r.to;
    if (within(pair.a)) link = { self: pair.a, other: pair.b };
    else if (within(pair.b)) link = { self: pair.b, other: pair.a };
  }
  // 2. otherwise, an edit inside a tag name found in the syntax tree
  if (!link) {
    const node = tagNameAt(syntaxTree(start), fromA);
    if (!node || toA > node.to) return tr;
    link = counterpart(start, node);
    if (!link) return tr;
  }

  const { self, other } = link;
  const newName = start.sliceDoc(self.from, fromA) + text + start.sliceDoc(toA, self.to);
  if (newName === start.sliceDoc(other.from, other.to)) return tr;
  const delta = text.length - (toA - fromA);
  // Positions of the other name after the user's own edit:
  const otherAfter = other.from > self.from ? { from: other.from + delta, to: other.to + delta } : other;
  const selfAfter = { from: self.from, to: self.to + delta };
  const shift = newName.length - (other.to - other.from);
  const final = other.from > self.from
    ? { self: selfAfter, other: { from: otherAfter.from, to: otherAfter.from + newName.length } }
    : { self: { from: selfAfter.from + shift, to: selfAfter.to + shift }, other: { from: other.from, to: other.from + newName.length } };
  const opened = other.from > self.from ? final.self : final.other;
  const closed = other.from > self.from ? final.other : final.self;
  return [tr, {
    changes: { from: otherAfter.from, to: otherAfter.to, insert: newName },
    effects: setPair.of({ a: opened, b: closed }),
    sequential: true,
  }];
});

export const linkedTags = [pairField, filter];
