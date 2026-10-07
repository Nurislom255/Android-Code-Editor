// workers/run.worker.js — runs the user's JavaScript, isolated from the editor.
//
// A Web Worker is a separate thread with no DOM and no access to the editor's
// memory: an infinite loop freezes only this worker, and the Stop button /
// time limit simply terminates it (spec §2 Phase 3 "every run is
// interruptible"; the web equivalent of running scripts in a separate process).
//
// Output is streamed: each console.log is posted immediately, so long-running
// scripts show progress instead of everything arriving at the end.
//
// The run "finishes" when the script body is done AND nothing is pending:
// no timers, no fetches, no input() waiting for the user. setInterval keeps a
// run alive until you stop it or the time limit hits — same as Node.

import { formatLogArgs, inspect } from '../core/inspect.js';

const post = (msg) => self.postMessage(msg);
const emit = (level, args) => post({ type: 'console', level, text: formatLogArgs(args) });

// ---- console --------------------------------------------------------------
const counters = new Map();
const timersByLabel = new Map();
const con = self.console;
con.log = (...a) => emit('log', a);
con.info = (...a) => emit('info', a);
con.debug = (...a) => emit('log', a);
con.warn = (...a) => emit('warn', a);
con.error = (...a) => emit('error', a);
con.dir = (v) => emit('log', [inspect(v, { depth: 4 })]);
con.trace = (...a) => emit('log', [...a, '\n' + (new Error().stack || '').split('\n').slice(2).join('\n')]);
con.assert = (cond, ...a) => { if (!cond) emit('error', ['Assertion failed:', ...a]); };
con.clear = () => post({ type: 'clear' });
con.count = (label = 'default') => { const n = (counters.get(label) || 0) + 1; counters.set(label, n); emit('log', [`${label}: ${n}`]); };
con.countReset = (label = 'default') => counters.delete(label);
con.time = (label = 'default') => timersByLabel.set(label, performance.now());
con.timeEnd = (label = 'default') => {
  const t = timersByLabel.get(label);
  if (t !== undefined) { emit('log', [`${label}: ${(performance.now() - t).toFixed(3)} ms`]); timersByLabel.delete(label); }
};
con.timeLog = (label = 'default', ...a) => {
  const t = timersByLabel.get(label);
  if (t !== undefined) emit('log', [`${label}: ${(performance.now() - t).toFixed(3)} ms`, ...a]);
};
con.table = (data) => emit('log', [formatTable(data)]);
con.group = con.groupCollapsed = (...a) => { if (a.length) emit('log', a); };
con.groupEnd = () => {};

function formatTable(data) {
  if (!data || typeof data !== 'object') return inspect(data);
  const rows = Object.entries(data);
  const cols = [...new Set(rows.flatMap(([, v]) => (v && typeof v === 'object' ? Object.keys(v) : ['Values'])))];
  const cell = (v) => (typeof v === 'string' ? v : inspect(v, { depth: 0 }));
  const table = [['(index)', ...cols], ...rows.map(([k, v]) => [k, ...cols.map((c) => (v && typeof v === 'object' ? (c in v ? cell(v[c]) : '') : c === 'Values' ? cell(v) : ''))])];
  const widths = table[0].map((_, i) => Math.min(30, Math.max(...table.map((r) => String(r[i]).length))));
  const line = (r) => '│ ' + r.map((c, i) => String(c).slice(0, 30).padEnd(widths[i])).join(' │ ') + ' │';
  const sep = (l, m, r) => l + widths.map((w) => '─'.repeat(w + 2)).join(m) + r;
  return [sep('┌', '┬', '┐'), line(table[0]), sep('├', '┼', '┤'), ...table.slice(1).map(line), sep('└', '┴', '┘')].join('\n');
}

// ---- tracking pending work -------------------------------------------------
const real = {
  setTimeout: self.setTimeout.bind(self), clearTimeout: self.clearTimeout.bind(self),
  setInterval: self.setInterval.bind(self), clearInterval: self.clearInterval.bind(self),
  fetch: self.fetch ? self.fetch.bind(self) : null,
};
const timeouts = new Set();
const intervals = new Set();
let pendingOther = 0; // fetches + input() calls
let bodyDone = false;
let finished = false;

function reportError(err) {
  const text = err && err.stack ? (String(err.stack).startsWith(err.name) ? err.stack : `${err.name}: ${err.message}\n${err.stack}`)
    : err instanceof Error ? `${err.name}: ${err.message}` : `Uncaught ${inspect(err)}`;
  post({ type: 'console', level: 'error', text, errorName: err && err.name });
}

function checkDone() {
  if (finished || !bodyDone) return;
  real.setTimeout(() => {
    if (finished || !bodyDone) return;
    if (timeouts.size === 0 && intervals.size === 0 && pendingOther === 0) {
      finished = true;
      post({ type: 'done' });
    }
  }, 0);
}

self.setTimeout = (fn, ms = 0, ...args) => {
  const id = real.setTimeout(() => {
    timeouts.delete(id);
    try { if (typeof fn === 'function') fn(...args); } catch (err) { reportError(err); }
    checkDone();
  }, ms);
  timeouts.add(id);
  return id;
};
self.clearTimeout = (id) => { if (timeouts.delete(id)) real.clearTimeout(id); checkDone(); };
self.setInterval = (fn, ms = 0, ...args) => {
  const id = real.setInterval(() => {
    try { if (typeof fn === 'function') fn(...args); } catch (err) { reportError(err); }
  }, ms);
  intervals.add(id);
  return id;
};
self.clearInterval = (id) => { if (intervals.delete(id)) real.clearInterval(id); checkDone(); };
if (real.fetch) {
  self.fetch = (...args) => {
    pendingOther++;
    return real.fetch(...args).finally(() => { pendingOther--; checkDone(); });
  };
}

// ---- stdin ----------------------------------------------------------------
// readline(): synchronous, reads the next line typed into the stdin box
//             before running (null at end of input) — like competitive
//             programming judges.
// input(q) / prompt(q): async — returns a Promise; uses the stdin box first,
//             then asks interactively in the console. Use `await input()`.
let stdinLines = [];
const inputWaiters = new Map();
let nextInputId = 1;

self.readline = () => (stdinLines.length ? stdinLines.shift() : null);
self.input = self.prompt = (question = '') => {
  if (stdinLines.length) {
    const line = stdinLines.shift();
    if (question) post({ type: 'console', level: 'input', text: `${question}${line}` });
    return Promise.resolve(line);
  }
  return new Promise((resolve) => {
    const id = nextInputId++;
    pendingOther++;
    inputWaiters.set(id, resolve);
    post({ type: 'input-request', id, prompt: String(question) });
  });
};

self.addEventListener('unhandledrejection', (e) => { e.preventDefault(); reportError(e.reason); checkDone(); });
self.addEventListener('error', (e) => { e.preventDefault(); reportError(e.error || e.message); });

self.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type === 'input-response') {
    const resolve = inputWaiters.get(msg.id);
    if (resolve) {
      inputWaiters.delete(msg.id);
      pendingOther--;
      resolve(msg.value);
      checkDone();
    }
    return;
  }
  if (msg.type !== 'run') return;
  stdinLines = msg.stdin ? msg.stdin.replace(/\r\n?/g, '\n').split('\n') : [];
  if (stdinLines.length && stdinLines[stdinLines.length - 1] === '') stdinLines.pop();
  const source = `${msg.code}\n//# sourceURL=${msg.filename}`;
  let result;
  try {
    try {
      result = (0, eval)(source); // indirect eval: runs as a global script
    } catch (err) {
      // Top-level `await` isn't allowed in a classic script; wrap and retry.
      // The wrapper starts on line 1, so line numbers in errors stay correct.
      if (err instanceof SyntaxError && /await is only valid|reserved word/.test(err.message)) {
        result = (0, eval)(`(async () => {${msg.code}\n})()\n//# sourceURL=${msg.filename}`);
        result = await result;
      } else {
        throw err;
      }
    }
    if (result && typeof result.then === 'function') result = await result;
    if (result !== undefined) post({ type: 'console', level: 'result', text: inspect(result) });
  } catch (err) {
    reportError(err);
    if (err instanceof SyntaxError) post({ type: 'syntax-error' });
  }
  bodyDone = true;
  checkDone();
};

post({ type: 'ready' });
