// ROADMAP Phase 6 — VS Code extras. Acceptance tests written ahead: each is
// test.fixme (reported as skipped) until that item is built.
import { test } from '@playwright/test';

test.fixme('JS/TS intelligence: member completion, hover type, go to definition, rename, real errors', async () => {
  // const p = { name: "a", age: 1 }; p.| → completion offers name and age (types shown).
  // Long-press p → hover shows its type. Go to definition jumps to the declaration (also across files).
  // Rename p → every use in the project renamed. let x: number = "s" in .ts → an error on that line.
});

test.fixme('project-wide find and replace with a preview', async () => {
  // Search "foo" in 3 files, replace with "bar": a preview lists each change; unticking one keeps it.
  // Replace all → files changed (open ones too, undoable); regex and match case respected.
});

test.fixme('CSS colour swatches and a colour picker', async () => {
  // color: #ff0000 shows a red swatch before the value; tapping it opens a picker; picking blue writes #0000ff.
});

test.fixme('side-by-side diff view for git changes and local history', async () => {
  // Wide screen: old and new side by side with aligned changed lines; phone: falls back to inline.
});

test.fixme('breadcrumb dropdowns jump to sibling symbols and files', async () => {
  // Tap the function name in the breadcrumbs → a list of the file's other functions; picking one jumps there.
  // Tap the folder part → files in that folder.
});
