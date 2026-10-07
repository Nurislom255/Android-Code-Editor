// run/jsRunner.js — main-thread side of the JS runner (see workers/run.worker.js).
//
// Every run gets a brand-new worker: no leftover globals from the previous
// run, and "stop" is just worker.terminate() — which works even on
// `while (true) {}`, the case a same-thread interpreter can't interrupt.

export class JsRunner {
  constructor(workerUrl = 'run-worker.js') {
    this.workerUrl = workerUrl;
    this.current = null;
  }

  get running() { return !!this.current; }

  /**
   * @param {object} o
   * @param {string} o.code
   * @param {string} o.filename         shown in stack traces (sourceURL)
   * @param {string} [o.stdin]
   * @param {number} o.timeLimit        seconds
   * @param {(e:{level:string,text:string})=>void} o.onOutput
   * @param {(prompt:string)=>Promise<string|null>} o.onInput
   * @param {(status:'done'|'stopped'|'timeout'|'error', ms:number)=>void} o.onExit
   * @param {()=>void} [o.onClear]
   * @param {()=>void} [o.onSyntaxError]
   */
  run({ code, filename, stdin = '', timeLimit, onOutput, onInput, onExit, onClear, onSyntaxError }) {
    this.stop('stopped');
    let worker;
    try {
      worker = new Worker(this.workerUrl);
    } catch (err) {
      onOutput({ level: 'error', text: `Could not start the JavaScript sandbox: ${err.message}. Serve the app over http(s) — opening index.html from disk (file://) blocks workers.` });
      onExit('error', 0);
      return;
    }
    const started = performance.now();
    const run = { worker, onExit, timer: 0, finished: false };
    this.current = run;

    const finish = (status) => {
      if (run.finished) return;
      run.finished = true;
      clearTimeout(run.timer);
      worker.terminate();
      if (this.current === run) this.current = null;
      onExit(status, Math.round(performance.now() - started));
    };
    run.finish = finish;

    if (timeLimit > 0) run.timer = setTimeout(() => finish('timeout'), timeLimit * 1000);

    worker.onmessage = async (e) => {
      const m = e.data;
      if (run.finished) return;
      if (m.type === 'console') onOutput({ level: m.level, text: m.text });
      else if (m.type === 'clear') onClear && onClear();
      else if (m.type === 'syntax-error') onSyntaxError && onSyntaxError();
      else if (m.type === 'done') finish('done');
      else if (m.type === 'input-request') {
        const value = await onInput(m.prompt);
        if (!run.finished) worker.postMessage({ type: 'input-response', id: m.id, value });
      }
    };
    worker.onerror = (e) => {
      e.preventDefault();
      onOutput({ level: 'error', text: e.message || 'The sandbox failed to load.' });
      finish('error');
    };
    worker.postMessage({ type: 'run', code, filename, stdin });
  }

  stop(status = 'stopped') {
    if (this.current && this.current.finish) this.current.finish(status);
    this.current = null;
  }
}
