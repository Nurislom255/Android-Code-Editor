// ROADMAP Phase 7 — git, more advanced. Acceptance tests written ahead: each
// is test.fixme (reported as skipped) until built. Real tests run against the
// local git server the existing tests use (tests/e2e/gitHttpServer.mjs).
import { test } from '@playwright/test';

test.fixme('sync at a glance: ahead/behind in the status bar, one Sync, Commit & push', async () => {
  // Clone, commit locally → status bar "↑1". Another clone pushes → Fetch shows "↓1".
  // Sync = pull then push → both 0. "Commit & push" does both in one step.
});

test.fixme('history view: commits with branch lines; a commit shows its files and diffs', async () => {
  // 3 commits → 3 rows newest first. Tap one → changed files; tap a file → its diff.
  // "Check out" (detached, warned) and "Branch from here" work.
});

test.fixme('amend the last commit; undo the last commit (changes go back to staged)', async () => {
  // Amend with a new message → same parent, new message. Undo → the commit is gone, its changes staged.
});

test.fixme('hunks: stage / unstage / discard one change from the diff and from the gutter', async () => {
  // A file with two separate changes: stage only the first → index has it, the second stays unstaged.
  // Tap a gutter marker → the old lines; Revert puts just that change back.
});

test.fixme('branches: delete, rename, merge into current, remote branches, upstream', async () => {
  // Fast-forward and a real merge (merge commit) both work; deleting the current branch is refused.
});

test.fixme('merge conflicts: Accept current / incoming / both in the editor; abort the merge', async () => {
  // Conflicting edits on two branches → merge → conflict blocks highlighted with the three buttons.
  // Resolving all → can commit. Abort → back to the state before the merge. Doable without a keyboard.
});

test.fixme('stash: save, list, apply, pop, drop', async () => {
  // Edit, Stash → clean tree, one entry. Pop → edit back, list empty.
});

test.fixme('tags: create (light / annotated), push, delete', async () => {
  // Tag v1 → listed; push → the server has refs/tags/v1; delete → gone locally.
});

test.fixme('from the file tree: Add to .gitignore, Show history of this file', async () => {
  // Long-press build.log → Add to .gitignore → the line is added and the file greys out.
});

test.fixme('APK: push / pull without the CORS proxy (native HTTP)', async () => {
  // Device-only: in the Android app, push to a real https remote with the proxy setting empty.
});
