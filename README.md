# Android-Code-Editor
This project makes writing code and learning web development easier for Android device users by providing features that are vital for a good code editor
# CodeEditor Web — Baseline

A working baseline of the code editor from the original Android spec, rebuilt for the web
so it can be wrapped into an APK with **Capacitor**.

## Run it right now

You can't just double-click `www/index.html` — opening a folder needs the File System
Access API, which browsers restrict to secure contexts (`http://`, not `file://`). Serve it
locally instead:

```bash
cd www
npx serve .
# or: python3 -m http.server 8000
```

Then open the printed `localhost` URL in **desktop Chrome or Edge** (the File System Access
API isn't supported in Safari or Firefox yet — the app still works there, just falls back to
"Open File" instead of "Open Folder").

## What's actually working (not stubbed)

- **Open a real folder** on your computer, browse its file tree, click a file to open it in a tab
- **Create File / Create Folder / New Project** — New Project scaffolds `index.html` + `style.css` + `main.js` + `app.js`, already linked, into a chosen subfolder (needs a real opened folder — see `requireRootHandle` in `main.js`)
- **Multi-tab editing** with per-tab undo history, unsaved-change dot, a properly touch-sized close button
- **Real syntax highlighting** for JS/HTML/CSS (via CodeMirror 6 — parses on every keystroke, doesn't just color-match with regex)
- **Save / Save As / Save All** — Ctrl+S saves the active tab, Ctrl+Shift+S saves all dirty tabs, the Save ▾ menu has both plus Save As
- **Run JS** — executes in an isolated Web Worker with a 5-second timeout, captures `console.log`/`error`/`warn` output into the console panel (the "stuck on Running..." bug is fixed — see `run.js`'s comment for the root cause)
- **Live HTML/CSS/JS preview** — renders the open `.html` tab (pulling CSS/JS from other open tabs in the same folder) into a sandboxed iframe
- **Resizable console/preview panel** — drag the handle above it; height persists across sessions
- **Tablet coding-keys bar** — symbol row + navigation/action row, auto-shows when the on-screen keyboard is up and auto-hides when a hardware keyboard seems connected (override in Settings: Auto/Always/Never). See `keysBar.js`'s top comment for why it does NOT try to simulate Ctrl-combos via a fake modifier press — that approach is fundamentally unreliable on mobile IMEs, so common Ctrl actions (Undo, Redo, Save, Select All) are their own direct buttons instead.
- **Settings** — theme, font size, tab width, panel height, keys-bar mode — all persisted across sessions

## What's deliberately NOT here yet

- **Git** — you said skip it for now. `fileSystem.js`'s provider pattern means adding a
  `git-integration` module later won't require touching the editor or UI code.
- **Python execution** — would mean pulling in Pyodide (WASM CPython, ~10-30MB). Left out of
  the baseline so the first load stays light; add when you're ready for that tradeoff.
- **CapacitorFSProvider** — there's a `TODO` for it in `fileSystem.js`. Until then, the app
  runs in "Open File" fallback mode inside a Capacitor/WebView shell (still works, just
  without live folder access — save triggers a download instead of a direct disk write).
  See `CAPACITOR_SETUP.md` for the exact commands to wrap this with Capacitor yourself.
- **Keys bar can visually overlap the editor/console in some layouts** — it's `position: fixed`
  and doesn't yet reserve space by resizing the rest of the layout when it appears. Minor, but
  worth fixing in a focused pass once you're testing on a real device — the fix is having it
  toggle a class that adds matching `padding-bottom` to `#body`.

## Project structure

```
codeeditor-web/
├── src/               ← source you read/edit
│   ├── main.js          DOM wiring — toolbar, tree, tabs, panels, dropdowns, resize handle
│   ├── editor.js          CodeMirror setup + multi-tab manager + command wrappers for the keys bar
│   ├── fileSystem.js       FileSystemProvider abstraction (the key seam for Capacitor later)
│   ├── keysBar.js           Tablet coding-keys bar (symbols + nav/action buttons, auto-hide heuristic)
│   ├── boilerplate.js        "New Project" starter file templates
│   ├── run.js                  Worker-sandboxed JS execution
│   ├── preview.js                iframe-based live preview
│   ├── settings.js                 localStorage-backed settings
│   ├── index.html
│   └── styles.css
├── www/                ← BUILD OUTPUT. This is what Capacitor wraps.
│   ├── index.html   (copy of src/index.html)
│   ├── bundle.js    (esbuild-bundled src/*.js, offline — no CDN dependency at runtime)
│   └── styles.css   (copy of src/styles.css)
├── capacitor.config.json   ← ready to use, see CAPACITOR_SETUP.md
├── CAPACITOR_SETUP.md      ← exact commands to wrap this as an APK yourself
└── package.json
```

Rebuild `www/bundle.js` after editing anything in `src/`:

```bash
npx esbuild src/main.js --bundle --minify --outfile=www/bundle.js --format=iife --target=es2020
cp src/index.html src/styles.css www/
```

(Worth turning that into an npm script — `"build": "esbuild ..."` in `package.json` — once
you're tired of typing it. That's also usually the point where projects move to a proper
bundler config file instead of a one-line CLI command; not necessary yet.)

## Next step: wrapping with Capacitor

See **`CAPACITOR_SETUP.md`** for the exact commands, in order, including the one config edit
(your `appId`) you need to make before running anything.

## Suggested order for going deeper together

1. **File tree UX** — currently a flat expand/collapse; add drag handling for touch, rename/delete
2. **CapacitorFSProvider** — wire real Android file access once you're ready to test on-device
3. **Preview accuracy** — resolve real `<link>`/`<script src>` paths against the open folder instead of "any open tab in the same directory"
4. **tree-sitter-wasm** (optional) — CodeMirror 6's Lezer parser already gives you real syntax trees; only reach for tree-sitter-wasm specifically if you want grammars CodeMirror doesn't ship (e.g. a language CodeMirror doesn't support yet)
5. **Local git** (isomorphic-git, no remote) — when you're ready to unpause this
