# CodeEditor — Roadmap after v2

This file is the plan for the next versions, written so that a work session
can start with: **"Read ROADMAP.md and implement Phase N."** Each phase is
self-contained: what is wrong, what was already found in the code, what to
build, and how we know it is done.

## Status

| Phase | Goal | Size | Status |
|---|---|---|---|
| 0 | Real-device test loop (diagnostics) | Small | Skipped for now: the owner's reports were enough to find every bug so far. Build it when a bug can't be reproduced |
| 1 | Typing correctness: gestures, autocomplete, Emmet, semicolons | Medium | **Done** — tested by the owner on the phone and tablet; the reported problems were fixed in PRs #2–#7 (see "After Phase 1") |
| 2 | Keys bar redesign, cursor & selection, Settings split | Large | **Part 1 built (v2.2.0, refined after the owner's tests in v2.3.0 and v2.4.0): the new keys bar** (2.2–2.6, 2.8, shortcuts of 2.9). Part 2 next: Settings pages (2.1), keys-bar editor (2.7), custom key bindings |
| 3 | Look & feel: VS Code blue, icons, tooltips, full screen, themes | Medium | Not started |
| 4 | Tabs drag & split, VS Code-like file explorer | Medium | Not started (dragging tabs and files to move them shipped early) |
| 5 | Built-in runtimes: Python, C, C++, **Rust** (owner: the app may pass 100 MB) | 5A small; 5B, 5C unknown until their spikes | Not started (packages checked, see Phase 5) |
| 6 | VS Code extras: JS/TS intelligence, project replace, … | Large | Not started |
| 7 | Git, more advanced: history, sync, hunks, merge, stash, … | Medium–large | Not started (owner's request; the owner may move it earlier) |

Order matters: 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7. Each phase ends with a tested build
pushed to the branch and this table updated.

---

## Decisions made with the owner (do not re-litigate)

| Topic | Decision |
|---|---|
| How the phone is held | **Two thumbs.** Most-used keys sit at the left and right ends of the bars; less-used keys in the middle. |
| Semicolons | `;` matters most in **C++** (also C, Java, C#, JS/TS). Automatic `;` is **on by default** for those languages. JS/TS files written without semicolons are detected and left alone. |
| Running code | **Built in only.** No Termux, no online compiler, no manual setup: install the app and press Run. **Python, C, C++ and Rust** (owner, Oct 2026), and **the app may grow past 100 MB** for them. If one still can't be bundled, stop and discuss with the owner before choosing anything external. |
| Keys bar | Tab is a first-class key, always visible. Ctrl, Shift, Alt and Esc are reachable whenever they are needed. The whole bar is **customizable from Settings**. Never delete a key from the app — re-rank it into the "More" sheet instead. |
| Settings | Split into small pages with a search box. |
| Accent colour | VS Code blue (`#0078D4`; `#3794FF` on dark backgrounds). |
| Arrow keys | Not on the keys bar (trackpad strip now, joystick in Phase 2). |
| Line actions | New line, move line up/down are the important ones; they go into **one line-actions key** with gestures (2.8). **Delete line = triple-tap on the line.** |
| Gestures **and** shortcuts | A phone or tablet is often used with a keyboard: every key-bar action and gesture also keeps a VS Code-style shortcut (2.9). Moving an action to a gesture never removes its shortcut. |
| Project name in the title bar | **Tap = switch project** (as today). **Long-press** (right-click with a mouse) = project actions, including Rename — a rename must never happen from a single tap (Phase 3). |
| Moving tabs and files | **Long-press, then drag** on touch; plain drag with a mouse. A quick swipe keeps scrolling the list. |

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
6. **Every PR bumps the version** (`npm version <x.y.z> --no-git-tag-version`;
   minor for features, patch for fixes only) and its description says which
   version it is. The owner checks Settings → About ("CodeEditor 2.1.0, built
   …") to know whether the merged change has reached the phone.

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
recognizer, 74 table-driven semicolon cases plus scope/Enter/plan tables,
Emmet and tag-suggestion rules. E2E (desktop, Pixel 7
and Galaxy Tab emulation): `tests/e2e/typing.spec.mjs`, new cases in
`gestures.spec.mjs` and `keysbar.spec.mjs`.

| Item | Shipped | Where |
|---|---|---|
| 1.1 | Angle from the fitted finger path (≤ 35° Normal), direction lock after 8 px, horizontal touches claimed (`preventDefault`) when the code can't scroll sideways, selection + scroll restored before every gesture action, long-press (≥ 400 ms rest) never a swipe, Strict / Normal / Loose presets, **test pad** in Settings that prints why a touch was or wasn't a swipe | `core/gestures.js`, `editor/gestureLayer.js`, `ui/settingsPanel.js` |
| 1.2 | Keys-bar text goes through every `EditorView.inputHandler` (auto-close, `>` closes tags, `;` steps over); suggestions forced open ~110 ms after an IME composition edit if CodeMirror didn't open them; words from all open files | `editor/editActions.js` `typeText`, `editor/completions.js` |
| 1.3 | Tag suggestions while typing HTML text (`di` → div, dialog… → `<div>|</div>`), not in attributes/comments/script/style/capitalised words; in a sentence from 2 letters and Enter keeps meaning "new line"; Emmet (lazy-loaded chunk) for abbreviations (`!`, `ul>li*3`) and CSS; linked tag rename, also through an empty name `<>`; path suggestions in `src`/`href`, `url()`, `@import`, `import`/`require`/`fetch`, `#include "…"`, Markdown links | `core/emmetRules.js`, `editor/emmet.js`, `editor/linkedTags.js`, `editor/completions.js` |
| 1.4 | Automatic `;` for obvious statements only (simplified at the owner's request, see below); Complete statement on the keys bar (`⏎;`), Ctrl+Shift+Enter and the gesture map; setting Settings → Typing | `core/semicolons.js`, `editor/semicolons.js` |
| 1.5 | Keys use `touch-action: pan-x` (only the trackpad strip keeps `none`) | `src/styles.css` |

Decisions taken while building (differences from the plan above):
- **Semicolons simplified (owner's review):** performance and predictability
  over coverage. The line is only looked at when a trigger character is typed
  (space, `=`, `(`, `<`, `>`, `+`, `-`), only statements that start the line
  count (`int x =`, `x +=`, `return `, `foo(`, `obj.run(`, `.then(`,
  `cout <<`, `i++`), and only if a regex on that line matches is the code
  above read (≤ 4 000 chars) to check it's a function body (calls, `return`)
  or a class body (fields with `=`). The `;` is added once and **never
  re-checked**. It is a tab stop: Tab / swipe right / keys-bar Tab jump past
  it, `;` steps over it, Enter steps over it unless the line ends with
  something that continues. Multi-line statements, globals without `=`,
  single-line `if (x) foo()` etc. are left to the user (or ⏎;).
- The syntax tree is not used for that check: a statement still being typed
  (`foo` in `int main() { foo }`) parses as a brace initializer in C++.
- `break` / `continue` / `return` alone + Enter add their `;`.
- **Chains:** if the next line starts with `.`, `?.`, `->`, `<<`, `>>`, `&&`,
  `||`, `??`, `?` or `:`, the `;` Enter just added on the line above is taken
  back (method chains, `cout` continuation lines).
- **Tab accepts a suggestion** (keyboard and keys bar), which is how Emmet
  and tag names expand, like VS Code.
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

**On-phone checks** (not confirmed one by one: the owner tested broadly and
reported the problems fixed in "After Phase 1"; re-check any that misbehave):
- [ ] 20 swipes right at 0–30° all autocomplete; the cursor never jumps.
- [ ] Vertical scrolls and slow drags never trigger commands.
- [ ] Typing `doc` with Gboard shows suggestions within ~150 ms.
- [ ] Tab / swipe right / Enter jump past the faded `;` with Gboard (and
      Backspace right after it appears removes it).
- [ ] In HTML, typing `di` shows `div`; Tab or swipe right makes `<div></div>`.
- [ ] The first keys row scrolls when dragged starting on a key.

### After Phase 1 — fixes from the owner's first test on the phone

| Report | What was wrong | Fix |
|---|---|---|
| Words get a capital first letter while coding | On Android, CodeMirror typed through Chrome's EditContext API, which apparently doesn't pass `autocapitalize="off"` to the keyboard | Classic (contenteditable) input is the default; Settings → Typing → "Android: EditContext keyboard input" switches back (reloads) |
| Keys bar stays after the keyboard closes (Chrome) | The "keyboard open" test compared against the tallest height seen *per orientation*, so a shorter window (split-screen, resized window) or a pinch-zoomed page looked like an open keyboard | Baseline per window width; page zoom undone; listens to window and visual-viewport resizes |
| Split pane stays after closing all its tabs (portrait); no button | Closing tabs never closed the split; the split button is hidden on narrow screens; the first tap on a ✕ in the unfocused pane did nothing (the tab bar was rebuilt under the finger) | Split closes when a pane is empty; "✕ Split" button in the second pane's tab bar; tab bars rebuild only when they change |
| Code size vs. app size | Only the code had a size setting (and pinch) | Settings → Appearance → Interface size (70–160 %) for menus, tabs, panels and the keys bar |
| Arrow keys not needed; new line / move line important; multi-line editing | — | Bar re-ranked (see Phase 2 notes); multi-cursor keys and Ctrl+D / Ctrl+Alt+↑↓ / Shift+Alt+I |
| Long-press should type the corner symbol; swipe-up only worked when very straight | Holding did nothing; any sideways drift > 14 px cancelled the swipe | Hold or swipe up; leaning / curved swipes count (2.5) |
| Hold had no feedback | Only the key's colour changed | Preview bubble above the key, key turns blue and grows, strong vibration |
| Sel+ duplicates other keys | — | Removed from the bar (Ctrl+D stays) |
| Triple-tap selects the line instead of deleting it | Not built yet (was planned for Phase 2) | Triple-tap deletes the tapped line (remappable gesture) |
| Console/Preview/Problems bar: tiny resize handle; ✕ off-screen in portrait; what is "stdin"? | 12 px handle; the actions row could not shrink | The whole bar drags to resize (drag to the bottom closes it); tabs scroll, actions never; on phones the rarer actions are in ⋯; "stdin" is now "Program input" with an explanation |
| Status bar: Wrap / Lock cut off | One scrolling line, too many items for a phone | Items that don't fit move into a ⋯ menu (least needed first); Wrap is icon-only on phones |
| Autocomplete: `p`, `h1`–`h3`, `lorem20` | `lorem` was not offered at all; a keyboard's capital ("P", "H1") hid tag suggestions | `lorem`, `loremN` (N **words**, as in Emmet/VS Code) anywhere in text; capitals accepted where a tag starts; h1–h6 grouped; duplicate snippet entries removed |
| Two resize handles on the Console/Preview bar | The old 12 px handle stayed above the new draggable bar | Old handle removed; the bar is the only handle |
| Buttons stay highlighted after a long-press | Browsers keep `:hover` on the last tapped element until you tap elsewhere | Hover highlights only while a mouse or pen is in use (a tablet with a mouse still gets them) |
| Drag tabs, files and folders to move them | Not built (planned for Phase 4) | Shipped early: long-press then drag (mouse: drag). Tabs reorder and move to the other pane; files and folders move into a folder or to the project root (empty space below the list); lists auto-scroll at the edges; a folder never goes into itself |
| Console: `SyntaxError: unterminated regular expression literal (about:srcdoc:64)` between two normal runs | The preview refreshed 650 ms after typing stopped, so a half-typed `//` (or `</`) ran and failed; the location was a line of the generated preview page | Auto-refresh waits while the file being typed has a syntax error ("Paused: syntax error at app.js:3" in the preview bar; ⟳ still forces it); errors name the file and line (`app.js:3`, tappable), mapped from the generated page; Firefox errors keep their message |
| Which version am I using? A merge seemed to take a long time to arrive | The version was always "2.0.0". The offline cache downloaded a new build in the background but only started it after every tab of the app was closed (a reload is not enough) | Version per PR (2.1.0 onwards) with its build time in Settings → About; "Check for updates" there; when a new build is downloaded: "Version x.y.z is ready" with a **Reload** button (unsaved work is restored after it) |
| Joystick: precise cursor control is difficult (v2.2.0) | A fixed 11 px a character, both directions at once (a slightly diagonal finger changed lines) and the cursor started moving by itself 56 px out | Mouse-like acceleration (slow ≈ 18 px a character, fast ≈ 5 px), one direction at a time (changes only after a clear 36 px turn), moving by itself only after resting 0.3 s beyond 72 px |
| Arithmetic keys missing | `+ - * /` were deep in the symbol list (context row or "More") | An operator key on the main row of code files: tap `+`, swipe up `-`, down `*`, hold → `/ % = < > ! & \| ^` (the popup wraps onto two rows) |
| Too many keys, duplicates | Context keys repeated main-row keys (`;`, `()`), the tablet had a Redo key next to Undo's hold, the Mod layer repeated ⇧Tab and ⏎;, the cursor popup had Esc | Context keys skip what the main row has; no Redo key; Mod layer has Home / End instead; no Esc in the cursor popup; no "TODO:" key in comments |
| Some keys not intuitive (multi-cursor) | Labels like `+⇣`, `Mod`, `⋯` | Icons and captions: *cursor* (two text cursors and a +), *line*, *undo*, *all keys*, Mod with "Ctrl ⇧ Alt"; joystick shows its four arrows; context keys look lighter than fixed keys |
| Swipe up did nothing on Tab and Undo | Their corner symbol (⇤, ↷) only worked by holding | Swipe up does it too (the corner symbol always means swipe up or hold) |
| Joystick: aiming for the end of a line goes on to the next line (v2.3.0) | Moving right from a line's end is moving to the next line's start, so any overshoot wrapped | The line's end (and start) is a wall: the cursor stops there, the knob turns amber and the phone bumps. Pushing on for about half a second (and a couple more characters' worth) goes through. Considered instead: never wrapping (then "next line" needs two moves) and a fixed pause (an overshoot in that time still wrapped) |
| No division and no power on the operator key (v2.3.0) | `/` was only in the hold popup; the `^` there is XOR, not power (in C, C++, Java, JS and Python alike) | Symbol keys swipe four ways; the hint sits on the side you swipe toward. Operator key: tap `+`, ↑ `-`, ↓ `*`, ← `/`, → `**` (power in JS and Python; Python's hold popup also has `//`). C-like languages have no power operator, so → is `%` there and `pow()` is a context key after `=`. Bonus: `(` swiped left types `{}` |
| Highlight the variable under the cursor, as in VS Code (request) | — | With the cursor on a name, its other uses on screen get a light background. It reads the syntax tree, so the word in strings and comments and keywords are not lit; plain text compares whole words. Nothing is lit while typing (a half-typed name would flicker), it comes back 0.35 s after. Settings → Editor → "Highlight the name under the cursor". Not semantic yet: `obj.total` and a variable `total` both count — telling them apart needs a language server (Phase 5 territory) |
| Bracket keys put the cursor after the pair: `{}\|` instead of `{\|}` (v2.4.0) | The keys bar's pair variants (`[]` `{}` `${}` `<>`) were typed as plain text. Found while fixing it: context keys like `if (\|)` and `class="\|"` inserted their closer behind auto-close's back, so typing `)` or `"` afterwards doubled it (`if (a))`, `class="a""`) | Pairs from the keys bar go through auto-close like the keyboard: the cursor lands inside, and typing the closer steps over it (also nested: `printf("\|")`). With auto-close off, or before a letter, the closer is added anyway. Python's `"""` key makes `"""\|"""`. Also: the name highlight no longer changes the page while the keyboard is still composing a word (Android), a known way to make keyboards lose the cursor |

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

> **Superseded in part.** After review the owner asked for a smaller, cheaper
> version (obvious statements only, `;` as a tab stop). What shipped is in
> "Phase 1 — result" above; the full rule set below is kept for reference.

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

**Owner feedback after testing Phase 1 (decisions for this phase):**
- The four arrow keys are **not wanted** on the bar (removed already; the
  trackpad strip / joystick moves the cursor).
- Must stay close at hand: **new line below**, **move line up / down**, Tab,
  Complete statement — combined into one line-actions key (2.8). **Delete
  line** becomes the **triple-tap** gesture (2.6); the key stays in "More" and
  Ctrl+Shift+K stays.
- **Multi-line editing** is needed. Shipped early as keys (`+⇣` / `+⇡` add a
  cursor below/above, `⫶` a cursor on each selected line, `Sel+` next
  occurrence); Phase 2 places them in the selection layer / context row.

### Part 1 — result (v2.2.0)

Built: `ui/keysBar.js` (rewritten), `core/keysLayout.js` (variants, slots,
profiles, the key catalog), `core/contextKeys.js` (context rules),
`editor/keysContext.js` (what is at the cursor, from the syntax tree).
Tests: `tests/unit/contextKeys.test.mjs`, `tests/e2e/keysbar.spec.mjs`.

| Item | Shipped | Differences from the plan |
|---|---|---|
| 2.2 phone portrait | Context row `[Mod][ctx×4][+⇣][⋯]`, main row `[Tab][◉][s1][s2][s3][↵][↶]`; 7 keys a row, ≥ 44 px, no scrolling; Tab hold = Shift+Tab; Undo hold = Redo | The line key (2.8) and the cursors key are on the bars, so the phone has 4 context keys, not 6. Landscape: one row `Tab ◉ Mod ctx×4 s1–s3 ↵ +⇣ ↶ ⋯` |
| 2.3 modifiers | Mod layer `[Ctrl][Shift][Alt][Esc][⇧Tab][⏎;]`; Ctrl shows its shortcuts (S F D A / G P X C V Z Y); Shift: joystick selects, symbols type their variant; Alt: joystick moves lines / jumps word parts; one-shot, double tap locks; **Esc** appears in the first context slot when something can be escaped | — |
| 2.4 tablet | One row, `[Esc][Tab][◉][Ctrl][Shift][Alt]` left, `ctx×6 s1–s6 ↵ +⇣ ↶ ↷ ⋯` right | The floating, resizable dock is not built (later) |
| 2.5 context row, variants, More | Rules per language and situation (table above, plus JS / Markdown / JSON); stability: change at a word boundary or after 150 ms of no typing, a key that stays keeps its slot; tokens `(^)^[]^{}` = tap, swipe up, swipe down, hold → all variants (slide and release); "More" sheet with every key, grouped | "Pin to bar" from the sheet comes with the keys-bar editor (2.7) |
| 2.6 cursor | Joystick: drag = the cursor follows (11 px a character, 20 px a line), beyond 56 px it keeps moving (4–40 a second), tap = select word, hold then drag = select, flick ≥ 56 px in < 250 ms = line start / end | The whole-bar trackpad is not built: the joystick covers it and every part of the bar is a key now |
| 2.8 line-actions key | `↵`: tap new line below; swipe up / down move the line (repeats while held); hold → strong vibration, the key lights up, choices pop up: `⏎;` `↥` Dup Join `✕Ln` `//` — slide and release; releasing without sliding does nothing | The same pattern for cursors: `+⇣` (swipe up `+⇡`; hold: `⫶` `Sel+` `Sel*` Esc) |
| 2.9 shortcuts | Every key's tooltip shows its shortcut; new line above = **Ctrl+Alt+Enter**; new commands in the palette: copy line up, join lines, select all occurrences, select line, page up/down, matching bracket, cut/copy/paste | Custom key bindings: part 2 |

Found while building: after a tap that changes the bar (the sheet closes, a
layer opens) the browser's follow-up click landed on whatever was under the
finger by then (e.g. the status bar's line number, which opened "go to
line"). Keys now cancel that click. Old default symbol layouts saved in
settings are upgraded to the new defaults (edited ones are kept).

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
- **Owner report (after Phase 1, on the phone):** the owner expected
  long-press to type the small corner symbol; only swipe-up did, and only if
  the swipe was very straight (any sideways drift cancelled it).
  **Shipped early:** hold (≥ 380 ms) **or** swipe up types the corner symbol;
  a swipe counts up to ~63° from straight up and may curve — once it is going
  up, the key keeps the touch and the row doesn't scroll
  (`classifyKeyDrag` in `core/keysLayout.js`). Phase 2 still adds the
  multi-variant popup for keys with more than one alternate.
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
- **In the code:** double-tap selects a word; **triple-tap on a line deletes
  that line** (owner's decision; **shipped early**, remappable in Settings →
  Touch & gestures) — with a hint "Line deleted · Undo" and a normal undo
  step. Care needed: the browser already selects a word on the
  2nd tap, so the 3rd tap (same line, within ~500 ms and ~24 px) must collapse
  that selection first; it must never fire while the keyboard's own
  selection handles are being dragged. Selecting a line stays on the line
  numbers (tap / drag) and ⊕. Long-press a line number and drag to move
  line(s). Shortcut stays: Ctrl+Shift+K.
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

### 2.8 One line-actions key (owner's proposal)

New line below, new line above, move line up / down, duplicate, join lines
and delete line in **one key**, instead of five keys next to each other:

- **Tap** → new line below (the most used).
- **Swipe up / down on the key** → move the line up / down; keep the finger
  there to repeat.
- **Open the fan: long-press** (owner's decision — a double-tap would delay
  every single tap by ~250 ms). The other actions fan out around the key and
  the finger **slides to one and releases** to choose (a "marking menu": with
  practice the direction alone is enough). The moment the fan opens must be
  **felt and seen**: strong vibration, the key changes colour, the fan
  animates in — same style as the symbol-key hold.
- The same pattern then groups other related keys: cursors (`+⇣` `+⇡` `⫶`
  `Sel+`), selection (`⊕` `⊖` Select all), indentation / comment.

### 2.9 Gestures and keyboard shortcuts together

A phone or tablet is often used with a Bluetooth or USB keyboard, so:

- **Every keys-bar action and every gesture also has a keyboard shortcut**
  (VS Code's where one exists), shown in its tooltip, in the command palette
  and in the shortcuts sheet (F1). Moving an action from a key to a gesture
  never removes its shortcut.
- With a hardware keyboard and no on-screen keyboard, the keys bar stays
  hidden ("Auto" mode) — the shortcuts are the way in.
- Custom key bindings in Settings → Keyboard (VS Code style), Phase 2.7.

| Action | Shortcut now | Note |
|---|---|---|
| Move line up / down | Alt+↑ / Alt+↓ | VS Code |
| Copy line up / down | Shift+Alt+↑ / ↓ | VS Code |
| Delete line | Ctrl+Shift+K | VS Code; gesture: triple-tap |
| Add cursor above / below | Ctrl+Alt+↑ / ↓ | VS Code |
| Select next occurrence | Ctrl+D | VS Code |
| Cursor on each selected line | Shift+Alt+I | VS Code |
| Complete statement | Ctrl+Shift+Enter | as JetBrains |
| Expand / shrink selection | Shift+Alt+→ / ← | VS Code |
| Toggle comment, indent | Ctrl+/, Ctrl+] / Ctrl+[ | VS Code |
| New line below | **Ctrl+Enter** | VS Code (owner's decision; done) |
| Run file / preview | **F5** | as VS Code (owner's decision; done — Ctrl+Enter used to run) |
| New line above | **none yet** | VS Code uses Ctrl+Shift+Enter, which is Complete statement here — proposal: Ctrl+Alt+Enter |

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
- **Interaction states (owner's request):** one consistent look and feel for
  *pressed*, *held / long-press armed*, *active / toggled on*, *disabled* and
  *busy*, across keys, buttons, tabs, list rows and menus — colour (from the
  theme tokens), a short scale/press animation, and a matching vibration
  strength (tap light, hold-activated strong). Today each control does its own
  thing; the symbol-key hold (blue key + preview bubble + strong vibration,
  shipped after Phase 1) is the reference for "armed".
- **No text selection on UI chrome (owner's request):** status bar, title bar
  (project name), tab bar, panel heads, keys bar, side-panel headers and
  menus get `user-select: none` so a long-press doesn't start selecting their
  text; the code, the console output, inputs and dialogs' messages stay
  selectable.
- **Project name → project actions (owner's request):** **long-pressing** the
  project name in the title bar (right-click with a mouse) opens: **Rename
  project** (missing today — there is no way to rename one), Switch project,
  New project, Import, Export as .zip, Project settings. A single tap keeps
  doing what it does today (switch project), so a rename never starts by
  accident (owner's correction). Rename must also rename the stored project
  record and, for a device folder, offer to rename the folder. Give the
  long-press the "armed" feedback above.

---

## Phase 4 — Tabs and file explorer (reported issue 6)

**Tabs**
- ~~Drag to reorder.~~ Shipped early.
- Drag to the right or bottom edge → highlighted drop zones → split. ~~Drag into
  the other pane to move. A pane that becomes empty closes itself.~~ Shipped early.
- ~~On touch: long-press, then drag.~~ Shipped early (the long-press menu opens
  first; moving the finger closes it and picks the tab up).
- Preview tabs as in VS Code: a single tap opens a temporary (italic) tab; editing
  or double-tapping keeps it.

**Explorer**
- Selection model: tapping a folder makes it the **target** — New File / New
  Folder create inside it; with a file selected, they create in that file's
  folder. (v2 bug: the header's New File always creates at the project root.)
- Create and rename inline in the tree (no dialogs).
- ~~Drag and drop to move files into folders: long-press to pick up, the list
  auto-scrolls at the edges.~~ Shipped early. Still to do: **folders open while
  hovering** over them — the tree must then update without replacing the rows
  (replacing the row under the finger ends the touch), and an Undo on the
  "Moved …" message.
- Cut / copy / paste files; multi-select (long-press, then tap more).
- "Open Editors" list, a filter box, auto-reveal of the active file, compact
  single-child folders.
- Delete goes to a 7-day trash, so file operations can be undone.

---

## Phase 5 — Built-in runtimes: Python, C, C++, Rust (reported issue 7)

Rule from the owner: **install the app and press Run** — nothing external, no
manual setup. **Owner decision (Oct 2026): Python, C, C++ and Rust, and the
app may grow past 100 MB for them.** The owner may move this phase earlier.

**Checked from the build machine (Oct 2026):**
- npm is reachable, so `npm install` brings the toolchains — nobody has to
  download or upload them by hand:
  - **Pyodide** (`pyodide`, CPython for WebAssembly): 14 MB core and
    standard library; more packages on demand.
  - **LLVM / Clang / LLD for WebAssembly** (`@yowasp/clang`): about 105 MB
    unpacked; compiles C and C++ to WebAssembly.
  - A WASI shim to run the compiled programs in a worker
    (`@bjorn3/browser_wasi_shim`, 115 KB): stdout, stdin, exit code.
- GitHub release downloads are blocked from the build machine (HTTP 403),
  and Rust has no maintained npm package of a compiler that runs in a
  browser (5C).

**How the big files reach the phone:**
- **APK:** bundled in the app: works offline from the first start.
- **Website (GitHub Pages):** each toolchain downloads the first time a file
  of that language is run (with a progress bar), then stays in the browser's
  storage for offline use. It is not in the offline precache, so opening the
  editor stays fast.
- **GitHub's limits:** one file in a repository must be < 100 MB (bigger
  ones are split into parts and joined when loaded); a Pages site ≤ 1 GB;
  and every update of a 100 MB file committed to `docs/` stays in the git
  history forever. So toolchains do **not** go into git: the site is built
  and deployed by a **GitHub Actions** workflow (`npm ci`, build, deploy);
  the owner switches Pages' source to "GitHub Actions" once.
- The owner's offer to upload files by hand is only needed if a toolchain
  exists nowhere but in GitHub releases — possibly Rust (5C).

### 5A Python (low risk)

- **Pyodide** in a worker: streamed output, Stop button and time limit (as
  for JS), clickable `File "main.py", line 3` errors.
- `input()`: interactive input from a worker needs `SharedArrayBuffer`, which
  requires the page to be "cross-origin isolated". GitHub Pages can't send those
  headers; the service worker can add them (`coi-serviceworker` approach).
  Fallback when unavailable: the Program input box (lines prepared before running).
- Measure: download / APK size added, cold start time on the owner's phone.

### 5B C and C++ (spike first)

- **Main candidate: clang + lld compiled to WebAssembly** (`@yowasp/clang`).
  The program is compiled to WebAssembly (wasm32-wasi) and runs in a worker
  with the WASI shim: `cout` / `printf`, `cin`, exit code, Stop and time
  limit, real clang error messages made clickable. Same code path in the
  website and the APK.
- Fallback: **native clang for Android inside the APK** (executables packaged
  as native libraries): faster, real ARM programs, but APK-only, a native
  build pipeline, and Android's rule against running files the app writes
  itself means an older target SDK (fine for sideloading, not for the Play
  Store).
- Spike measurements on the owner's phone: size added (download and
  installed); first and warm compile+run time of a `#include <iostream>`
  hello world; peak memory; whether `<iostream>`, `<string>`, `<vector>`,
  `<map>`, `<algorithm>`, `<cmath>` work; `cin`.
- Go / no-go (owner to confirm): warm compile+run ≤ 5 s, first ≤ 20 s; those
  headers work. Plain C comes with it.

### 5C Rust (spike first; the hardest)

- `rustc` is large (well over 100 MB as WebAssembly in the experimental
  builds that exist) and needs Rust's standard library built for wasm32-wasi.
- Options to measure, in this order: (A) an experimental rustc compiled to
  WASI, running in a worker like 5B (community builds exist; find a source
  the build can fetch, else the owner uploads it in < 100 MB parts or CI
  builds it); (B) a native Rust toolchain inside the APK (APK-only, large,
  older target SDK, as in 5B's fallback).
- Go / no-go (owner to confirm): warm compile+run of hello world ≤ 15 s on
  the phone, ≤ 300 MB added. If both options miss, **stop and discuss with
  the owner**.

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

## Phase 7 — Git, more advanced (owner's request)

**Today (v2):** init, status, diff, stage / unstage / discard per file, commit,
create and switch branches, log, push / pull / fetch over https with a saved
token, clone. The web version needs a CORS proxy (a setting) for the network
operations.

**To build — ranked by value for effort.** isomorphic-git (already bundled)
covers everything in this list except where noted.

1. **Sync at a glance:** ahead / behind counts in the status bar; one **Sync**
   action (pull, then push); **Commit & push** in one step.
2. **History view:** commits as a list with branch lines; tap a commit → its
   changed files and diffs; check it out, or start a branch from it.
3. **Amend** the last commit; **undo last commit** (its changes go back to
   staged).
4. **Single changes (hunks):** stage / unstage / discard one change from the
   diff view, and from the gutter markers (tap a marker → see the old lines →
   revert or stage just that change).
5. **Branches:** delete, rename, **merge into the current branch**, list remote
   branches, set the upstream.
6. **Merge conflicts:** conflict blocks highlighted in the editor with
   VS Code-style *Accept current / Accept incoming / Accept both* buttons;
   abort the merge.
7. **Stash:** save, list, apply, pop, drop.
8. **Tags:** create (light or annotated), push, delete.
9. **From the file tree:** coloured git status (with Phase 3), *Add to
   .gitignore*, *Show history of this file*.
10. **APK:** use Android's native HTTP for push / pull, so the app needs no CORS
    proxy (the web version still does).

**Harder — measure first** (not in isomorphic-git, needs our own code):
blame (who changed each line: walks the file's history, slow on long
histories, so limited depth); revert a commit and cherry-pick (a three-way
merge of that commit's changes).

**Not planned:** rebase (complex and easy to lose work with on a phone); SSH
remotes (a browser can't open SSH connections; https + token works).

**Done when:** each feature has an e2e test against the local git server used
by the existing tests (`tests/e2e/gitHttpServer.mjs`), and a merge conflict can
be resolved on the phone without a keyboard.

---

## Not planned (and why)

- Minimap — unreadable on a 6" screen; outline + sticky scroll cover it.
- Third-party extensions — out of scope by the original spec.
- Online compile services / Termux as the main way to run C++ — the owner
  wants everything built in (see Phase 5B for the fallback rule).
