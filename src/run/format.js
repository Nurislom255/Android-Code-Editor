// run/format.js — "Format document" via the Prettier worker.

const PARSERS = {
  javascript: 'babel', jsx: 'babel', typescript: 'babel-ts', tsx: 'babel-ts',
  json: 'json', css: 'css', scss: 'scss', less: 'less', html: 'html', markdown: 'markdown', yaml: 'yaml',
};

export function canFormat(langId) {
  return langId in PARSERS;
}

let worker = null;
let nextId = 1;
const pending = new Map();

function getWorker() {
  if (worker) return worker;
  worker = new Worker('format-worker.js');
  worker.onmessage = (e) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    p.resolve(e.data);
  };
  worker.onerror = (e) => {
    for (const p of pending.values()) p.resolve({ ok: false, error: e.message || 'Formatter failed to load' });
    pending.clear();
    worker = null;
  };
  return worker;
}

/**
 * @returns {Promise<{ok:true, formatted:string, cursorOffset:number}|{ok:false, error:string}>}
 */
export function formatText({ text, langId, cursorOffset = 0, tabWidth = 2, useTabs = false }) {
  const parser = PARSERS[langId];
  if (!parser) return Promise.resolve({ ok: false, error: `No formatter for this language (${langId}).` });
  return new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, { resolve });
    getWorker().postMessage({ id, text, parser, cursorOffset, options: { tabWidth, useTabs, printWidth: 80, proseWrap: 'preserve' } });
    setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); resolve({ ok: false, error: 'Formatting timed out.' }); }
    }, 20000);
  });
}
