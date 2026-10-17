// ROADMAP Phase 5 — built-in runtimes. Acceptance tests written ahead: each
// is test.fixme (reported as skipped) until the phase is built. 5B and 5C
// start with a spike; their go/no-go numbers are measured on the owner's phone.
import { test } from '@playwright/test';

test.fixme('5A Python: Run streams print() output; time limit and Stop work', async () => {
  // main.py: for i in range(3): print(i)  → console shows 0, 1, 2 as they come, then "✓ Finished".
  // while True: pass → stopped by the time limit; Stop ends it at once. The status bar is orange meanwhile.
});

test.fixme('5A Python: input() reads the Program input lines (or asks, where cross-origin isolated)', async () => {
  // name = input(); print("hi", name) with Program input "Ann" → "hi Ann".
});

test.fixme('5A Python: an error points at its line, and the link jumps there', async () => {
  // Line 3 raises ZeroDivisionError → console shows File "main.py", line 3 as a link; tapping it puts the cursor on line 3.
});

test.fixme('5A Python: works offline after the first download (web) / from the first start (APK)', async () => {
  // Run once online, go offline (context.setOffline), reload, Run again → same output.
});

test.fixme('5B C++: hello world with <iostream> compiles and runs; cin works', async () => {
  // #include <iostream> … std::cout << "hi" → "hi". int n; std::cin >> n; with input "41" → n+1 = 42.
  // <string>, <vector>, <map>, <algorithm>, <cmath> compile.
});

test.fixme('5B C/C++: compile errors are clickable and the program exit code is shown', async () => {
  // A missing ; on line 4 → clang's message with main.cpp:4:… as a link to line 4.
  // return 3; → "exited with code 3".
});

test.fixme('5C Rust: hello world compiles and runs (only if the spike is a go)', async () => {
  // fn main() { println!("hi"); } → "hi". If neither option meets the owner's limits, this stays fixme and is discussed.
});
