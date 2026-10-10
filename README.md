# Android Code Editor — v2

An offline-first code editor for Android phones and tablets, built as a web app
(CodeMirror 6) and wrapped into an APK with Capacitor. v2 follows the
[*CodeEditor Android — Project Specification & Build Plan (v2)*](SPEC.md), mapping each
native-Android decision to its web equivalent, and adds **touch gestures** so
coding on a phone feels natural.

What's next: see **[ROADMAP.md](ROADMAP.md)** (settings pages, VS Code look,
tabs & explorer, built-in Python, C, C++ and Rust). Phase 1 — typing
correctness — is done (see *Typing*); Phase 2 part 1, the new **keys bar**,
is built (see *Keys bar*).

Run it: build once (`npm run build`), then `npm run serve` and open
<http://localhost:5173>. It also works as an installable PWA from GitHub Pages
(`docs/` is the published build) and fully offline after the first visit.
Settings → About shows the version and when it was built, and checks the
website for a newer one; a downloaded update offers a **Reload** button.

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
| **Triple-tap** a line | Delete that line (Undo brings it back) |
| Pinch | Zoom the code font (saved) |
| Tap / drag the line numbers | Select one / several lines |
| Keys bar | Swipes and holds on the keys: see *Keys bar* below |
| Status bar: swipe left / right | Next / previous tab |
| Long-press a tab, file or folder | Context menu (rename, delete, split, …) |
| Long-press a tab, file or folder, then keep moving | Drag it: reorder tabs or move them to the other pane; move files and folders into a folder (or to the project root: the empty space below the list). With a mouse, just drag |

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

## Keys bar (ROADMAP Phase 2)

Above the keyboard while you type in the editor (Settings → *Keys bar*:
Auto / Always / Never). Made for two thumbs: no row scrolls sideways and no
key is narrower than 44 px.

```
Phone:   [Mod][ctx][ctx][ctx][ctx][cursor][ ⋯ ]    context keys: what fits where the cursor is
         [Tab][ ◉ ][ s1][ s2][ + ][ line ][undo]   s1, s2: the language's most used symbols; + operators
Tablet:  [Esc][Tab][ ◉ ][Ctrl][Shift][Alt]   [ctx ×6][s1 … s6][line][cursor][undo][⋯]
```

A landscape phone gets one row: `Tab ◉ Mod ctx×4 s1 s2 + line cursor undo ⋯`.
On a symbol key, the small symbols around the middle are what a swipe
toward them types: top = **swipe up**, bottom = swipe down, left and right =
swipe sideways. On Tab, undo and the other action keys, the corner symbol is
swipe up (or hold).

| Key | Tap | Swipe | Hold |
|---|---|---|---|
| **Tab** | Tab / indent / accept suggestion | up: Shift+Tab (outdent) | Shift+Tab |
| **◉** joystick | Select the word | Drag: the cursor follows like a mouse — move slowly for single characters, faster to go far. It sticks to one direction (a wobbly sideways drag stays on the line). It stops at the end (and start) of a line — the knob turns amber; keep pushing for a moment to go on to the next line. Rest the finger far out and it keeps moving. Quick flick ← / →: line start / end | Then drag: select |
| **Symbols** (`;` `(` …) | The symbol | The variants shown small around it (`(`: up `)`, down `[]`, left `{}`) | All variants pop up: slide to one, release |
| **+** operators (code files) | `+` | up `-`, down `*`, left `/`, right `**` power (JS, Python) or `%` (C, C++, Java…: no power operator there — use `pow()`, offered after `=`) | `% = < > ! & \| ^` (`^` is XOR, not power), Python also `//` |
| **line** (↵) | New line below | Move the line up / down (hold to repeat) | Line actions pop up: `⏎;` complete statement, `↥` new line above, Dup, Join, `✕Ln` delete, `//` comment |
| **cursor** (multi-cursor) | Add a cursor below | up: above | `⫶` a cursor on each selected line, `Sel+` next match, `Sel*` all matches |
| **undo** | Undo | up: Redo | Redo (repeats) |
| **Mod** | Opens Ctrl · Shift · Alt · Esc · Home · End | | |
| **⋯** all keys | Every key, grouped: lines, cursors, selection, navigation (Page up/down…), editing, brackets, operators | | |

- **Context keys** follow the code: C++ at a statement start `std::` `cout <<`
  `auto` `for ()` `if ()` `return`, after `cout` `<<` `endl` `"\n"`, after `=`
  `{}` `""` `nullptr`, after a name `.` `()` `->` `::`; in a string `\n` and the
  closing quote; HTML tag `class=""` `id=""`; CSS `:` `;` `px`; JS, Python,
  Markdown, JSON have their own; with text selected: Cut, Copy, Paste, `//`,
  indent, and `(` `[` `{` `"` to wrap it. A key that is still offered keeps
  its place; they change at a word boundary or after a short pause in typing.
- **Esc** shows up in the first context slot whenever there is something to
  escape: suggestions, the find panel, several cursors, a selection.
- **Modifiers** are one-shot (next key only); a double tap locks them. Ctrl
  offers its shortcuts as keys: S Save, F Find, D next match, A select all,
  `/` comment, G go to line, P go to file, X C V, Z Y. Shift: the joystick
  and Home / End select, symbols type their first variant. Alt: the joystick
  moves lines (↑↓) or jumps by word part (←→).
- **Nothing twice:** a context key never repeats a key of the main row (no
  `;` or `()` up there when `;` and `(` are below).
- Every key's tooltip shows its keyboard shortcut (e.g. new line above
  **Ctrl+Alt+Enter**), for when a keyboard is connected.
- Symbol rows per language are editable in Settings (`(^)^[]^{}` = tap `(`,
  swipe up `)`, down `[]`, left `{}`; a fourth variant is swipe right).

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
- **Complete statement**: keys-bar `⏎;` (hold `↵`, or Mod) or **Ctrl+Shift+Enter** — adds the
  missing `;` (`:` after a Python header, ` {}` after `if (…)` or a function
  header), closes an open `(`, and starts a new indented line.
- **Tags without typing `<`**: in HTML text, typing `di` suggests `div`,
  `dialog`…; accept with **Tab**, swipe right or Enter → `<div>|</div>`. Not
  in attribute values, comments, `<script>`/`<style>` or capitalised words;
  in the middle of a sentence the list appears from two letters on and
  Enter still starts a new line (Tab / swipe right accept).
- **Emmet** in HTML and CSS: `!` → HTML5 page, `ul>li*3`, `div.card>p`,
  `lorem` / `lorem20` (placeholder text, 20 words); CSS `m10`, `df`, `p10-20`.
- **Renaming `<div>` renames `</div>`**.
- Suggestions for **file paths** in `src=""`, `href=""`, `url()`, `import '…'`,
  `#include "…"` and for **words from your other open files**.
- The keys bar types through the same pipeline as the keyboard, so `(` from
  the bar auto-closes and `>` from the bar closes an HTML tag.
- **Several cursors at once:** keys bar `+⇣` (swipe up: above), or select
  lines (drag down the line numbers) and hold `+⇣` → `⫶`; whatever you type
  goes to every line.
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
- Coding-keys bar (redesigned in Phase 2: see *Keys bar* above).
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
- The other uses of the name under the cursor are lightly highlighted (from
  the syntax tree: not in strings or comments). Settings → Editor.
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
