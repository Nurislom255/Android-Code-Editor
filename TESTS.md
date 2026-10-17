# CodeEditor — tests per phase

Each ROADMAP phase has two kinds of tests:

- **Automated**: they run on every change (`npm run check`). Unit tests check
  pure logic in Node; end-to-end (e2e) tests drive the built app in Chromium
  on three screens: **desktop** (1280×800, mouse), **phone** (Pixel 7, touch)
  and **tablet** (Galaxy Tab S4 landscape, touch). Touch, swipes, long-presses
  and keyboard composition are sent as real input events, not simulated
  clicks.
- **On the device**: what a test machine can't prove — a real Android
  keyboard (Gboard, Samsung), Firefox for Android, vibration, the APK. The
  owner runs these after each merge. Anything found becomes an automated test
  where it can.

A phase is **done** when its automated tests pass on all three screens and
its device checks were done by the owner.

## Running them

```sh
npm run build                       # the e2e tests run against docs/
npm run check                       # everything: unit + build + e2e
npm run test:phase -- 3             # one phase (unit + e2e, all screens)
npm run test:phase -- 3 --unit      # only its unit tests
npm run test:phase -- 3 --e2e --project=phone   # only e2e, only the phone
npm run test:phase -- base 1 2 3    # several phases
```

Which files belong to which phase: [`tests/phases.json`](tests/phases.json).
Phases not built yet (5–7) already have their **acceptance tests** in
`tests/e2e/phaseN.spec.mjs`, written as `test.fixme` with the steps and the
expected result: they show as *skipped* until the phase replaces them with
real tests. Read them as the definition of done.

---

## Foundation (v2): files, workspace, run, git, offline — `base`

Automated
- Unit: `capacitorFs`, `editorCore`, `editorconfig`, `git`, `indent`,
  `lineDiff`, `misc`, `textFormat`.
- e2e: `app` (layout per screen, drawer, hover only with a mouse), `core`
  (projects, editing, status bar), `fileSafety` (CRLF and BOM kept, invalid
  UTF-8 opens read-only, files changed by another app, save conflicts),
  `workspace` (tabs, split, recovery after a crash, problems), `perf` (typing
  in a 5,000-line file: under 50 ms from key to screen, on each screen size;
  runs last, alone, so the other tests don't share the CPU), `run` (JS
  console, Stop, time limit, input, clickable errors, HTML / Markdown
  preview, Prettier), `git` + `gitRemote` (init, stage, commit, branch, push
  / pull against a local git server), `offline` (works with the network off).

On the device
- [ ] Open a project, edit, save, close the app, reopen: the edit is there.
- [ ] Kill the app with unsaved text: it comes back on the next start.
- [ ] Run a JS file; Stop an infinite loop.

## Phase 1 — Typing correctness

Automated
- Unit: `gestures` (angle tolerance, direction lock, flick vs scroll),
  `emmet`, `semicolons`.
- e2e `gestures`: swipe right accepts / opens autocomplete and walks snippet
  fields; a 30° diagonal still counts; slow drags, vertical flicks and long
  line scrolls are not commands; swipe left closes the list then deletes a
  word; two-finger undo / redo; pinch zoom; two-finger tap = palette;
  triple-tap deletes a line; line numbers select; remapping.
- e2e `typing` (first half): automatic `;` (faded, stepped over, never in
  `for` / `if` headers or `#include`, off switch), complete statement,
  Python `:`, Emmet `!` and `ul>li*3`, tags without `<`, `di` → div, lorem,
  linked tag rename, path and import completion, words from other files,
  suggestions while a keyboard is still composing.

On the device (Gboard, then Samsung Keyboard)
- [ ] Type a JS line: suggestions appear while the word is still underlined.
- [ ] Swipe right to accept; a slightly diagonal swipe still works.
- [ ] `ul>li*3` + swipe right in HTML expands.

## Phase 2 — Keys bar, cursor & selection, Settings, shortcuts

Automated
- Unit: `contextKeys`, `keysBarLayout` (layouts per profile, required keys,
  import validation), `keybindings` (combos, conflicts, overrides),
  `multiCursor`, `wordHighlight`.
- e2e `keysbar`: no row scrolls, keys ≥ 44 px; symbols by language;
  variants by swipe / hold; context row (C++ `<<`, HTML attributes); pairs
  put the cursor inside and closers step over; line key; joystick (precision,
  line-end wall, flick); modifiers; operator key; multi-cursor key; the More
  sheet; Pin; the bar hides with the keyboard; nothing shows through it.
- e2e `typing` (second half): highlight of the name under the cursor,
  for-loop snippet renames all three places, keyboard input reaching only the
  first cursor (Firefox for Android) still edits every cursor, Ctrl+D
  selections.
- e2e `settings`: pages on phone and wide screens, Android Back, search,
  keys-bar editor, symbol sets, custom shortcuts.

On the device
- [ ] Firefox for Android: select two equal names (Ctrl+D key) and type —
      both change; no selection bar covers the keys.
- [ ] Joystick: stop exactly at the line end, cross after a short push.
- [ ] Settings → Keys bar: move a key, then use it in the editor.
- [ ] Tablet: the ⋯ sheet covers what is below it completely.

## Phase 3 — Look & feel

Automated
- Unit `bracketColors`: depth levels cycle through three colours; stray
  closers; brackets in strings, comments, regexes and templates ignored
  (JavaScript, Python, CSS, script in HTML, simple-mode languages, plain
  text); only the visible part is computed, with the depth from above it;
  simple modes remember what is open above the screen, and the result after
  typing on screen equals a fresh count;
  indent guide counts, blank lines follow VS Code's rule.
- Unit `icons`: every generated icon is plain shapes with whitelisted
  attributes (nothing executable reaches the page); file-name → icon (exact
  names, longest extension, fallback); folder names and their open variants.
- e2e `lookfeel`:
  - four themes, the picker; the status bar is purple with no project, blue
    with one, orange while code runs;
  - git status colours names in the tree (and folders holding changes);
  - bracket pairs coloured by depth, VS Code's gold first; after typing
    letters they are recounted (a letter can turn code into a regex);
    indent guides per level, updated when a blank line gets text; both can
    be switched off;
  - Codicons in the interface; Material icons by file type and folder name
    in the tree and tabs; credits in Settings → About;
  - long-press an icon (touch): tooltip, and the button does not fire; a tap
    still works; tree rows keep their own long-press menu;
  - the interface is not selectable; code, console output stay selectable;
  - reduced motion makes entrance animations instant;
  - project name: tap = switch project, hold / right-click = project actions
    (shown as armed); rename (survives a reload, files stay, name clashes
    refused); close; delete;
  - Zen mode (corner button, Esc Esc, Ctrl+Alt+Z); fullscreen on and off;
    the phone's title bar slides away when scrolling down and back when
    scrolling up — but not when the editor scrolls itself;
  - the welcome screen.

On the device
- [ ] Each theme looks right in daylight (Light Modern) and at night.
- [ ] Hold the Save icon: a tooltip and a short vibration, no save.
- [ ] Hold the project name: the menu, with a stronger vibration; rename the
      project; it keeps the new name after closing the app.
- [ ] Scroll a long file on the phone: the title bar slides away and back.
- [ ] Android "Remove animations" on: nothing animates.
- [ ] Not testable here: in the APK, hiding Android's status and navigation
      bars (immersive mode) needs a native plugin — the web Fullscreen API
      works in Chrome; in the APK, Zen mode is the alternative for now.

## Phase 4 — Tabs and file explorer

Automated
- Unit `explorer`: free names for pasted copies ("a copy.js", "a copy
  2.js"; never overwrite), a selected folder covers what is inside it, no
  move into itself, Shift-ranges, the filter (every word, names first), the
  trash's 7 days; a folder's dragged order (saved order wins, folders stay
  on top, new names follow A–Z, a rename keeps its place, a moved folder's
  inner orders move with it).
- e2e `explorer` (the phase's acceptance tests, written ahead, now real):
  - dragging a tab over the right half (phone: lower half) of the code shows
    the drop zone and splits, with the tab in the new pane;
  - preview tabs: a tap opens an italic tab the next tap replaces; typing,
    double-tapping the tab (or, on wide screens, the file in the tree)
    keeps it;
  - the tapped folder (or the tapped file's folder) gets New File / New
    Folder; nothing selected → the project root;
  - create and rename in the tree: the name's stem selected, a bad name
    explained in place, Esc cancels, the open tab follows a rename;
  - a dragged file held over a closed folder opens it without ending the
    drag; "Moved …" Undo moves it back;
  - Select + taps, Copy, Paste into a folder (a clash gets " copy", nothing
    overwritten), Cut + Paste moves;
  - compact `a/b/c` rows, the tree following the active tab, Open editors
    (count, rows, ✕), the filter list;
  - Delete → trash with Undo; a folder restored from Files ⋯ → Trash with
    its contents and empty folders; entries older than 7 days dropped when
    the project opens;
  - a long-press menu never acts when the finger lifts (it opens clear of
    the finger);
  - a file dragged between two rows: while held, its empty slot is already
    there; let go, it stays — after a reload too; let go above a folder, it
    lands at the top of the files; the middle of a folder still moves it
    inside; Files ⋯ → Sort A–Z forgets the order (v2.8.0);
  - tabs and Open editors: the dragged tab's slot moves, the others slide
    aside; the tab order follows (v2.8.0).
- e2e `workspace`: create / rename / delete from the tree menu, now in place.

On the device
- [ ] Tap a few files in the tree: one italic tab follows; type in one: it
      stays.
- [ ] Long-press a tab, drag it to the lower half of the code: split.
- [ ] Tap a folder, then New file (+): named in the tree, created inside it.
- [ ] Long-press a file near the bottom of the tree: the menu opens above,
      and lifting the finger does nothing.
- [ ] Drag a file over a closed folder and wait: it opens; drop; Undo.
- [ ] Delete a folder, then Files ⋯ → Trash → Restore.
- [ ] Hold a file and drag it up the tree slowly: the row lifts with a
      shadow, the other rows slide aside smoothly; let go between two files —
      it stays; close and reopen the app — still there.
- [ ] The same with a tab in the tab bar, and in Open editors.
- [ ] Firefox for Android: the same drags (the list must not scroll under
      the finger).

## Phase 5 — Built-in runtimes (not built)

Acceptance tests (`tests/e2e/phase5.spec.mjs`, fixme): Python output
streams, time limit and Stop, `input()`, clickable error lines, offline;
C++ hello world with `<iostream>` and `cin`, the common headers, clickable
compile errors and the exit code; Rust hello world only if its spike is a go.
On the device: size added, first and warm run time (go / no-go numbers in
ROADMAP Phase 5).

## Phase 6 — VS Code extras (not built)

Acceptance tests (`tests/e2e/phase6.spec.mjs`, fixme): TypeScript
completions, hover, go to definition, rename and errors; project-wide
replace with a preview; colour swatches and picker; side-by-side diff;
breadcrumb dropdowns.

## Phase 7 — Git, more advanced (not built)

Acceptance tests (`tests/e2e/phase7.spec.mjs`, fixme): ahead / behind and
Sync; history view; amend and undo last commit; hunks from the diff and the
gutter; branch delete / rename / merge; merge conflicts resolved on a touch
screen; stash; tags; Add to .gitignore and file history from the tree; the
APK pushing without the CORS proxy (device only).

---

## Writing tests for a new phase

1. Turn each `test.fixme` of the phase into a real test (keep its title: it
   is the requirement).
2. Add unit tests for any pure logic (put the logic where Node can import it
   without a browser).
3. List new files in `tests/phases.json` and the device checks here.
4. `npm run check` must pass on all three screens before the PR.
