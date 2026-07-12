// run.js
//
// WHY A WEB WORKER (and not just calling eval() directly on the main thread):
// - A Worker has NO access to the DOM, cookies, or the app's own JS state.
//   If you paste in something malicious or just buggy, it can't reach out
//   and mess with the editor itself. Direct eval() on the main thread has
//   full access to everything — a much bigger blast radius.
// - A Worker runs on a separate thread, so an infinite loop in the user's
//   code freezes the *worker*, not your UI — you can still click "stop."
//   Direct eval() would hang the entire page.
// - This is conceptually close to what QuickJS-in-a-sandbox was doing in
//   the Android spec: isolate untrusted/experimental code from the host.
//
// ALTERNATIVE REJECTED: an <iframe sandbox> instead of a Worker. Iframes
// CAN be locked down similarly, but they still carry a DOM and a full page
// context — more surface area than needed for "run this JS and capture
// console output." We do use an iframe separately, in preview.js, because
// the live HTML/CSS/JS preview genuinely needs a DOM to render into.

const WORKER_SOURCE = `
self.onmessage = (e) => {
  const logs = [];
  const record = (type) => (...args) => {
    logs.push({ type, args: args.map(a => {
      try { return typeof a === 'object' ? JSON.stringify(a) : String(a); }
      catch { return String(a); }
    })});
  };
  const console = { log: record('log'), error: record('error'), warn: record('warn'), info: record('log') };
  try {
    // THE ACTUAL "stuck on Running..." BUG WAS HERE.
    // (0, eval)(...) is *indirect* eval - it deliberately runs in the
    // worker's GLOBAL scope, not this function's local scope. That means
    // it could not see the "const console" shadow defined two lines up:
    // any console.log() the user's code called went to the worker's REAL
    // built-in console (invisible - nothing listens to it), not into our
    // logs array. So self.postMessage(logs) sent back an empty array
    // every time, and the UI had nothing to print after "Running...".
    // Direct eval (just "eval(...)", no comma trick) runs in the LOCAL
    // scope, so it DOES see the shadowed console. That's the fix.
    const result = eval(e.data);
    if (result !== undefined) logs.push({ type: 'result', args: [String(result)] });
  } catch (err) {
    logs.push({ type: 'error', args: [err.message] });
  }
  self.postMessage(logs);
};
`;

const TIMEOUT_MS = 5000;

/**
 * Runs `code` in an isolated worker. Calls onOutput(logEntries) exactly once,
 * either with the captured console output or a timeout/error entry.
 * Returns a cancel() function in case you want to add a "Stop" button later.
 */
export function runJavaScript(code, onOutput) {
  let worker;
  try {
    const blob = new Blob([WORKER_SOURCE], { type: 'application/javascript' });
    worker = new Worker(URL.createObjectURL(blob));
  } catch (err) {
    // This is the fix for the "stuck on Running..." bug: if the Worker
    // constructor itself throws (most commonly because the page was opened
    // via file:// instead of served over http://, which blocks blob-based
    // Workers in most browsers), we now report it instead of silently
    // leaving the caller's "Running..." message with nothing to follow it.
    onOutput([{ type: 'error', args: [
      `Could not start the execution sandbox: ${err.message}. ` +
      `If you opened this file directly from disk, serve it instead ` +
      `(npx serve www) and open the http:// URL — see README.`,
    ] }]);
    return () => {};
  }
  let settled = false;

  const timeoutId = setTimeout(() => {
    if (settled) return;
    settled = true;
    worker.terminate();
    onOutput([{ type: 'error', args: [`Execution timed out after ${TIMEOUT_MS / 1000}s — check for an infinite loop.`] }]);
  }, TIMEOUT_MS);

  worker.onmessage = (e) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeoutId);
    onOutput(e.data);
    worker.terminate();
  };

  worker.onerror = (e) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeoutId);
    onOutput([{ type: 'error', args: [e.message] }]);
    worker.terminate();
  };

  worker.postMessage(code);

  return () => {
    if (settled) return;
    settled = true;
    clearTimeout(timeoutId);
    worker.terminate();
  };
}
