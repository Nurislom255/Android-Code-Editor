// core/inspect.js — turns any JS value into readable text for the console pane,
// roughly like Node's util.inspect / the browser devtools console.
// Runs inside the run worker (src/workers/run.worker.js); pure, so it's also
// unit-tested in Node.

const MAX_ARRAY_ITEMS = 100;
const MAX_STRING_IN_OBJECT = 500;

export function inspect(value, { depth = 2 } = {}) {
  return fmt(value, depth, new Set(), true);
}

function fmt(v, depth, seen, top) {
  switch (typeof v) {
    case 'string':
      if (top) return v;
      return quote(v.length > MAX_STRING_IN_OBJECT ? v.slice(0, MAX_STRING_IN_OBJECT) + '…' : v);
    case 'number':
      return Object.is(v, -0) ? '-0' : String(v);
    case 'bigint':
      return `${v}n`;
    case 'boolean':
    case 'undefined':
      return String(v);
    case 'symbol':
      return v.toString();
    case 'function': {
      const src = Function.prototype.toString.call(v);
      if (/^class\b/.test(src)) return `[class ${v.name || '(anonymous)'}]`;
      return `[Function: ${v.name || '(anonymous)'}]`;
    }
  }
  if (v === null) return 'null';
  if (seen.has(v)) return '[Circular]';

  if (v instanceof Error) {
    const head = `${v.name}: ${v.message}`;
    return top && v.stack ? (v.stack.startsWith(head) ? v.stack : `${head}\n${v.stack}`) : `[${head}]`;
  }
  if (v instanceof Date) return isNaN(v) ? 'Invalid Date' : v.toISOString();
  if (v instanceof RegExp) return String(v);
  if (typeof Promise !== 'undefined' && v instanceof Promise) return 'Promise { … }';
  if (typeof WeakMap !== 'undefined' && (v instanceof WeakMap || v instanceof WeakSet)) return `${v.constructor.name} { <items unknown> }`;

  if (depth < 0) {
    if (Array.isArray(v)) return '[Array]';
    return `[${ctorName(v) || 'Object'}]`;
  }

  seen.add(v);
  try {
    if (Array.isArray(v) || ArrayBuffer.isView(v)) {
      const items = [];
      const n = Math.min(v.length, MAX_ARRAY_ITEMS);
      for (let i = 0; i < n; i++) items.push(i in v ? fmt(v[i], depth - 1, seen, false) : '<empty>');
      if (v.length > n) items.push(`... ${v.length - n} more items`);
      const prefix = Array.isArray(v) ? '' : `${ctorName(v)}(${v.length}) `;
      return prefix + wrap('[', items, ']');
    }
    if (v instanceof Map) {
      const items = [...v].slice(0, MAX_ARRAY_ITEMS).map(([k, val]) => `${fmt(k, depth - 1, seen, false)} => ${fmt(val, depth - 1, seen, false)}`);
      return `Map(${v.size}) ` + wrap('{', items, '}');
    }
    if (v instanceof Set) {
      const items = [...v].slice(0, MAX_ARRAY_ITEMS).map((x) => fmt(x, depth - 1, seen, false));
      return `Set(${v.size}) ` + wrap('{', items, '}');
    }
    const keys = Object.keys(v);
    const items = keys.slice(0, MAX_ARRAY_ITEMS).map((k) => `${fmtKey(k)}: ${fmt(v[k], depth - 1, seen, false)}`);
    if (keys.length > MAX_ARRAY_ITEMS) items.push(`... ${keys.length - MAX_ARRAY_ITEMS} more`);
    const name = ctorName(v);
    const prefix = name && name !== 'Object' ? `${name} ` : '';
    return prefix + wrap('{', items, '}');
  } finally {
    seen.delete(v);
  }
}

function ctorName(v) {
  try {
    const proto = Object.getPrototypeOf(v);
    if (proto === null) return '[Object: null prototype]';
    return proto && proto.constructor && proto.constructor.name;
  } catch {
    return '';
  }
}

function wrap(open, items, close) {
  if (items.length === 0) return open + close;
  const oneLine = `${open} ${items.join(', ')} ${close}`;
  if (oneLine.length <= 72 && !oneLine.includes('\n')) return oneLine;
  return `${open}\n${items.map((s) => '  ' + s.replace(/\n/g, '\n  ')).join(',\n')}\n${close}`;
}

function quote(s) {
  return "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n') + "'";
}

function fmtKey(k) {
  return /^[A-Za-z_$][\w$]*$/.test(k) ? k : quote(k);
}

/**
 * console.log("%s is %d years", "Ann", 30) style substitution.
 * @returns {string}
 */
export function formatLogArgs(args) {
  if (args.length === 0) return '';
  let rest = args;
  let out = '';
  if (typeof args[0] === 'string' && /%[sdifoOjc%]/.test(args[0])) {
    let i = 1;
    out = args[0].replace(/%([sdifoOjc%])/g, (m, f) => {
      if (f === '%') return '%';
      if (i >= args.length) return m;
      const a = args[i++];
      switch (f) {
        case 's': return typeof a === 'string' ? a : inspect(a, { depth: 1 });
        case 'd': case 'i': return typeof a === 'bigint' ? `${a}n` : String(f === 'i' ? parseInt(a, 10) : Number(a));
        case 'f': return String(parseFloat(a));
        case 'j': try { return JSON.stringify(a); } catch { return '[Circular]'; }
        case 'c': return ''; // CSS styling isn't supported in a text console
        default: return inspect(a);
      }
    });
    rest = args.slice(i);
  } else {
    out = inspect(args[0]);
    rest = args.slice(1);
  }
  for (const a of rest) out += ' ' + inspect(a);
  return out;
}
