// ROADMAP Phase 4 — tabs and file explorer. Acceptance tests written ahead:
// each is test.fixme (reported as skipped) until the phase is built; the body
// lists the steps and what must be true. Replace fixme with the real test.
import { test } from '@playwright/test';

test.fixme('tabs: dragging a tab to the right (or bottom) edge shows a drop zone and splits', async () => {
  // Open a.js and b.js. Drag b.js's tab to the right edge of the editor.
  // While over the edge: a highlighted drop zone. On drop: two panes, b.js in the right one.
  // Phone: the bottom edge splits top/bottom instead.
});

test.fixme('tabs: preview tabs — a single tap opens an italic temporary tab, editing keeps it', async () => {
  // Tap a.js in the tree: its tab is italic (preview). Tap b.js: it replaces a.js's tab.
  // Type in b.js (or double-tap its tab): the tab is no longer italic; tapping c.js opens a new tab.
});

test.fixme('explorer: the tapped folder is the target for New File / New Folder', async () => {
  // Tap folder "src". New File "x.js" → src/x.js. Tap src/a.js, New File "y.js" → src/y.js.
  // Nothing selected → project root (fixes v2: the header's New File always used the root).
});

test.fixme('explorer: create and rename inline in the tree, no dialog', async () => {
  // New File shows an editable row in place; Enter creates, Esc cancels; an invalid name shows inline.
  // Rename (menu or F2): the name becomes editable in place; the open tab follows the rename.
});

test.fixme('explorer: folders open while dragging over them; "Moved …" can be undone', async () => {
  // Long-press a file, drag over a closed folder for ~600 ms: it opens without ending the drag.
  // Drop: file moved; the toast "Moved …" has Undo, which moves it back.
});

test.fixme('explorer: cut / copy / paste and multi-select', async () => {
  // Long-press a file → Select; tap two more. Copy, tap a folder, Paste: three copies there.
  // Cut + Paste moves them; name clashes get " copy" suffixes, never overwrite.
});

test.fixme('explorer: Open Editors list, filter box, auto-reveal, compact single-child folders', async () => {
  // Open Editors lists open tabs (dirty dot, close button). The filter box narrows the tree.
  // Switching tabs reveals the file in the tree. a/b/c with one child each shows as "a/b/c".
});

test.fixme('explorer: Delete goes to a 7-day trash and can be restored', async () => {
  // Delete src/a.js: gone from the tree, listed in Trash with its path and date.
  // Restore → back at src/a.js with the same content. Entries older than 7 days are purged on start.
});
