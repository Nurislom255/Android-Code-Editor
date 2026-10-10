// run/preview.js — live HTML / Markdown preview with real relative links.
//
// v1 only glued together CSS/JS from *open tabs*. v2 resolves what the page
// actually references — <link href>, <script src>, <img src>, url() in CSS,
// ES module imports, fetch('data.json') — against the project folder, using
// unsaved editor contents when a file is open (spec §4.7: the WebView asset
// loader's job, done in the browser).
//
// How: the page is rebuilt into one self-contained document. Stylesheets and
// classic scripts are inlined (with a `sourceURL` comment so errors still say
// "app.js:12"); images/fonts and ES modules become data: URLs; fetch() of a
// relative URL is answered by the editor through postMessage.
//
// The preview iframe is sandboxed WITHOUT allow-same-origin: the page gets an
// opaque origin, so its scripts can't reach the editor's storage or DOM.
// That's also why blob: URLs (bound to the editor's origin) wouldn't load
// there and data: URLs are used instead.

import { resolveUrlRef as resolveRef, dirname, extname } from '../core/paths.js';
import { scriptLineMap, lineOfText } from '../core/previewLines.js';

const MIME = {
  '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.html': 'text/html', '.htm': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.bmp': 'image/bmp', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv', '.xml': 'application/xml', '.wasm': 'application/wasm',
};
export const mimeFor = (path) => MIME[extname(path)] || 'application/octet-stream';
const isText = (mime) => /^text\/|json|xml|javascript|svg/.test(mime);
const MAX_ASSET_BYTES = 8 * 1024 * 1024;

function bytesToBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/**
 * @param {(path:string) => Promise<{text?:string, bytes?:Uint8Array}|null>} read
 *        returns unsaved editor text when the file is open, else disk content
 */
export class PreviewBuilder {
  constructor(read) {
    this.read = read;
  }

  async dataUrl(path) {
    const f = await this.read(path);
    if (!f) return null;
    const mime = mimeFor(path);
    if (f.text != null) return `data:${mime};charset=utf-8,${encodeURIComponent(f.text)}`;
    if (f.bytes.length > MAX_ASSET_BYTES) return null;
    return `data:${mime};base64,${bytesToBase64(f.bytes)}`;
  }

  async text(path) {
    const f = await this.read(path);
    if (!f) return null;
    return f.text != null ? f.text : new TextDecoder().decode(f.bytes);
  }

  /** Rewrites url(...) and @import inside CSS. */
  async css(code, fromDir, depth = 0) {
    let out = code;
    if (depth < 4) {
      const imports = [...out.matchAll(/@import\s+(?:url\()?\s*(['"]?)([^'")\s;]+)\1\s*\)?([^;]*);/g)];
      for (const m of imports) {
        const p = resolveRef(fromDir, m[2]);
        if (!p) continue;
        const inner = await this.text(p);
        if (inner == null) continue;
        const media = m[3].trim();
        const body = await this.css(inner, dirname(p), depth + 1);
        out = out.replace(m[0], media ? `@media ${media} {\n${body}\n}` : body);
      }
    }
    const URL_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
    const map = new Map();
    for (const ref of new Set([...out.matchAll(URL_RE)].map((m) => m[2]))) {
      const p = resolveRef(fromDir, ref);
      const data = p ? await this.dataUrl(p) : null;
      if (data) map.set(ref, data);
    }
    return map.size ? out.replace(URL_RE, (m, q, ref) => (map.has(ref) ? `url("${map.get(ref)}")` : m)) : out;
  }

  /** Rewrites relative import specifiers in an ES module to data: URLs (recursively). */
  async moduleCode(code, fromDir, stack = []) {
    const specs = new Set();
    for (const m of code.matchAll(/\b(?:import|export)\s*(?:[\w*{}\s,$]+?\s*from\s*)?(['"])([^'"\n]+)\1/g)) specs.add(m[2]);
    for (const m of code.matchAll(/\bimport\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g)) specs.add(m[2]);
    let out = code;
    for (const spec of specs) {
      if (!/^\.{0,2}\//.test(spec)) continue; // bare or absolute URL: leave alone
      const p = resolveRef(fromDir, spec);
      if (!p || stack.includes(p)) continue; // circular import: can't be inlined
      const src = await this.text(p);
      if (src == null) continue;
      const inner = await this.moduleCode(src, dirname(p), [...stack, p]);
      const url = `data:text/javascript;charset=utf-8,${encodeURIComponent(`${inner}\n//# sourceURL=${p}`)}`;
      out = out.replace(new RegExp(`(['"])${spec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\1`, 'g'), JSON.stringify(url));
    }
    return out;
  }

  /**
   * @param {string} html   page source
   * @param {string} path   project path of the page (for resolving links)
   * @param {{token:string, scrollY?:number}} o
   * @returns {Promise<string>} a self-contained document for iframe.srcdoc
   */
  async html(html, path, { token, scrollY = 0 }) {
    const dir = dirname(path);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const head = doc.head;
    // Each script remembers where its code came from, so errors can say
    // "app.js:9" instead of a line of this generated page (see previewLines.js).
    const plain = html.replace(/\r\n?/g, '\n');
    let searchFrom = 0;
    const tag = (script, file, line) => {
      if (!line) return;
      script.setAttribute('data-ce-src', encodeURIComponent(file));
      script.setAttribute('data-ce-line', String(line));
    };
    const inlineLine = (script) => {
      const r = lineOfText(plain, script.textContent, searchFrom);
      searchFrom = r.end;
      return r.line;
    };

    for (const link of [...doc.querySelectorAll('link[rel~="stylesheet"][href]')]) {
      const p = resolveRef(dir, link.getAttribute('href'));
      if (!p) continue;
      const code = await this.text(p);
      if (code == null) { link.setAttribute('data-missing', p); continue; }
      const style = doc.createElement('style');
      style.setAttribute('data-href', p);
      for (const a of ['media']) if (link.hasAttribute(a)) style.setAttribute(a, link.getAttribute(a));
      style.textContent = `${await this.css(code, dirname(p))}\n/*# sourceURL=${p} */`;
      link.replaceWith(style);
    }
    for (const style of [...doc.querySelectorAll('style:not([data-href])')]) {
      style.textContent = await this.css(style.textContent, dir);
    }
    for (const el of [...doc.querySelectorAll('[style*="url("]')]) {
      el.setAttribute('style', await this.css(el.getAttribute('style'), dir));
    }

    for (const script of [...doc.querySelectorAll('script')]) {
      const isModule = (script.getAttribute('type') || '').trim() === 'module';
      const src = script.getAttribute('src');
      let code = null;
      let p = null;
      if (src) {
        p = resolveRef(dir, src);
        if (!p) continue; // CDN script: keep as is
        code = await this.text(p);
        if (code == null) {
          script.removeAttribute('src');
          script.textContent = `console.error(${JSON.stringify(`Preview: script not found: ${src}`)});`;
          continue;
        }
        script.removeAttribute('src');
        tag(script, p, 1);
      } else if (isModule) {
        code = script.textContent;
        tag(script, path, inlineLine(script));
      } else {
        tag(script, path, inlineLine(script));
        continue;
      }
      if (isModule) code = await this.moduleCode(code, p ? dirname(p) : dir, p ? [p] : []);
      script.textContent = (code + (p ? `\n//# sourceURL=${p}` : '')).replace(/<\/script/gi, '<\\/script');
    }

    const srcAttrs = [['img', 'src'], ['source', 'src'], ['video', 'src'], ['video', 'poster'], ['audio', 'src'],
      ['track', 'src'], ['input[type=image]', 'src'], ['link[rel~="icon"]', 'href'], ['object', 'data'], ['embed', 'src']];
    for (const [sel, attr] of srcAttrs) {
      for (const el of [...doc.querySelectorAll(`${sel}[${attr}]`)]) {
        const p = resolveRef(dir, el.getAttribute(attr));
        if (!p) continue;
        const data = await this.dataUrl(p);
        if (data) el.setAttribute(attr, data);
      }
    }
    for (const el of [...doc.querySelectorAll('[srcset]')]) {
      const parts = [];
      for (const cand of el.getAttribute('srcset').split(',')) {
        const [url, ...desc] = cand.trim().split(/\s+/);
        const p = resolveRef(dir, url);
        const data = p ? await this.dataUrl(p) : null;
        parts.push([data || url, ...desc].join(' '));
      }
      el.setAttribute('srcset', parts.join(', '));
    }

    const boot = doc.createElement('script');
    boot.textContent = bootScript(token, scrollY);
    head.insertBefore(boot, head.firstChild);
    const page = scriptLineMap('<!DOCTYPE html>\n' + doc.documentElement.outerHTML);
    /** page line ranges → file lines, for the last page built */
    this.lineMap = page.map;
    return page.html;
  }
}

/** Runs inside the preview: console capture, errors, link navigation, fetch bridge. */
function bootScript(token, scrollY) {
  return `(function(){
var T=${JSON.stringify(token)};
function send(m){m.__ce=T;try{parent.postMessage(m,'*')}catch(e){}}
function fmt(v,d){d=d||0;if(typeof v==='string')return d?JSON.stringify(v):v;if(v instanceof Error)return v.stack||(v.name+': '+v.message);
if(typeof v==='function')return '[Function: '+(v.name||'anonymous')+']';if(v&&typeof v==='object'){if(d>2)return Array.isArray(v)?'[Array]':'[Object]';
try{if(v instanceof Element)return '<'+v.tagName.toLowerCase()+(v.id?'#'+v.id:'')+'>';if(Array.isArray(v))return '[ '+v.map(function(x){return fmt(x,d+1)}).join(', ')+' ]';
return '{ '+Object.keys(v).map(function(k){return k+': '+fmt(v[k],d+1)}).join(', ')+' }'}catch(e){return String(v)}}return String(v)}
['log','info','warn','error','debug'].forEach(function(l){var o=console[l];console[l]=function(){var a=[].slice.call(arguments);send({type:'console',level:l==='debug'?'log':l,text:a.map(function(x){return fmt(x)}).join(' ')});if(o)o.apply(console,a)}});
addEventListener('error',function(e){var r=e.error,h=r&&r.name?r.name+': '+r.message:e.message,s=String((r&&r.stack)||'');
if(s.indexOf(h)===0)s=s.slice(h.length);s=s.replace(/^\\s+|\\s+$/g,'');
if(s)send({type:'console',level:'error',text:h+'\\n'+s.split('\\n').map(function(l){return '    '+l.replace(/^\\s+/,'')}).join('\\n')});
else send({type:'console',level:'error',text:h,at:e.lineno?{file:String(e.filename||''),line:e.lineno,col:e.colno||0}:null})});
addEventListener('unhandledrejection',function(e){var r=e.reason;send({type:'console',level:'error',text:'Uncaught (in promise) '+fmt(r)})});
document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a[href]');if(!a)return;var h=a.getAttribute('href');if(!h||/^(#|[a-z][a-z0-9+.-]*:|\\/\\/)/i.test(h))return;e.preventDefault();send({type:'navigate',href:h})},true);
var of=window.fetch,pend={},n=0;
window.fetch=function(input,init){var url=typeof input==='string'?input:(input&&input.url)||String(input);
if(/^(?:[a-z][a-z0-9+.-]*:|\\/\\/)/i.test(url))return of.apply(this,arguments);
return new Promise(function(res,rej){var id=++n;pend[id]={res:res,rej:rej};send({type:'fetch',id:id,url:url})})};
addEventListener('message',function(e){var d=e.data;if(!d||d.__ce!==T||d.type!=='fetch-result')return;var p=pend[d.id];if(!p)return;delete pend[d.id];
if(d.ok)p.res(new Response(d.body,{status:200,headers:{'Content-Type':d.mime}}));else p.res(new Response('Not found: '+d.url,{status:404,statusText:'Not Found'}))});
var st=0;addEventListener('scroll',function(){clearTimeout(st);st=setTimeout(function(){send({type:'scroll',y:scrollY})},120)},{passive:true});
${scrollY ? `addEventListener('load',function(){scrollTo(0,${Math.round(scrollY)})});` : ''}
})();`;
}

/** Wraps rendered Markdown in a readable page. */
export function markdownPage(bodyHtml, title, dark) {
  const c = dark
    ? { bg: '#16181d', fg: '#d7dae0', dim: '#9aa3b2', border: '#2b303b', code: '#20242c', link: '#7cb7ff' }
    : { bg: '#ffffff', fg: '#1f2328', dim: '#59636e', border: '#d1d9e0', code: '#f3f4f6', link: '#0969da' };
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title.replace(/</g, '&lt;')}</title>
<style>body{margin:0;padding:20px 18px 60px;background:${c.bg};color:${c.fg};font:15px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;max-width:860px;margin:0 auto;word-wrap:break-word}
h1,h2{border-bottom:1px solid ${c.border};padding-bottom:.3em}h1,h2,h3,h4{line-height:1.25;margin:1.4em 0 .6em}a{color:${c.link}}
code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.9em;background:${c.code};padding:.15em .35em;border-radius:5px}
pre{background:${c.code};padding:12px 14px;border-radius:8px;overflow:auto}pre code{background:none;padding:0}
blockquote{margin:0;padding:0 1em;color:${c.dim};border-left:4px solid ${c.border}}table{border-collapse:collapse;display:block;overflow:auto}
th,td{border:1px solid ${c.border};padding:6px 12px}img{max-width:100%}hr{border:0;border-top:1px solid ${c.border}}
input[type=checkbox]{margin-right:.4em}</style></head><body>${bodyHtml}</body></html>`;
}

export async function renderMarkdown(source) {
  const { marked } = await import('marked');
  return marked.parse(source, { gfm: true, breaks: false, async: false });
}
