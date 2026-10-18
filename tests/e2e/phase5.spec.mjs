// ROADMAP Phase 5 — the app as an APK, with a real Linux terminal (Alpine
// Linux run by proot, as Acode does). Acceptance tests written ahead: each is
// test.fixme (reported as skipped) until its step is built. The native parts
// (proot, the pseudo-terminal) can't run in desktop Chromium: when a step is
// built, its app side is tested here against a fake "Linux" plugin, and the
// rest becomes a device check in TESTS.md (Galaxy Tab A9+).
import { test } from '@playwright/test';

// ---- 5.1 automatic APK builds (checked on GitHub and the tablet, not here) ----------------

test.fixme('5.1 a merged PR publishes a release with an APK that installs over the previous one', async () => {
  // GitHub Actions: build → cap sync → Gradle → signed APK. The PR has the APK as a download;
  // the merge creates a release. Installing it over the last one keeps projects; About shows the new version.
});

// ---- 5.2 projects as real files ------------------------------------------------------------

test.fixme('5.2 in the APK, a new project is a folder of plain files; Move to device files keeps everything', async () => {
  // Fake plugin: new project → files written through the device-files mode. A browser-storage project
  // → "Move to device files" → same tree, same unsaved buffers, git history kept.
});

// ---- 5.3 the terminal ----------------------------------------------------------------------

test.fixme('5.3 the Terminal tab sets up Linux once (download with progress), then opens a shell in the project', async () => {
  // Fake plugin reports download progress, then a prompt. Second start: no download. Settings → Storage
  // shows the Linux size and "Remove the Linux environment".
});

test.fixme('5.3 the terminal takes typing, the keys bar (Ctrl, Esc, Tab, arrows) and Ctrl+C', async () => {
  // Keys typed in xterm.js reach the plugin as bytes (Ctrl+C = \x03, ↑ = \x1b[A); output is drawn;
  // several terminals; the theme follows; output is kept when switching panels.
});

// ---- 5.4 Run with real tools -----------------------------------------------------------------

test.fixme('5.4 Run on .py / .cpp / .rs runs the real tool in a terminal, with input', async () => {
  // main.py → python3 main.py; main.cpp → g++ main.cpp -o main && ./main; Cargo project → cargo run.
  // The command can be changed per project.
});

test.fixme('5.4 a missing tool: "Install Python (≈ 50 MB)?" installs it with apk, then runs', async () => {
  // Fake plugin: `command -v python3` fails → the offer → apk add python3 → Run again.
});

test.fixme('5.4 compiler and runtime errors in the terminal are clickable', async () => {
  // "main.cpp:4:5: error: …" and 'File "main.py", line 3' → tap → the file opens at that line.
});

// ---- 5.5 code intelligence ------------------------------------------------------------------

test.fixme('5.5 Settings → Code intelligence: Basic keeps the built-in features; Advanced uses a language server', async () => {
  // Advanced + C++: clangd (installed on demand) underlines an undeclared name; go to definition
  // jumps into another file; hover shows the type. Basic: none of it starts.
});

// ---- 5.6 shared folders ----------------------------------------------------------------------

test.fixme('5.6 with All files access, a folder in Download/ opens as a project and is visible in the terminal', async () => {
  // Granted in Settings; the folder is bound into Linux (/sdcard/Download/…).
});
