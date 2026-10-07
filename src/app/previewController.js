// app/previewController.js — owns the preview iframe: where it lives (beside
// the editor on wide screens, in the bottom panel on phones), rebuilding it
// when files change, and answering the page's messages (console output,
// link clicks, fetch() of project files).

import { h, debounce } from '../ui/dom.js';
import { PreviewBuilder, markdownPage, renderMarkdown, mimeFor } from '../run/preview.js';
import { resolveUrlRef as resolveRef, dirname, extname, basename } from '../core/paths.js';

export class PreviewController {
  /**
   * deps: {read(path) -> {text}|{bytes}|null, bottom, layout, getSettings, saveSettings, onConsole(entry), isDark()}
   */
  constructor(deps) {
    this.deps = deps;
    this.target = null; // {path, kind}
    this.token = '';
    this.scroll = new Map();
    this.builder = new PreviewBuilder((p) => deps.read(p));
    this.title = h('span.ptitle', 'Preview');
    this.frame = null;
    this.box = h('div.preview-box', { style: { display: 'flex', flexDirection: 'column', flex: '1', minHeight: '0' } },
      h('div.preview-toolbar', this.title,
        h('button.icon-btn.small', { type: 'button', title: 'Refresh', 'aria-label': 'Refresh preview', icon: 'refresh', onclick: () => this.refresh() }),
        this.placeBtn = h('button.icon-btn.small.wide-only', { type: 'button', title: 'Move preview', 'aria-label': 'Move preview between side and bottom', icon: 'split', onclick: () => this.togglePlacement() }),
        h('button.icon-btn.small', { type: 'button', title: 'Close preview', 'aria-label': 'Close preview', icon: 'close', onclick: () => this.close() })),
      this.empty = h('div.empty-note', 'Open an .html or .md file and press Run to preview it.'));
    this.later = debounce(() => this.refresh(), 650);
    deps.bottom.previewActions = () => [];
    deps.bottom.onShowPreview = () => { if (this.placement() === 'bottom') this.mount(); };
    window.addEventListener('message', (e) => this.onMessage(e));
  }

  placement() {
    const s = this.deps.getSettings();
    if (this.deps.layout.compact) return 'bottom';
    if (s.previewPlacement === 'auto') return this.deps.layout.size === 'expanded' ? 'side' : 'bottom';
    return s.previewPlacement;
  }

  get isOpen() { return !!this.target && this.visible(); }

  visible() {
    if (!this.target) return false;
    return this.mountedIn === 'side' ? !document.getElementById('preview-side').classList.contains('hidden')
      : this.deps.bottom.visible && this.deps.bottom.tab === 'preview';
  }

  /** Puts the preview box in the right container for the current layout. */
  mount() {
    const where = this.placement();
    const side = document.getElementById('preview-side');
    if (where === 'side') {
      if (this.box.parentNode !== side) side.append(this.box);
      side.classList.remove('hidden');
      document.getElementById('pane-divider').classList.remove('hidden');
    } else {
      if (this.box.parentNode !== this.deps.bottom.previewHost) this.deps.bottom.previewHost.append(this.box);
      side.classList.add('hidden');
      this.deps.onLayout && this.deps.onLayout();
      if (!this.deps.bottom.visible || this.deps.bottom.tab !== 'preview') this.deps.bottom.show('preview');
    }
    this.mountedIn = where;
    this.deps.onLayout && this.deps.onLayout();
  }

  togglePlacement() {
    const s = this.deps.getSettings();
    s.previewPlacement = this.placement() === 'side' ? 'bottom' : 'side';
    this.deps.saveSettings(s);
    if (this.mountedIn === 'side') document.getElementById('preview-side').classList.add('hidden');
    else this.deps.bottom.hide();
    this.mount();
  }

  close() {
    if (this.mountedIn === 'side') document.getElementById('preview-side').classList.add('hidden');
    else this.deps.bottom.hide();
    this.deps.onLayout && this.deps.onLayout();
    this.target = null;
    if (this.frame) { this.frame.remove(); this.frame = null; }
    this.empty.classList.remove('hidden');
    this.title.textContent = 'Preview';
  }

  async open(path) {
    const ext = extname(path);
    const kind = ext === '.md' || ext === '.markdown' ? 'markdown' : 'html';
    this.target = { path, kind };
    this.mount();
    await this.refresh();
  }

  /** Called on any edit/save; refreshes if the preview is showing. */
  changed() {
    if (this.target && this.visible() && this.deps.getSettings().previewAutoRefresh) this.later();
  }

  async refresh() {
    if (!this.target) return;
    const { path, kind } = this.target;
    const file = await this.deps.read(path);
    if (!file) {
      this.title.textContent = `${path} (not found)`;
      return;
    }
    const source = file.text != null ? file.text : new TextDecoder().decode(file.bytes);
    this.token = Math.random().toString(36).slice(2);
    let html;
    try {
      if (kind === 'markdown') {
        const body = await renderMarkdown(source);
        html = await this.builder.html(markdownPage(body, basename(path), this.deps.isDark()), path, { token: this.token, scrollY: this.scroll.get(path) || 0 });
      } else {
        html = await this.builder.html(source, path, { token: this.token, scrollY: this.scroll.get(path) || 0 });
      }
    } catch (err) {
      this.deps.onConsole({ level: 'error', text: `Preview failed: ${err.message}` });
      return;
    }
    // A fresh iframe each time: no state leaks between runs, and the old page's
    // timers/listeners die with it.
    const frame = h('iframe.preview-frame', {
      title: `Preview of ${path}`,
      sandbox: 'allow-scripts allow-modals allow-forms allow-popups allow-pointer-lock allow-downloads',
      allow: 'clipboard-write',
    });
    frame.srcdoc = html;
    if (this.frame) this.frame.replaceWith(frame);
    else this.box.append(frame);
    this.frame = frame;
    this.empty.classList.add('hidden');
    this.title.textContent = path;
  }

  async onMessage(e) {
    if (!this.frame || e.source !== this.frame.contentWindow) return;
    const d = e.data;
    if (!d || d.__ce !== this.token) return;
    const dir = dirname(this.target.path);
    if (d.type === 'console') {
      this.deps.onConsole({ level: d.level, text: d.text, fromPreview: true });
    } else if (d.type === 'scroll') {
      this.scroll.set(this.target.path, d.y);
    } else if (d.type === 'navigate') {
      const p = resolveRef(dir, d.href);
      if (p && /\.(html?|md|markdown)$/i.test(p) && (await this.deps.read(p))) this.open(p);
      else this.deps.onConsole({ level: 'warn', text: `Preview: can't open link "${d.href}" (only project .html/.md files).` });
    } else if (d.type === 'fetch') {
      const p = resolveRef(dir, d.url);
      const f = p ? await this.deps.read(p) : null;
      const reply = { __ce: this.token, type: 'fetch-result', id: d.id, url: d.url };
      if (!f) Object.assign(reply, { ok: false });
      else Object.assign(reply, { ok: true, mime: mimeFor(p), body: f.text != null ? f.text : f.bytes.slice().buffer });
      this.frame.contentWindow.postMessage(reply, '*');
    }
  }
}
