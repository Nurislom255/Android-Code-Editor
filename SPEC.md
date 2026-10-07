# CodeEditor Android — Project Specification & Build Plan (v2)

**Status:** Personal learning project, sideloaded APK, possible future public release
**Core philosophy:** Offline-first. No plugin marketplace. Built-in features only, chosen by you as the developer.
**v2 focus:** Fix the architectural gaps in v1, and make the editor genuinely comfortable to code in on a phone and on a tablet.

---

## 0. What Changed From v1, and Why

| Change | Reason |
|---|---|
| Storage moved behind a `ProjectFs` interface; SAF vs all-files access is now an explicit decision (§4.2) | libgit2, JGit and Termux all need real filesystem paths. SAF only gives `content://` URIs. v1's "SAF only + libgit2" combination doesn't work as written. |
| Keyboard input (`InputConnection`) is now an explicit part of Milestone 2 | It's the hardest part of a custom editor view on Android, and v1 didn't mention it. |
| Soft wrap designed in from Milestone 2 | Phones are narrow. A renderer built on "1 text line = 1 screen row" has to be largely rewritten to add wrapping later. |
| Touch essentials moved into Phase 1 (symbol toolbar, auto-close pairs, auto-indent, line operations) | Without them you can't comfortably test your own editor on a phone, which slows every later milestone. |
| Unsaved-buffer recovery added | Android kills background apps routinely. Without recovery, process death loses unsaved code. |
| JS execution: Jetpack JavaScriptEngine replaces Rhino as first choice | Modern JS support, separate process (a runaway loop can be stopped), no native build. |
| Live preview: `WebViewAssetLoader` with a custom path handler | A WebView can't resolve relative links (`style.css`, `app.js`) between `content://` files. |
| Git: libgit2's TLS/SSH dependencies stated; JGit listed as a real alternative | v1 implied libgit2 avoids OpenSSL-type dependencies. For HTTPS/SSH remotes, it doesn't. |
| New mobile/tablet feature set (§2, §3) | Main goal of this revision. |
| Testing strategy added (§8) | v1 had none; buffer/undo logic is exactly the kind of code that breaks silently. |

### 0.1 Decisions (locked)
| Decision | Choice | Why |
|---|---|---|
| Distribution | Sideload only, personal use | |
| Storage | Option B: all-files access; `PathProjectFs` first, `SafProjectFs` later only for files opened from other apps | Real paths make git, Termux and fast listing simple |
| Native code | Decided per feature (below) | |
| Syntax engine | tree-sitter via NDK, the only native component | No pure-Kotlin equivalent; small C library; C/C++ practice |
| Git | JGit (check which version runs on Android first) | libgit2 would add three cross-compiled C libraries on top of tree-sitter; JGit works directly on real paths |
| JS execution | Jetpack JavaScriptEngine | No native build |
| Python | Chaquopy | Gradle plugin; no native build on your side |
| Starting point | Kotlin is new → Milestone 0 added | Learning Kotlin, Android and a custom editor view at once is too many unknowns |

---

## 1. Vision — What This App Actually Is

Not a VS Code clone. It's a **lightweight, offline-capable code editor for Android** that covers:

- Comfortable code editing on a touchscreen, and on a tablet with a keyboard and mouse
- Syntax highlighting, and later syntax-*aware* editing, for the languages you actually use
- Git version control without a desktop
- Running/testing interpreted scripts (JS, later Python) directly on-device
- Live preview of HTML/CSS/JS and Markdown
- A codebase you understand fully, because you built every layer of it

Anything resembling VS Code's *extension ecosystem* is out of scope. Configurable data (snippets, toolbar layout, themes) is fine: that's user settings, not third-party code.

---

## 2. Feature List (grouped by build phase)

Tags: **NEW** = added in v2 · **MOVED** = moved from a later phase · **CHANGED** = approach changed

### Phase 1 — MVP (editing only, usable on a phone)
| Feature | Description |
|---|---|
| Project open + file tree | Open a folder through the storage layer (§4.2). Tree loads children lazily on expand; hides `.git`, `node_modules`, `build` by default. **CHANGED** |
| Custom editor view | Canvas-drawn: line numbers, monospace, cursor, scrolling with fling |
| Soft wrap | Toggle per file; wrapped rows indent to match the original line's indentation. **NEW** |
| Keyboard (IME) integration | `InputConnection` handling composing text, deletes and key events; suggestions and personalized learning off (§3.1). **NEW** |
| Symbol toolbar | Row above the keyboard: Tab, `{}` `()` `[]` `;` `=` `"` etc., arrow keys with key-repeat on long press. Layout differs per language. **MOVED** from Phase 2 |
| Auto-close pairs + auto-indent | Typing `(` inserts `()`; Enter keeps indentation and adds a level after `{`. **NEW** |
| Line operations | One tap: duplicate, move up/down, delete line, toggle comment, indent/outdent. **NEW** |
| Basic syntax highlighting | Regex/token-based for JS/HTML/CSS, computed for visible lines only |
| Find & replace (in-file) | Plain/regex, match case, whole word; match count; replace all |
| Undo/redo | With coalescing: a typed word is one undo step, not one per keystroke |
| Save / autosave | Explicit save + autosave on pause; preserves the file's encoding and line endings (CRLF/LF). **NEW** |
| Unsaved-buffer recovery | Dirty buffers mirrored to app-private storage; restored after process death or crash (§3.4). **NEW** |
| Hardware keyboard shortcuts | Ctrl+S/Z/Y/F, Ctrl+/, Alt+↑/↓, Ctrl+Tab, etc. Cheap: key events already reach your view. **NEW** |
| Read-only lock + pinch-to-zoom | Lock prevents accidental edits while reading; pinch changes font size. **NEW** |
| Basic settings | Font size, theme (system/light/dark), tab width/spaces, wrap default, toolbar layout |

### Phase 2 — Real editor behavior
| Feature | Description |
|---|---|
| tree-sitter highlighting | Replaces regex; incremental re-parse on each edit |
| Bracket matching & code folding | From the syntax tree |
| Syntax error markers | tree-sitter marks unparseable regions (`ERROR`/`MISSING` nodes); underline them. Real syntax-error detection with no LSP. **NEW** |
| Expand / shrink selection | Each tap grows the selection to the next enclosing node: word → expression → statement → block → function. Best fix for imprecise finger selection. **NEW** |
| Outline, breadcrumbs, sticky scroll | List of functions/classes; current scope path at the top; enclosing function header pinned while scrolling. **NEW** |
| Quick open + go to line + recent files | Fuzzy file finder (Ctrl+P equivalent); back/forward navigation history. **NEW** |
| Project-wide search | Plain/regex across the folder; respects `.gitignore` and the default ignore list; tap a result to jump |
| Snippets | Built-in per language + user snippets from a JSON file in settings; tab stops (`for` → loop with cursor placeholders). Data, not plugins. **NEW** |
| Toolbar customization | Rearrange / add symbols on the toolbar |
| Multiple language grammars | C, C++, Python, Java, Kotlin, JSON, Markdown as needed |
| Git panel | Status, diff, stage, commit, push/pull, branch switch |
| Git gutter markers | Added/modified/deleted markers next to line numbers. **NEW** |
| Local history | Snapshot on each save, kept N days, independent of git. **NEW** |
| External change detection | On resume, detect files changed by other apps (git, Termux) and reload or warn. **NEW** |
| EditorConfig | Read `.editorconfig` for indent style/size, final newline, line endings. **NEW** |
| Tablet layout + split editor | Adaptive layout by window width; two editors side by side (§3.5). **NEW** |
| Mouse/trackpad support | I-beam pointer, click-drag select, right-click menu, scroll wheel. **NEW** |

### Phase 3 — Execution
| Feature | Description |
|---|---|
| Run JS files/snippets | Jetpack JavaScriptEngine, console output pane. **CHANGED** from Rhino (§4.5) |
| Stop button + time limit | Every run is interruptible; runaway loops never freeze the editor. **NEW** |
| stdin in console | Scripts can read input (`input()` in Python, a `prompt`-style shim in JS). **NEW** |
| Clickable errors | Tap `file:line` in a stack trace to jump there. **NEW** |
| Live HTML/CSS/JS preview | `WebView` + `WebViewAssetLoader`; the page's `console.log` goes to the console pane; side by side on tablets. **CHANGED** |
| Markdown preview | Same WebView setup. **NEW** |
| Format document | Bundled Prettier (standalone build) running in the JS engine: JS/TS/CSS/HTML/JSON/Markdown, offline. **NEW** |
| Run Python scripts | Chaquopy, in a separate process (§4.6) |

### Before a public release
| Feature | Description |
|---|---|
| Accessibility | A custom `View` is invisible to TalkBack until you expose it (`ExploreByTouchHelper` / `AccessibilityNodeProvider`). Respect system font scale. **NEW** |
| APK splits / App Bundle | Per-ABI native libraries (§6) |
| Storage policy check | If you chose all-files access (§4.2), a Play Store build needs SAF as the primary path |

### Stretch goals
| Feature | Description |
|---|---|
| Termux bridge for C/C++ | If Termux is installed, compile and run C/C++ with its `clang` via Termux's `RUN_COMMAND` intent; output back in your console. Far smaller than bundling a toolchain. Needs real file paths (§4.2). Verify against current Termux docs. **NEW** |
| Real autocomplete (LSP-lite) | Bundled `typescript-language-server` via Node-mobile with an in-app JSON-RPC client; or `clangd` through the Termux bridge |
| Bundled compiled-language toolchain | Termux-scale effort; the Termux bridge covers most of the value |
| Remote dev mode | SSH to a remote machine for heavier builds |

### 2.1 Deliberately not added
- **Minimap**: on a 6-inch screen it costs width and is unreadable. Outline + sticky scroll + fast-scroll thumb do the job better.
- **AI autocomplete**: needs a network service or a large on-device model; conflicts with offline-first and teaches nothing about editors. Revisit later as an optional, clearly network-dependent feature.
- **Cloud sync**: git already covers it.
- **Plugin system**: per the core philosophy.

Feature creep is the most likely way this project stalls. Each phase is usable on its own; finishing Phase 1 well beats starting Phase 3.

---

## 3. Mobile & Tablet Editing — Design Notes

### 3.1 Typing code with a soft keyboard
- **IME configuration** (`onCreateInputConnection`): `TYPE_CLASS_TEXT | TYPE_TEXT_FLAG_MULTI_LINE | TYPE_TEXT_FLAG_NO_SUGGESTIONS`, plus `IME_FLAG_NO_PERSONALIZED_LEARNING` (stops the keyboard learning your variable names). Some keyboards ignore `NO_SUGGESTIONS`; the common workaround (`TYPE_TEXT_VARIATION_VISIBLE_PASSWORD`) disables autocorrect reliably but can change the keyboard layout, so make it a setting, not the default.
- **Composing text**: keyboards send a word in progress as "composing" text and replace it repeatedly. Buffer and undo history must treat that as one edit.
- **Test several keyboards** (Gboard, Samsung Keyboard, SwiftKey, a hardware keyboard). They differ, especially on backspace and swipe typing.
- **Symbol toolbar**: language-specific rows; long-press arrows repeat; light haptic feedback.
- **Cursor control**: horizontal drag on the toolbar moves the cursor like a trackpad. Works with any keyboard, unlike keyboard-specific spacebar gestures.

### 3.2 Selecting on touch
- Long-press selects a word; drag handles use the `Magnifier` widget (Android 9+) so the finger doesn't hide the text.
- Tap a line number to select the line; drag down the gutter to select several lines.
- Expand/shrink selection (Phase 2) is the main fix; also on a toolbar button.

### 3.3 Navigating on a small screen
- Outline panel, breadcrumbs, sticky scroll (Phase 2).
- Fast-scroll thumb for long files.
- Quick open, go to line, back/forward.

### 3.4 Surviving Android's lifecycle
Android kills background processes to free memory: switch to a browser to read docs, come back, and the app has restarted. `ViewModel` alone doesn't survive this, and `SavedStateHandle`/`Bundle` is limited by the ~1 MB Binder transaction limit, so file contents can't go there.
- About 1–2 s after typing stops (debounced), write each dirty buffer + metadata (source URI/path, cursor, scroll, hash of the on-disk version) to `filesDir/recovery/`.
- On start: restore tabs from recovery, mark them unsaved.
- On save: delete that recovery entry.
- If the on-disk file changed since the buffer was opened: show a compare/choose dialog instead of silently overwriting.

### 3.5 Tablets and large screens
- **Adaptive layout** with window size classes: compact (<600dp) = single pane, drawers for file tree and panels; medium = collapsible side panel; expanded (>840dp) = persistent file tree + editor + optional second pane.
- **Split editor**: two files side by side, or code + live preview.
- **Hardware keyboard**: full shortcut set, published via `onProvideKeyboardShortcuts` so it appears in Android's shortcut helper (Meta+/).
- **Mouse/trackpad**: `PointerIcon.TYPE_TEXT` over text, click-drag selection without long-press, right-click (`BUTTON_SECONDARY`) context menu, scroll wheel (`AXIS_VSCROLL`).
- **Multi-window**: handle resizing without losing state; split-screen next to a browser is a common workflow.
- **Drag and drop** files into the project (low priority).

### 3.6 Preventing accidental edits
Read-only lock; scrolling never moves the cursor; a fling that starts on text never selects it.

---

## 4. Technology Choices — What, Why, and the Alternative You're Not Using

### 4.1 Text buffer & editor view
- **Choice (as v1):** custom `View`/`Canvas` editor. Phase 1 backed by `StringBuilder`; upgrade to a **piece table** or **rope** once you measure lag. Build naive first, measure, then upgrade.
- **Add: line-start index**, an array of offsets where each line begins, updated on each edit. Without it, finding "line 4,000" means scanning the whole text every frame.
- **Add: layout layer** between buffer and renderer, mapping logical lines → visual rows (needed for soft wrap and folding). Design it in Milestone 2 even if wrap starts disabled.
- **Split:** `editor-core` (buffer, line index, layout math, cursor model, undo) has no `android.*` imports, so it runs in plain JVM unit tests. `editor-view` is the Android part.
- **Very long lines** (minified JS): beyond a threshold, disable highlighting and wrap for that file or open it read-only. They break naive renderers.
- **Reference, not dependency:** sora-editor (by Rosemoe, formerly "CodeEditor") and Squircle CE. Read how they handle IME and rendering; don't copy them wholesale.

### 4.2 File access — the storage decision
v1 chose SAF only. Problem: SAF gives you `content://` URIs; libgit2, JGit and Termux expect real file paths (a C library can't `open()` a content URI). Two workable options:

| | Option A: SAF | Option B: All-files access |
|---|---|---|
| How | `ACTION_OPEN_DOCUMENT_TREE` + persisted URI permission | `MANAGE_EXTERNAL_STORAGE` on Android 11+, legacy storage permissions below |
| Git | Repos must live in app-private storage (real paths), with import/export to the user's folder | Works directly on the project folder |
| Termux bridge | Awkward (Termux can't read `content://`) | Works with shared paths |
| Listing speed | Slow with `DocumentFile`; use `DocumentsContract` queries (below) | Fast (`java.io.File`) |
| Play Store | Allowed | Restricted to specific app categories |

**Recommendation:** one interface, `ProjectFs` (list, read, write, rename, delete, stat), with `SafProjectFs` and `PathProjectFs` implementations. For a sideloaded personal build, Option B is the pragmatic default. Keep A working for files opened from other apps and for a future Play build.

**If you use SAF:** don't build the tree with `DocumentFile.listFiles()` + `getName()` per child; each call is a separate cross-process query. Query each directory once with `DocumentsContract.buildChildDocumentsUriUsingTree` and a projection (document id, display name, MIME type, size, last modified).

### 4.3 Syntax highlighting
- **Phase 1:** regex/token-based (as v1). Highlight visible lines plus a margin; cache per line; invalidate from the edited line downward (opening a multi-line comment changes everything below it).
- **Phase 2:** **tree-sitter** via NDK, one grammar per language. Report each edit with `ts_tree_edit` before re-parsing so the parse is incremental. Run highlight queries only over the visible byte range.
- Existing Android tree-sitter bindings (e.g. android-tree-sitter) are worth reading even though you'll write your own JNI layer.

### 4.4 Git
| | libgit2 (JNI) | JGit (pure Java) |
|---|---|---|
| Build | NDK; plus a TLS library (mbedTLS or OpenSSL) for HTTPS and libssh2 for SSH remotes | A Gradle dependency |
| Learning value | High: real C/JNI work | Low on the native side |
| Risks | Native build complexity (three C libraries) | Newer JGit versions may use Java APIs Android lacks; check compatibility (MGit is a working Android example) |

Either way: local operations (status, diff, commit, branch) work offline; push/pull need network, additive and never blocking. Store tokens/SSH keys encrypted with a key held in the **Android Keystore**, never in plain DataStore.

### 4.5 Running JavaScript
- **Choice:** **Jetpack JavaScriptEngine** (`androidx.javascriptengine`). Runs code on the V8 inside the system WebView, in a **separate sandbox process**: modern JS, a runaway script can be stopped by closing the isolate/sandbox, no native build, no APK size cost. Check `JavaScriptSandbox.isSupported()` and feature flags (console messages, promise results) at runtime; support depends on the device's WebView version.
- **Limits:** no DOM (use the preview WebView for DOM code), no Node APIs (`fs`, `require`), async results only.
- **Alternative:** **QuickJS** via NDK: fully under your control, synchronous, `JS_SetInterruptHandler` for timeouts. Pick it for more NDK practice or an engine independent of WebView.
- **Demoted:** **Rhino**. Incomplete modern-JS support, and on Android it must run in interpreted mode (ART can't load the JVM bytecode Rhino normally generates), so it's also slow.
- **Not used (as v1):** `nodejs-mobile`, unless you specifically need Node APIs.

### 4.6 Running Python
- **Choice (as v1):** **Chaquopy**.
- **Add:** run scripts in a **separate process** (`android:process=":runner"`). An infinite loop in Python can't be reliably interrupted from another thread; killing a separate process can. Communicate through a bound service; stream stdout/stderr; forward stdin from the console.
- **Limitation (as v1):** pure-Python packages work; native-extension packages need prebuilt Android wheels.

### 4.7 HTML/CSS/JS/Markdown preview
- **Choice:** `WebView` + **`WebViewAssetLoader`** with a custom `PathHandler` that serves project files through `ProjectFs`. The page loads from an `https://` origin, so relative links (`style.css`, `img/logo.png`, `fetch('data.json')`) resolve.
- Capture `console.log` and page errors via `WebChromeClient.onConsoleMessage` into the console pane.
- Turn off file and content URL access on the WebView; the asset loader replaces them.
- Markdown: a small bundled JS Markdown renderer in the same WebView.

### 4.8 Formatting
- Bundle Prettier's standalone (browser) build and run it in the JS engine: formats JS/TS/CSS/HTML/JSON/Markdown offline. Adds a few MB.
- C/C++: `clang-format` through the Termux bridge (stretch).

### 4.9 Settings & persistence
- Jetpack **DataStore** (as v1) for app settings; per-project overrides from `.editorconfig`.
- Recovery store and local history: plain files under `filesDir`, not DataStore.

### 4.10 UI framework
- **Compose** for everything except the editing surface (as v1); embed the editor with `AndroidView`. Material 3 adaptive components for phone/tablet layouts.
- Compose's model is close to React's: UI = function(state). The editor view is the exception: imperative, like a `<canvas>` you draw on yourself.

---

## 5. High-Level Architecture

```
┌──────────────────────────────────────────────────────┐
│ UI Layer — Jetpack Compose                           │
│ file tree · tabs · quick open · outline · git panel  │
│ console · settings · adaptive phone/tablet layouts   │
├──────────────────────────────────────────────────────┤
│ Editor View — Android View inside Compose            │
│ rendering · touch & mouse · InputConnection (IME)    │
│ selection handles · symbol toolbar · shortcuts       │
├──────────────────────────────────────────────────────┤
│ Editor Core — pure Kotlin, no android.* imports      │
│ buffer (StringBuilder → piece table) · line index    │
│ layout/wrap · cursor & selection model · undo/redo   │
├─────────────┬─────────────┬─────────────┬────────────┤
│ Syntax      │ Git         │ Execution   │ Recovery   │
│ tree-sitter │ libgit2 or  │ JS engine,  │ hot-exit   │
│ (NDK, C)    │ JGit        │ Chaquopy    │ store      │
│             │             │ own process │            │
├─────────────┴─────────────┴─────────────┴────────────┤
│ Storage — ProjectFs interface                        │
│ → SafProjectFs (content://) or PathProjectFs (paths) │
└──────────────────────────────────────────────────────┘
```

Native code stays in `:native-core` (tree-sitter, plus libgit2 / QuickJS if chosen) so the JNI boundary is isolated. User code runs outside the main app process, so a crash or hang in a script never takes the editor, or unsaved work, down with it.

---

## 6. Non-Functional Requirements

- **Offline-first (as v1):** every Phase 1–3 feature works in airplane mode, except git push/pull.
- **Never lose user data:** no edit is lost to process death, a crash, or a conflicting external change (§3.4). This ranks above performance.
- **Performance:** typing latency within one frame (<16 ms) on files of a few thousand lines on a mid-range device; highlight only what's visible; debounce expensive work (re-highlighting, search, recovery writes). Past a size/line-length threshold, degrade (no highlighting, read-only) rather than freeze.
- **Battery:** no background work while the app isn't visible, except finishing a save.
- **File correctness:** preserve encoding, BOM, line endings and final-newline state unless the user changes them. Non-UTF-8 files open read-only with a warning in early versions.
- **APK size (as v1):** per-ABI native libraries (arm64-v8a, armeabi-v7a, x86_64); one fat APK is fine while sideloading, split before publishing.
- **Permissions:** only what the chosen storage option needs; `INTERNET` only once git push/pull exists.
- **Min SDK:** 26 (Android 8) is a reasonable floor. Check the minimum of each Jetpack library you add, and current device distribution, before locking it in.

---

## 7. Suggested Project Structure

```
/app              — Compose screens, navigation, adaptive layouts
/editor-core      — pure Kotlin: buffer, line index, layout/wrap, cursor, undo (JVM-testable)
/editor-view      — Android View: rendering, touch/mouse, InputConnection, toolbar
/storage          — ProjectFs interface + SAF and path implementations, recovery store
/native-core      — NDK: tree-sitter + grammars (libgit2 / QuickJS if chosen)
/git-integration  — Kotlin API over libgit2 JNI or JGit
/execution        — JS engine wrapper, Python runner process, console model
/preview          — WebView + asset loader, Markdown rendering
```

---

## 8. Testing Strategy

- **Unit tests (JVM, fast):** `editor-core`: inserts/deletes at boundaries, line index after multi-line edits, undo/redo coalescing, wrap math. Same idea as pytest/Jest: pure logic, no device.
- **Randomized buffer test:** apply thousands of random edits to your piece table and to a plain `StringBuilder`; contents must match after every step. Catches most piece-table bugs.
- **Instrumented tests:** storage implementations; recovery after a simulated process kill (`adb shell am kill <package>` while the app is in the background).
- **Manual matrix:** each keyboard (Gboard, Samsung, SwiftKey, hardware), phone + tablet, light + dark theme.
- **Benchmark files:** keep a ~5,000-line JS file and a minified one in the repo; check typing latency after each milestone.

---

## 9. Build Roadmap (with learning milestones)

**Milestone 0 — Kotlin + Android fundamentals**
Part A, desktop JVM (IntelliJ IDEA): Kotlin basics; write `PathProjectFs.list()` and a console tree printer. Part B, Android: Activity lifecycle, Compose state and recomposition, `ViewModel`, coroutines (`Dispatchers.IO`); a small app showing a file list. *Learn: the language and platform before the hard parts.*

**Milestone 1 — Storage layer + file browser**
`ProjectFs` interface, one implementation (from your §4.2 decision), lazy file tree, open a file into a placeholder `EditText`. *Learn: Android's storage model, permission flow, interfaces as seams.*

**Milestone 2 — Custom editor view v1**
Canvas rendering, line index, layout layer (wrap-ready), cursor, scrolling/fling, `InputConnection`. *Learn: text rendering, input handling, how keyboards talk to apps. Expect this to be the longest Phase 1 milestone.*

**Milestone 3 — Editing essentials for touch**
Symbol toolbar, auto-close pairs, auto-indent, line operations, undo/redo with coalescing, hardware keyboard shortcuts. *Learn: edits as data (command pattern).*

**Milestone 4 — Regex syntax highlighting**
Visible-range highlighting with a per-line cache. *Learn: where regex breaks (nested strings, multi-line comments); this motivates Milestone 8.*

**Milestone 5 — Tabs, save, recovery**
Multiple documents, save/autosave, encoding/line-ending preservation, recovery store, external change detection. *Learn: state across documents and process death.*

**Milestone 6 — Piece table (measure first)**
Run the benchmark files; replace `StringBuilder` once you see lag; add the randomized test. *Optional C++ warm-up: write the piece table first as a standalone C++17 console program with tests, then port it to Kotlin.*

**Milestone 7 — Adaptive layout + navigation**
Phone/tablet layouts, split editor, mouse support, quick open, go to line, project search.

**Milestone 8 — tree-sitter**
NDK build, tree-sitter core + one grammar, incremental parsing; then error markers, bracket matching, folding, expand selection, outline, sticky scroll. *Learn: your first NDK/JNI project.*

**Milestone 9 — Git panel**
libgit2 or JGit (§4.4), gutter markers, credentials in the Keystore.

**Milestone 10 — Preview**
WebView + asset loader, console capture, Markdown preview, side-by-side on tablets.

**Milestone 11 — Run JS + format**
JavaScriptEngine, console pane with stop/time limit, clickable stack traces, Prettier formatting.

**Milestone 12 (stretch) — Python via Chaquopy in a runner process**

**Milestone 13 (stretch) — Termux bridge for C/C++, then LSP-lite**

---

## 10. Known Limitations

- No third-party extension system; features are fixed at build time.
- Compiled languages: full editing support; compiling/running only through the Termux bridge (if Termux is installed).
- Python: pure-Python packages only, unless prebuilt Android wheels exist.
- JS execution depends on the device's WebView version; old or un-updated WebViews may lack JavaScriptEngine or some of its features.
- Phone hardware: best for small-to-medium projects; very large repos and files will be slow.
- No semantic autocomplete before the LSP stretch milestone: highlighting, syntax errors and snippets only.
- With all-files access (§4.2 Option B), a Play Store release needs SAF as the primary path.

---

## 11. Next Step

Milestone 0, Part A: Kotlin basics on desktop, then `PathProjectFs.list()` and a console tree printer.
