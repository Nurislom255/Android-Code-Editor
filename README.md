# Android Code Editor — v2

An offline-first code editor for Android phones and tablets, built as a web app
(CodeMirror 6) and wrapped into an APK with Capacitor. v2 follows the
[*CodeEditor Android — Project Specification & Build Plan (v2)*](SPEC.md), mapping each
native-Android decision to its web equivalent, and adds **touch gestures** so
coding on a phone feels natural.

What's next: see **[ROADMAP.md](ROADMAP.md)** (keys bar redesign, VS Code look,
tabs & explorer, built-in Python and C++). Phase 1 of it — typing
correctness — is built: see *Typing* below.

Run it: build once (`npm run build`), then `npm run serve` and open
<http://localhost:5173>. It also works as an installable PWA from GitHub Pages
(`docs/` is the published build) and fully offline after the first visit.

---

## Touch gestures (new in v2)

Gestures act on the code itself. All of them can be remapped or switched off
in **Settings → Touch & gestures**, and a hint chip shows what each one did.

| Gesture | Default action |
|---|---|
| **Swipe right** (1 finger) | **Autocomplete**: accept the highlighted suggestion → else jump to the next snippet field → else open the suggestion list |
| **Swipe left** (1 finger) | Close the suggestion list → else previous snippet field → else delete the word before the cursor (like Gboard's swipe on backspace) |
| Swipe left / right (2 fingers) | Undo / redo |
| Swipe down (2 fingers) | Hide the keyboard |
| Tap (2 fingers) | Command palette |
| Pinch | Zoom the code font (saved) |
| Tap / drag the line numbers | Select one / several lines |
| Keys bar: **swipe up** or **hold** a key | Type the small symbol in its corner (`(` → `)`, `=` → `=>`, …); leaning or curved swipes count |
| Keys bar: drag the **trackpad** strip | Move the cursor (with ⇧ armed: select) — works with any keyboard app |
| Keys bar: hold an arrow | Key repeat |
| Status bar: swipe left / right | Next / previous tab |
| Long-press a tab, file or folder | Context menu (rename, delete, split, …) |

How false triggers are avoided (see `src/core/gestures.js`):

- A swipe must be **short, fast and fairly straight**: with the Normal
  sensitivity ≥ 56 px, ≤ 500 ms, ≥ 0.22 px/ms and within 35° of its axis.
  The angle comes from a line fitted through the whole finger path, so a
  thumb arc whose end curls up still counts. Strict / Loose presets are in
  Settings, with a **test pad** that tells you how each swipe was read (or
  why it wasn't a swipe: "too slow (620 > 500 ms)", "too diagonal (41°)").
- A swipe never moves the cursor: after the first 8 px a mostly-sideways
  touch is claimed by the editor (no scrolling, no caret placement), and the
  selection and scroll position from before the touch are put back before
  the gesture's action runs.
- A finger that rests ≥ 400 ms before moving is selecting text, not swiping.
- Touches that start within 20 px of the screen edge belong to Android's own
  back gesture and are ignored.
- **"Can it scroll?" rule**: with soft-wrap off, a horizontal flick is also how
  you scroll a long line. If the code can scroll that way, the browser keeps
  the touch and a flick that scrolled stays a scroll; only a swipe that
  couldn't scroll anything becomes a command. With wrap on (the phone
  default) nothing scrolls sideways, so swipes always work.
- Two-finger touches are claimed by the editor (no page zoom/scroll) so pinch
  and two-finger swipes are reliable. Pinch vs. two-finger swipe is decided by
  the change in finger spread (≥ 14 % *and* ≥ 28 px).

---

## Typing (ROADMAP Phase 1)

- **Automatic semicolons** (C, C++, Java, C#, JS, TS; never Python/Kotlin),
  only for obvious statements at the start of a line: `int x =`, `x +=`,
  `return `, `foo(`, `obj.run(`, `cout <<`, `i++` get a faded `;` at the end
  of the line with the cursor before it. The `;` is a tab stop: **Tab** or
  **swipe right** jumps past it, typing `;` steps over it, **Enter** steps
  over it unless the line ends with `=`, `,`, `<<`, `.`… **Backspace** right
  after it appears removes it. The check runs only when one of a few
  trigger characters is typed, so it costs nothing while you type normally.
  JS files written without semicolons are left alone. Settings → Typing.
- **Complete statement**: keys-bar `⏎;` or **Ctrl+Shift+Enter** — adds the
  missing `;` (`:` after a Python header, ` {}` after `if (…)` or a function
  header), closes an open `(`, and starts a new indented line.
- **Tags without typing `<`**: in HTML text, typing `di` suggests `div`,
  `dialog`…; accept with **Tab**, swipe right or Enter → `<div>|</div>`. Not
  in attribute values, comments, `<script>`/`<style>` or capitalised words;
  in the middle of a sentence the list appears from two letters on and
  Enter still starts a new line (Tab / swipe right accept).
- **Emmet** in HTML and CSS: `!` → HTML5 page, `ul>li*3`, `div.card>p`;
  CSS `m10`, `df`, `p10-20`.
- **Renaming `<div>` renames `</div>`**.
- Suggestions for **file paths** in `src=""`, `href=""`, `url()`, `import '…'`,
  `#include "…"` and for **words from your other open files**.
- The keys bar types through the same pipeline as the keyboard, so `(` from
  the bar auto-closes and `>` from the bar closes an HTML tag.
- **Several cursors at once:** keys bar `+⇣` / `+⇡`, or select lines (drag
  down the line numbers) and tap `⫶`; whatever you type goes to every line.
  Tap the text to get back to one cursor. Keyboard: Ctrl+Alt+↑/↓, Ctrl+D,
  Shift+Alt+I.
- **No automatic capitals in code:** on Android the editor uses the classic
  input method by default, which passes "no capitals, no autocorrect" to the
  keyboard (Settings → Typing to switch).

---

## What's in v2 (by spec phase)

**Phase 1 — editing on a phone**
- Projects in the app's private storage (works everywhere, offline), real
  folders on desktop Chrome/Edge, and device paths in the Android build
  (`ProjectFs` interface, spec §4.2). Import a folder or `.zip`, export `.zip`.
- Lazy file tree that hides `.git`, `node_modules`, `build` by default.
- Soft wrap per file, with wrapped rows indented under their line.
- Coding-keys bar: per-language symbol rows (editable), then Tab, Complete
  statement (`⏎;`), new line below, move line up/down first; a trackpad strip
  for the cursor (no arrow keys), Shift/Ctrl/Alt (one-shot, double-tap to
  lock), undo/redo, hide keyboard, **multi-line editing** (`+⇣`/`+⇡` add a
  cursor below/above, `⫶` a cursor on each selected line, `Sel+` next
  occurrence), more line operations. Both rows scroll sideways from any key.
- Auto-close brackets, auto-indent, line operations, undo grouping.
- Highlighting for ~30 languages (incremental Lezer parsers for JS/TS/JSX,
  HTML, CSS, JSON, Markdown, Python, C/C++, Java; highlight-only modes for
  Kotlin, Go, Rust, Swift, PHP, Ruby, Lua, Shell, YAML, SQL, …).
- Find & replace (regex, case, whole word), hardware-keyboard shortcuts
  (press **F1** or open *Keyboard shortcuts* in the palette).
- Save keeps **encoding, BOM, line endings and final newline** exactly;
  invalid UTF-8 opens read-only; huge/minified files degrade instead of freezing.
- **Unsaved-buffer recovery**: dirty buffers are mirrored to IndexedDB ~1.5 s
  after typing stops (and immediately when the app goes to the background), so
  they come back after Android kills the app. Open tabs are restored too.
- Read-only lock (also stops the keyboard popping up), pinch-to-zoom the
  code, a separate **interface size** for menus/tabs/panels/keys bar, settings.

**Phase 2 — real editor behaviour**
- Syntax-error underlines from the parse tree + a Problems list, bracket
  matching, folding, **expand/shrink selection** (word → expression → block).
- Outline panel, breadcrumbs, sticky scroll, fast-scroll thumb.
- Quick open (fuzzy), command palette, go to line / symbol, back/forward history.
- Project-wide search (plain/regex/case/whole word) respecting `.gitignore`.
- Snippets with tab stops, built-in per language + your own (JSON in Settings).
- **Git** (isomorphic-git): init, status, diff, stage/unstage/discard, commit,
  branches, log, push/pull/clone; gutter markers; tokens stored encrypted.
- Local history: a snapshot per save, kept N days, compare/restore.
- External change detection on resume (reload clean files; conflict bar for
  dirty ones; never silently overwrite on save).
- `.editorconfig` support; indentation auto-detected otherwise.
- Adaptive layout (phone drawer / tablet sidebar), split editor (same file in
  both panes stays in sync), mouse right-click menu.

**Phase 3 — running code**
- Run JavaScript in a Web Worker: streamed console output, Stop button and time
  limit (a `while(true){}` can always be stopped), `readline()` from a stdin
  box and interactive `await input()`, clickable `file:line` in errors.
- Live HTML/CSS/JS preview that resolves real paths: `<link>`, `<script src>`,
  ES-module imports, images, `url()` in CSS and `fetch('data.json')` — using
  unsaved editor content; console output from the page goes to the console.
- Markdown preview, Prettier formatting (JS/TS/CSS/HTML/JSON/Markdown/YAML).

## Not included (honest list)

| Spec item | Status |
|---|---|
| Native Kotlin editor view / InputConnection / tree-sitter via NDK | Replaced by their web equivalents: CodeMirror 6's contenteditable input and Lezer incremental parsers |
| Python execution (Chaquopy) | Not in the web build; it would need a bundled interpreter (Pyodide, 10+ MB) |
| Termux bridge, LSP-lite autocomplete | Not possible from a web page without a native plugin |
| Push/pull in a plain browser | Works, but GitHub's git servers don't send CORS headers, so requests go through the proxy configured in Settings → Git |
| Device folders (Option B, all-files access) | `CapacitorProjectFs` is implemented and unit-tested against a fake plugin, **not yet run on a real device** — see `CAPACITOR_SETUP.md` |
| Haptics in the APK | `navigator.vibrate` needs the `VIBRATE` permission in the Android manifest |
| Real-device keyboard matrix (Gboard, Samsung, SwiftKey) | Tested in emulated Chromium only; real keyboards differ — please test on your phone (ROADMAP lists the Phase 1 checks) |

---

## Project structure

The spec's layering (§5, §7), as web modules:

```
src/
  core/      pure logic, no DOM — runs in Node unit tests (spec: editor-core)
             gestures.js (recognizer) · textFormat.js (BOM/EOL/encoding) ·
             editorconfig.js · lineDiff.js (Myers) · fuzzy.js · search.js ·
             ignore.js · navHistory.js · settings.js · inspect.js · linkify.js
  storage/   ProjectFs implementations (File System Access / OPFS handles,
             Capacitor), IndexedDB, recovery store, local history, secrets
  editor/    CodeMirror setup, languages, gesture layer, outline, sticky
             scroll, expand selection, syntax lint, git gutter, snippets
  app/       workspace (documents, panes, tabs, save, recovery), composition
             root (app.js), chrome (tabs/status bar), preview controller
  ui/        layout, file tree, palette, panels, keys bar, dialogs
  run/       JS runner, preview builder, Prettier client
  git/       isomorphic-git service + ProjectFs → fs adapter
  workers/   run.worker.js (JS sandbox), format.worker.js (Prettier)
docs/        BUILD OUTPUT (GitHub Pages + Capacitor webDir) — don't edit
tests/unit   node:test — core logic, git against the real git CLI, …
tests/e2e    Playwright — desktop, phone (touch) and tablet emulation
```

## Development

```bash
npm install
npm run build        # → docs/   (npm run build:dev for readable output + source maps)
npm run serve        # http://localhost:5173  (must be http(s): modules, workers and the
                     #  service worker don't work from file://)
npm test             # unit tests (Node)
npm run test:e2e     # end-to-end tests (Playwright, Chromium)
npm run check        # all of the above
```

The e2e tests drive real touch input through the Chrome DevTools Protocol with
explicit timestamps, so swipe speed in tests is exact; they also run git
push/pull/clone against a local `git http-backend` server. Tests that press
Enter/Backspace in the editor run on the desktop project only: in Android
emulation CodeMirror drops a share of synthetic Enter/Backspace presses
(details in ROADMAP.md, Phase 1 result).

To wrap as an APK, see **[CAPACITOR_SETUP.md](CAPACITOR_SETUP.md)**.
