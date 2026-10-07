# CodeEditor — Roadmap after v2

This file is the plan for the next versions, written so that a work session
can start with: **"Read ROADMAP.md and implement Phase N."** Each phase is
self-contained: what is wrong, what was already found in the code, what to
build, and how we know it is done.

## Status

| Phase | Goal | Size | Status |
|---|---|---|---|
| 0 | Real-device test loop (diagnostics) | Small | Not started |
| 1 | Typing correctness: gestures, autocomplete, Emmet, semicolons | Medium | **Built; automated tests pass. Waiting for the on-phone check** (see "Phase 1 — result") |
| 2 | Keys bar redesign, cursor & selection, Settings split | Large | Not started |
| 3 | Look & feel: VS Code blue, icons, tooltips, full screen, themes | Medium | Not started |
| 4 | Tabs drag & split, VS Code-like file explorer | Medium | Not started |
| 5 | Built-in runtimes: 5A Python, 5B C/C++ (spike first) | 5A small, 5B unknown until spike | Not started |
| 6 | VS Code extras: JS/TS intelligence, project replace, … | Large | Not started |

Order matters: 0 → 1 → 2 → 3 → 4 → 5 → 6. Each phase ends with a tested build
pushed to the branch and this table updated.

---

## Decisions made with the owner (do not re-litigate)

| Topic | Decision |
|---|---|
| How the phone is held | **Two thumbs.** Most-used keys sit at the left and right ends of the bars; less-used keys in the middle. |
| Semicolons | `;` matters most in **C++** (also C, Java, C#, JS/TS). Automatic `;` is **on by default** for those languages. JS/TS files written without semicolons are detected and left alone. |
| Running code | **Built in only.** No Termux, no online compiler, no manual setup: install the app and press Run. If C++ cannot be bundled at a reasonable cost, stop and discuss with the owner before choosing anything external. |
| Keys bar | Tab is a first-class key, always visible. Ctrl, Shift, Alt and Esc are reachable whenever they are needed. The whole bar is **customizable from Settings**. Never delete a key from the app — re-rank it into the "More" sheet instead. |
| Settings | Split into small pages with a search box. |
| Accent colour | VS Code blue (`#0078D4`; `#3794FF` on dark backgrounds). |

## Working rules for every phase

1. **Verify touch and keyboard behaviour on a real Android phone** (Phase 0
   tools), with Gboard at minimum. v2's emulated tests passed while real-phone
   bugs remained — emulation is necessary but not enough.
2. Every new behaviour gets an automated test (`tests/unit` for pure logic,
   `tests/e2e` for UI). Behaviour that only a real keyboard app can produce goes
   into `tests/manual/CHECKLIST.md`.
3. Heavy features load lazily (separate chunks); the startup bundle must not
   grow by more than ~10 % per phase without a reason written here.
4. `npm run check` passes, `docs/` is rebuilt, README updated, then push.
5. Accessibility: every new control has an accessible name (TalkBack reads it)
   and a long-press tooltip.

Code map (from v2): pure logic in `src/core/`, editor behaviour in
`src/editor/`, app wiring in `src/app/`, UI in `src/ui/`, runners in `src/run/`
and `src/workers/`. Keys bar: `src/ui/keysBar.js`. Gestures:
`src/core/gestures.js` + `src/editor/gestureLayer.js`. Settings schema:
`src/core/settings.js`; settings UI: `src/ui/settingsPanel.js`.

---

## Phase 0 — Real-device test loop (do first)

Why: items like "a slightly diagonal swipe moves the cursor" and "suggestions
don't appear while typing with Gboard" depend on the phone's keyboard app and
Chrome's touch handling, which emulation does not reproduce.

Tasks
- Document USB remote debugging in README: Android Chrome → `chrome://inspect`;
  for the APK, Capacitor debug builds allow WebView inspection.
- **Diagnostics overlay** (Settings → About → Diagnostics, off by default): a
  live, copyable log of
  - touch events (time, position, target element),
  - each gesture decision: distance, duration, speed, angle, verdict, and the
    *reason* when rejected,
  - selection changes (to see what moved the cursor),
  - keyboard events: `beforeinput` input types and composition
    start/update/end (how Gboard sends text),
  - keys-bar presses.
- "Copy log" button, so the owner can paste a log into a session.
- `tests/manual/CHECKLIST.md`: devices × keyboard apps (Gboard, Samsung
  Keyboard, SwiftKey, hardware keyboard) × the behaviours of Phases 1–2.

Done when: the owner can reproduce a bug on the phone and paste a log that
shows the cause.

---

## Phase 1 — result (what shipped, and what still needs the phone)

Built on branch `claude/android-editor-v2-gestures-5gpnqo`. Unit tests: the
recognizer, 99 table-driven semicolon cases, Emmet rules. E2E (desktop, Pixel 7
and Galaxy Tab emulation): `tests/e2e/typing.spec.mjs`, new cases in
`gestures.spec.mjs` and `keysbar.spec.mjs`.

| Item | Shipped | Where |
|---|---|---|
| 1.1 | Angle from the fitted finger path (≤ 35° Normal), direction lock after 8 px, horizontal touches claimed (`preventDefault`) when the code can't scroll sideways, selection + scroll restored before every gesture action, long-press (≥ 400 ms rest) never a swipe, Strict / Normal / Loose presets, **test pad** in Settings that prints why a touch was or wasn't a swipe | `core/gestures.js`, `editor/gestureLayer.js`, `ui/settingsPanel.js` |
| 1.2 | Keys-bar text goes through every `EditorView.inputHandler` (auto-close, `>` closes tags, `;` steps over); suggestions forced open ~110 ms after an IME composition edit if CodeMirror didn't open them; words from all open files | `editor/editActions.js` `typeText`, `editor/completions.js` |
| 1.3 | Emmet (lazy-loaded chunk) for HTML and CSS; bare tag names (`div` → `<div></div>`) only at the start of a line or right after a tag, one-letter tags only on swipe right / Ctrl+Space (so prose isn't hijacked); linked tag rename, also through an empty name `<>`; path suggestions in `src`/`href`, `url()`, `@import`, `import`/`require`/`fetch`, `#include "…"`, Markdown links | `core/emmetRules.js`, `editor/emmet.js`, `editor/linkedTags.js`, `editor/completions.js` |
| 1.4 | Pending `;` with every rule and exclusion listed below; Complete statement on the keys bar (`⏎;`), Ctrl+Shift+Enter and the gesture map; setting Settings → Typing | `core/semicolons.js`, `editor/semicolons.js` |
| 1.5 | Keys use `touch-action: pan-x` (only the trackpad strip keeps `none`) | `src/styles.css` |

Decisions taken while building (differences from the plan above):
- **No flicker:** the pending `;` is added after a non-word character (space,
  `=`, `(`, `"`…), so typing `int main(` never shows a `;` in between. It is
  still re-checked (and removed) after every edit of its statement.
- **Enter counts auto-closed brackets:** in `foo(a|);` Enter steps over `);`
  (the statement is complete once the `)` is counted). With nothing typed yet
  (`foo(|);`) or after a comma, Enter splits the brackets as usual.
- `break` / `continue` / `return` alone + Enter add their `;`.
- **Chains:** if the next line starts with `.`, `?.`, `->`, `<<`, `>>`, `&&`,
  `||`, `??`, `?` or `:`, the `;` Enter just added on the line above is taken
  back (method chains, `cout` continuation lines).
- C/C++ globals get a `;` only with an initializer (`int count = 0`), not for
  a bare `int count` (too often the start of a function); fields in a
  class/struct always do.
- **Tab accepts a suggestion** (keyboard and keys bar), which is how Emmet
  expands, like VS Code.
- Ctrl+Shift+Enter is also a global shortcut: on Android, CodeMirror
  re-dispatches Enter **without modifiers**, so an editor-only binding never
  fires with a hardware keyboard.
- Gboard composition: implemented defensively without Phase 0 logs (the
  fallback only acts when CodeMirror's own activation didn't open the list).

Found while testing: in Android emulation, CodeMirror drops about 40 % of
synthetic Enter/Backspace presses even in a plain `.txt` file (its Android
key path waits for the keyboard's DOM change). Tests that depend on those
keys therefore run on the desktop project only. Whether real keyboards are
affected is one of the on-phone checks below.

**Still to check on the owner's phone** (Phase 0 is not built yet, so the
gesture test pad is the only on-device diagnostic for now):
- [ ] 20 swipes right at 0–30° all autocomplete; the cursor never jumps.
- [ ] Vertical scrolls and slow drags never trigger commands.
- [ ] Typing `doc` with Gboard shows suggestions within ~150 ms.
- [ ] Enter steps over the pending `;` with Gboard (and Backspace right after
      it appears removes it).
- [ ] The first keys row scrolls when dragged starting on a key.

---

## Phase 1 — Typing correctness (the plan)

### 1.1 Gestures misfire on slightly diagonal swipes (reported issue 3)

Reported: a swipe started at a slight angle moves the cursor to the touch point
and autocomplete does not run.

Found in code: the recognizer accepts at most about 29° off-axis
(`axisRatio: 1.8` in `src/core/gestures.js`) and judges only the start and end
points. A rejected swipe falls through to the browser, which then treats the
touch as a cursor placement.

Tasks
- **Decide intent early.** After the first ~16 px of movement, classify the
  touch as horizontal or vertical and lock it. Once locked horizontal, call
  `preventDefault()` on further `touchmove` events (non-passive listener) so the
  browser neither scrolls nor moves the cursor for that touch.
- Allow up to ~35° off-axis, judged from the whole finger path (fit a line
  through the samples), not only the endpoints.
- **Safety net:** snapshot selection and scroll position at `touchstart`. When a
  gesture is recognized, restore both before running the action. A swipe must
  never move the cursor.
- Never start a gesture on native selection handles or while text is being
  long-press-selected.
- Sensitivity presets in Settings: Strict / Normal / Loose (distance, angle,
  speed), plus a small **test pad** that shows how each swipe was classified.

Done when: on the owner's phone, 20 swipes right at 0–30° all autocomplete and
the cursor never jumps; vertical scrolls and slow drags never trigger commands.
Tests: diagonal 30° swipe e2e test; "cursor unchanged after any gesture" test.

### 1.2 One typing pipeline for keyboard and keys bar (part of reported issue 4)

Found in code: keys-bar keys insert text with a direct `dispatch`, which
**bypasses CodeMirror's input handlers**. That is why `>` typed from the keys
bar does not add `</tag>`, and why other "as you type" features can misbehave
from the bar.

Tasks
- Route all keys-bar text through the same input-handler chain as real typing
  (call every handler in the `EditorView.inputHandler` facet, falling back to a
  normal insert). Auto-close brackets, auto-close tags and the new semicolon
  logic then work identically from the keyboard and the bar.
- **Suggestions while typing with Gboard:** confirm with Phase 0 logs whether the
  list fails to open during composition (the keyboard's word-in-progress mode).
  If so, start completion on `compositionupdate` once the word before the
  cursor has ≥ 1 character (debounced ~100 ms).
- Suggestion sources: identifiers from **all open files**, not only the current
  one; keep language-aware sources first.

Done when: typing `doc` with Gboard shows suggestions within ~150 ms; `>` from
the keys bar closes HTML tags; `(` from the bar auto-closes.

### 1.3 HTML and CSS like VS Code (reported issue 4)

Tasks
- **Emmet** (the `emmet` npm package, MIT), shown as a suggestion and expanded
  with Tab or swipe right:
  - `!` → full HTML5 boilerplate,
  - `div.card>ul>li*3` → nested tags,
  - CSS: `m10` → `margin: 10px;`, `df` → `display: flex;`.
- Tag names without typing `<`: in HTML text, `div` + accept → `<div>|</div>`.
- **Linked tag editing:** renaming `<div>` also renames its `</div>`.
- Path completion inside `src="…"`, `href="…"`, `url(…)`, `import '…'` and
  `#include "…"`, using the project's files.

Done when: `!` + swipe right produces the boilerplate; `ul>li*3` expands
correctly; renaming an open tag updates its closing tag.

### 1.4 Automatic semicolons and "complete statement" (reported issue 4)

This is subtle, so it is specified fully here. (VS Code does not do this;
JetBrains has a similar "complete current statement" command.)

**Languages:** C, C++, Java, C#, JS, TS. Never Python or Kotlin.
For JS/TS only: off for a file whose existing statements mostly lack `;`.

**Pending semicolon:**
- When a statement that needs `;` is started at the end of a line — a
  declaration (`int x = `, `const a = `), `return`, `break`, `continue`,
  `throw`, a call, an assignment, a C++ `using` declaration,
  `std::cout << …` — insert `;` **after** the cursor, shown faded (pending).
- Typing `;` steps over the pending one (like a closing bracket).
- **Enter** steps over it and opens a new line **only when the statement is
  complete**: no unclosed `(`, `[`, `{` on the statement (per the syntax tree),
  and the line does not end in an operator, `,`, `=`, `<<`, `.` or `->`.
  Otherwise Enter breaks the line and the `;` stays pending at the end.
- `const obj = {` / `int a[] = {` → `{|};`; Enter inside the braces opens an
  indented block that still ends with `};`.
- Backspace right after it appears removes it; undo removes it together with
  the typing that created it.

**Never insert** in: `for (…;…;…)` headers, `if`/`else`/`while`/`for`/`switch`/
function/class/struct/namespace/`template<…>` header lines, lines ending in
`{` or `,`, preprocessor lines (`#include`, `#define`), strings, comments,
template literals, JSX text, labels, `case x:`.

**Complete statement** (always available, the no-surprise option): keys-bar key
"⏎;" and `Ctrl+Shift+Enter` — adds `;` if missing (or `:` after a Python block
header, `{}` after a C-like `if (…)`), then starts a new indented line.

Setting: Editor → Typing → Automatic semicolons: On (default) / Off.
Tests: a table-driven unit test per language with every rule and exclusion
above (≥ 40 cases), plus e2e tests for the Enter behaviour.

### 1.5 Quick fix shipped in Phase 1

Found in code: the first keys-bar row cannot be scrolled because every `.key`
has `touch-action: none` and only symbol keys override it
(`src/styles.css`, `src/ui/keysBar.js`). Set `touch-action: pan-x` on action
keys now; Phase 2 replaces the layout anyway.

---

## Phase 2 — Keys bar, cursor & selection, Settings split

(Reported issues 1 and 2, plus the owner's requests for modifiers, Tab and
customization.)

### 2.1 Settings split into pages (foundation for the keys-bar editor)

- Pages: **Appearance · Editor · Typing & autocomplete · Keys bar · Gestures ·
  Files & saving · Run · Git · Snippets · About & diagnostics**.
- A search box at the top filters settings across all pages (VS Code style).
- Phone: list of pages → page with a back button. Tablet: categories on the
  left, settings on the right.

### 2.2 Layout — phone portrait (two thumbs)

```
Context row:  [ ctx1 ][ ctx2 ][ ctx3 ][ ctx4 ][ ctx5 ][ ctx6 ][  ⋯  ]
Main row:     [ Tab  ][  ◉ Joystick  ][ s1 ][ s2 ][ s3 ][ Mod ][  ↶  ]
               ^ left thumb                                right thumb ^
```

- At most 7 slots per row, keys ≥ 44 px wide (target 48 px), **no sideways
  scrolling** in the default layout.
- **Tab** is always at the left edge. Long-press Tab = Shift+Tab (outdent).
- **Joystick** sits under the left thumb (see 2.6).
- **Undo** at the right edge; long-press = Redo.
- **Mod** key opens the modifier layer (see 2.3).
- `s1–s3`: the most-used symbols for the current language (e.g. C++: `;` `{`
  `(`), each with long-press variants (see 2.5).
- **⋯ More** opens a sheet with *every* key (see 2.5).

Phone landscape (keyboard leaves little room): one row
`[Tab][Joystick][ctx1…ctx4][Mod][↶][⋯]`.

### 2.3 Modifiers: Ctrl, Shift, Alt, Esc

A soft keyboard's letters cannot be reliably combined with a virtual Ctrl (the
keyboard app sends them as composed text — see v1 notes in the README), so
modifiers work as **layers** on the bar:

- **Mod** → the context row becomes the modifier row:
  `[Ctrl][Shift][Alt][Esc][⇧Tab][⏎;]`.
- Tapping **Ctrl** arms it (one-shot; double-tap locks, as in v2) and the context
  row shows labelled Ctrl shortcuts: `S Save · F Find · D Next match · A Select
  all · / Comment · G Go to line · P Quick open · X · C · V`.
- **Shift** armed: joystick selects; symbol keys type their shifted variant.
- **Alt** armed: joystick ↑/↓ moves lines; ←/→ jumps by word part.
- **Esc appears automatically** in the first context slot whenever something can
  be escaped: suggestion list, find panel, snippet fields, a selection, the
  palette, a maximized panel. Otherwise it lives in the Mod layer.
- Tablet: Ctrl, Shift, Alt and Esc are always visible in the left cluster
  (2.4). Hardware keyboards keep normal modifier keys.

### 2.4 Layout — tablet

Two clusters at the bottom corners, where the thumbs are, instead of one long
strip of small buttons:

```
[Esc][Tab][ ◉ Joystick ][Ctrl][Shift][Alt]        [ctx1…ctx6][s1…s6][↶][↷][⋯]
```

Option to make the bar a floating dock the owner can drag and resize.

### 2.5 Context row, long-press variants, the "More" sheet

**Context row** — keys predicted from the syntax at the cursor (data-driven
rules, editable in Settings):

| Where the cursor is | Context keys |
|---|---|
| after `=` (`int x =`, `const a =`) | `{}` `[]` `""` `() =>` `new` `nullptr` (per language) |
| after a name | `.` `(` `=` `;` `->` `::` (per language) |
| inside a string | `\` `${}` / `%d` (per language) and the closing quote |
| C++ statement start | `std::` `cout <<` `auto` `for` `if` `return` |
| C++ after `cout`/`cin` | `<<` / `>>` `endl` `"\n"` |
| HTML inside a tag | `=""` `/>` `class=""` `id=""` |
| CSS inside a block | `:` `;` `px` `%` `#` `!important` |
| Python | `:` `self.` `()` `[]` `def` `print()` |
| text selected | Cut · Copy · Paste · `//` · Indent · wrap in `( [ { " '` |

- `{}` inserts `{|}`; Enter or Tab then expands into an indented block
  (owner's example).
- **Stability rule:** context keys only change at word boundaries or after
  ~150 ms of no typing, and a key that is still offered keeps its slot — no
  reshuffling under the thumb.
- **Long-press** any key → Gboard-style popup of variants (`(` → `()` `[]` `{}`
  `<>`; `"` → `'` `` ` `` `"""`; `;` → `:` `::` `,`). **Swipe up / down** on a
  key types its 1st / 2nd alternate (shown small in the key's corners).
- **⋯ More** → a sheet with every key, grouped: Brackets · Operators ·
  Navigation · Editing · Selection · Lines · Modifiers. Long-press a key in the
  sheet → "Pin to bar".

### 2.6 Cursor and text handling (reported issue 2)

- **Joystick key:** press and drag in any direction → the cursor moves; the
  further the drag, the faster. Light haptic tick per step.
  - Tap → select word.
  - Long-press, then drag → selection mode (extends a selection).
  - Quick flick fully left or right → line start / end.
- **Whole-bar trackpad:** long-press any empty part of the bar and the whole bar
  becomes a trackpad (Gboard space-bar style).
- **In the code:** double-tap selects a word, triple-tap a line; long-press a
  line number and drag to move line(s).
- **Selection toolbar:** while text is selected, the context row shows the
  selection actions (2.5 table, last row).

### 2.7 Customizing the keys bar (Settings → Keys bar)

- Visual editor showing the real layout per profile (phone portrait, phone
  landscape, tablet). Drag keys from a catalog into slots; reorder; remove
  (removed keys stay in "More").
- Per-language symbol sets with presets (C++, C, Python, JS/TS, HTML, CSS,
  Java, Markdown); edit each key's long-press and swipe alternates.
- Edit context-row rules (advanced).
- Import / export as JSON; reset to defaults.

Done when (Phase 2): on the owner's phone in portrait, with Gboard open, the 10
most-used actions are reachable without moving the hands and without scrolling;
no key is narrower than 44 px; the modifier layer works with every combo
listed in 2.3; the customization survives a reload.

---

## Phase 3 — Look & feel (reported issue 5)

- **Colour:** VS Code blue accent; status bar coloured by state (blue normal,
  purple with no project, orange while code runs); coloured bracket pairs and
  indent guides; coloured git status in the file tree.
- **Themes:** Dark Modern, Light Modern, High Contrast, Monokai.
- **Icons:** VS Code's Codicons for the UI (CC-BY 4.0 — add the credit line) and
  Material-style file-type icons (MIT). Activity-bar icons 24 px in a 56 px bar
  on touch screens.
- **Long-press any icon → tooltip** (Android never shows hover titles).
- **Full screen:** a Fullscreen toggle and **Zen mode** (only the editor and the
  keys bar); the title bar auto-hides while scrolling. In the APK, also hide
  Android's status and navigation bars (immersive mode; small native plugin).
- Redesigned welcome screen; small, quick animations (respect "reduce motion").

---

## Phase 4 — Tabs and file explorer (reported issue 6)

**Tabs**
- Drag to reorder.
- Drag to the right or bottom edge → highlighted drop zones → split; drag into
  the other pane to move. A pane that becomes empty closes itself.
- On touch: long-press, then drag.
- Preview tabs as in VS Code: a single tap opens a temporary (italic) tab; editing
  or double-tapping keeps it.

**Explorer**
- Selection model: tapping a folder makes it the **target** — New File / New
  Folder create inside it; with a file selected, they create in that file's
  folder. (v2 bug: the header's New File always creates at the project root.)
- Create and rename inline in the tree (no dialogs).
- Drag and drop to move files into folders: long-press to pick up, folders open
  while hovering, the list auto-scrolls at the edges.
- Cut / copy / paste files; multi-select (long-press, then tap more).
- "Open Editors" list, a filter box, auto-reveal of the active file, compact
  single-child folders.
- Delete goes to a 7-day trash, so file operations can be undone.

---

## Phase 5 — Built-in runtimes (reported issue 7)

Rule from the owner: **install the app and press Run** — nothing external, no
manual setup.

### 5A Python (low risk)

- **Pyodide** (CPython compiled to WebAssembly) **shipped inside the APK**. In the
  web/PWA version it downloads automatically on the first `.py` run (progress
  bar, cached for offline use) — no manual steps.
- Runs in a worker: streamed output, Stop button and time limit (as for JS),
  clickable `File "main.py", line 3` errors.
- `input()`: interactive input from a worker needs `SharedArrayBuffer`, which
  requires the page to be "cross-origin isolated". GitHub Pages can't send those
  headers; the service worker can add them (`coi-serviceworker` approach).
  Fallback when unavailable: the stdin box (lines prepared before running).
- Measure: APK size added (expected order of 10–20 MB), cold start time.

### 5B C and C++ (spike first)

A fully offline C++ compiler inside an app is possible but large. Run a
**time-boxed spike (1–2 sessions)** before building anything, measured on the
owner's phone.

- **Approach A — clang + lld compiled to WebAssembly, shipped in the app.** The
  user's program is compiled to WebAssembly and run in a worker with a small
  system-call layer (WASI: stdout, stdin, exit code), with Stop and time limit.
  Same code path in the website and the APK; real clang error messages,
  clickable. Unknowns: size, compile speed and memory on a phone, how much of
  the C++ standard library works.
- **Approach B — native clang for Android inside the APK** (executables packaged
  as native libraries). Fastest compiles and real ARM programs, but a larger
  APK, a native build pipeline, APK-only, and Android's restriction on running
  files the app writes itself means targeting an older Android SDK level (fine
  for sideloading, not for the Play Store).

Spike measurements: APK size added; first and warm compile+run time of a
`#include <iostream>` hello world; peak memory; whether `<iostream>`,
`<string>`, `<vector>`, `<map>`, `<algorithm>`, `<cmath>` work; `cin` input.

Proposed go/no-go targets (owner to confirm): APK grows by ≤ 100 MB; warm
compile+run ≤ 5 s, first run ≤ 20 s; those six headers work. Try A first; if
it misses the targets, try B; if both miss, **stop and discuss with the owner**
(as agreed). Plain C comes with either approach.

---

## Phase 6 — VS Code extras (ranked by value for effort)

1. **Real JS/TS intelligence** with the TypeScript language service in a worker:
   smarter completions, types on hover, go to definition, rename, real errors.
2. Find and **replace** across the whole project (with preview).
3. CSS colour swatches and a colour picker.
4. Side-by-side diff view (git and local history).
5. Multiple cursors on touch.
6. Breadcrumb dropdowns (jump to sibling symbols / files).

---

## Not planned (and why)

- Minimap — unreadable on a 6" screen; outline + sticky scroll cover it.
- Third-party extensions — out of scope by the original spec.
- Online compile services / Termux as the main way to run C++ — the owner
  wants everything built in (see Phase 5B for the fallback rule).
