// ui/gitPanel.js — Source Control panel (spec §2 Phase 2 "Git panel").
// Status, diff, stage / unstage / discard, commit, branches, log, push/pull.

import { h, icon, formatTime } from './dom.js';
import { prompt, choose, confirm, toast, popupMenu, showModal } from './overlays.js';
import { showDiff } from './panels.js';
import { loadSecret, saveSecret, deleteSecret } from '../storage/secrets.js';
import { basename, dirname } from '../core/paths.js';

let gitModule = null;
export async function loadGit() {
  if (!gitModule) gitModule = await import('../git/gitService.js');
  return gitModule;
}

export class GitPanel {
  /**
   * deps: {getFs, getProject, getSettings, saveSettings, openFile(path), bufferText(path)->string|null,
   *        afterWorkingTreeChange(), afterCommit(), onStatus(map)}
   */
  constructor(el, deps) {
    this.el = el;
    this.deps = deps;
    this.service = null;
    this.serviceFs = null;
    this.status = [];
    this.badges = new Map();
    this.header = h('div.panel-header', h('span.title', 'Source control'),
      h('button.icon-btn.small', { type: 'button', title: 'Refresh', 'aria-label': 'Refresh', icon: 'refresh', onclick: () => this.refresh() }),
      h('button.icon-btn.small', { type: 'button', title: 'More', 'aria-label': 'More git actions', icon: 'more', onclick: (e) => this.moreMenu(e) }));
    this.body = h('div.panel-scroll');
    el.append(this.header, this.body);
  }

  async svc() {
    const fs = this.deps.getFs();
    if (!fs) return null;
    if (!this.service || this.serviceFs !== fs) {
      const { GitService } = await loadGit();
      this.service = new GitService(fs);
      this.serviceFs = fs;
    }
    return this.service;
  }

  /** HEAD text of a file, for gutter markers; null when not tracked / no repo. */
  async headText(path) {
    const fs = this.deps.getFs();
    if (!fs || !(await fs.exists('.git'))) return null;
    const s = await this.svc();
    return s.readHead(path);
  }

  /** Re-reads git state. Overlapping calls are common (save + focus +
   * panel switch); only the newest one renders. */
  async refresh() {
    const gen = this.gen = (this.gen || 0) + 1;
    const stale = () => gen !== this.gen;
    const s = await this.svc();
    if (stale()) return;
    if (!s) { this.body.textContent = ''; this.body.append(h('div.panel-note', 'Open a project to use git.')); return; }
    let isRepo = false;
    try { isRepo = await s.isRepo(); } catch { /* ignore */ }
    if (stale()) return;
    if (!isRepo) {
      this.body.textContent = '';
      this.badges = new Map();
      this.deps.onStatus(this.badges, null);
      this.body.append(
        h('div.panel-note', 'This project is not a git repository yet. Local commits, branches and diffs work offline; push/pull need the network.'),
        h('div.form-stack',
          h('button.btn.btn-primary', { type: 'button', onclick: () => this.init() }, 'Initialize repository'),
          h('button.btn', { type: 'button', onclick: () => this.deps.cloneIntoNewProject() }, 'Clone a repository…')),
      );
      return;
    }
    let branch = null, status = [], log = [];
    try {
      s.resetCache();
      [branch, status, log] = await Promise.all([s.currentBranch(), s.status(), s.log(30)]);
    } catch (err) {
      if (stale()) return;
      this.body.textContent = '';
      this.body.append(h('div.panel-note', `Git error: ${err.message}`));
      return;
    }
    if (stale()) return;
    this.body.textContent = '';
    this.status = status;
    this.badges = new Map(status.map((e) => [e.path, e.staged === 'A' || e.unstaged === 'U' ? 'U' : (e.unstaged || e.staged)]));
    this.deps.onStatus(this.badges, branch);

    const message = h('textarea.input.input-multiline', { rows: 3, placeholder: `Commit message (Ctrl+Enter to commit on "${branch || 'detached'}")`, 'aria-label': 'Commit message', style: { minHeight: '70px', fontFamily: 'var(--font-ui)' } });
    message.value = this.draft || '';
    message.addEventListener('input', () => { this.draft = message.value; });
    message.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.commit(message.value); } });
    const staged = status.filter((e) => e.staged);
    const changes = status.filter((e) => e.unstaged);

    this.body.append(
      h('div.form-stack',
        h('div.toggle-row',
          h('button.btn.btn-small', { type: 'button', title: 'Switch or create branch', onclick: () => this.branchMenu(), html: icon('branch', 14) }, ` ${branch || '(detached)'}`),
          h('span.spacer'),
          h('button.btn.btn-small', { type: 'button', onclick: () => this.pull() }, 'Pull'),
          h('button.btn.btn-small', { type: 'button', onclick: () => this.push() }, 'Push')),
        message,
        h('button.btn.btn-primary', { type: 'button', onclick: () => this.commit(message.value), disabled: !staged.length && !changes.length },
          staged.length ? `Commit ${staged.length} staged file${staged.length === 1 ? '' : 's'}` : changes.length ? 'Stage all & commit' : 'Nothing to commit')),
      h('div.git-section-title', `Staged changes (${staged.length})`),
      ...staged.map((e) => this.fileRow(e, true)),
      h('div.git-section-title', h('span', `Changes (${changes.length})`), h('span.spacer'),
        changes.length ? h('button.btn.btn-small.btn-ghost', { type: 'button', onclick: () => this.stageAll() }, 'Stage all') : null),
      ...changes.map((e) => this.fileRow(e, false)),
      h('div.git-section-title', 'Recent commits'),
      ...(log.length ? log.map((c) => h('div.commit-row',
        h('div.cmsg', c.commit.message.split('\n')[0]),
        h('div.cmeta', `${c.oid.slice(0, 7)} · ${c.commit.author.name} · ${formatTime(c.commit.author.timestamp * 1000)}`))) : [h('div.panel-note', 'No commits yet.')]),
    );
  }

  fileRow(e, stagedSide) {
    const letter = stagedSide ? e.staged : e.unstaged;
    const name = basename(e.path);
    const dir = dirname(e.path);
    return h('div.git-file',
      h('span.git-status', { class: letter }, letter),
      h('span.gname', { title: e.path, onclick: () => this.showDiff(e, stagedSide) }, name, dir ? h('span.gdir', dir) : null),
      stagedSide
        ? h('button.icon-btn.small', { type: 'button', title: 'Unstage', 'aria-label': `Unstage ${e.path}`, onclick: () => this.op(() => this.service.unstage(e.path)) }, '−')
        : [
          h('button.icon-btn.small', { type: 'button', title: 'Discard changes', 'aria-label': `Discard changes to ${e.path}`, icon: 'undo', onclick: () => this.discard(e) }),
          h('button.icon-btn.small', { type: 'button', title: 'Stage', 'aria-label': `Stage ${e.path}`, onclick: () => this.op(() => this.service.stage(e.path)) }, '+'),
        ]);
  }

  async op(fn) {
    try { await fn(); } catch (err) { toast(`Git: ${err.message}`, 'error'); }
    await this.refresh();
  }

  async init() {
    const s = await this.svc();
    await this.op(() => s.init());
    toast('Initialized an empty git repository.', 'success');
    this.deps.afterWorkingTreeChange();
  }

  async stageAll() {
    await this.op(() => this.service.stageAll(this.status));
  }

  async discard(e) {
    const ok = await confirm('Discard changes?', `This throws away your changes to ${e.path}${e.unstaged === 'U' ? ' (the untracked file is deleted)' : ''}. Local history may still have a copy.`, 'Discard', 'danger');
    if (!ok) return;
    await this.op(() => this.service.discard(e.path, e));
    this.deps.afterWorkingTreeChange();
  }

  async showDiff(e, stagedSide) {
    const s = this.service;
    let oldText, newText;
    if (stagedSide) {
      oldText = (await s.readHead(e.path)) ?? '';
      newText = e.staged === 'D' ? '' : ((await s.readIndexOrHead(e.path)) ?? '');
    } else {
      oldText = e.unstaged === 'U' ? '' : ((await s.readIndexOrHead(e.path)) ?? '');
      newText = e.unstaged === 'D' ? '' : (this.deps.bufferText(e.path) ?? (await this.deps.getFs().readText(e.path)));
    }
    let m = null;
    m = showDiff(`${e.path} — ${stagedSide ? 'staged' : 'working tree'}`, oldText, newText, [
      e.unstaged !== 'D' ? h('button.btn', { type: 'button', onclick: () => { m.close(); this.deps.openFile(e.path); } }, 'Open file') : null,
    ]);
  }

  async author() {
    const st = this.deps.getSettings();
    if (st.gitAuthorName && st.gitAuthorEmail) return { name: st.gitAuthorName, email: st.gitAuthorEmail };
    const name = await prompt({ title: 'Your name for commits', label: 'Author name', value: st.gitAuthorName });
    if (!name) return null;
    const email = await prompt({ title: 'Your email for commits', label: 'Author email', value: st.gitAuthorEmail, validate: (v) => (/@/.test(v) ? null : 'That doesn\'t look like an email address.') });
    if (!email) return null;
    st.gitAuthorName = name;
    st.gitAuthorEmail = email;
    this.deps.saveSettings(st);
    return { name, email };
  }

  async commit(message) {
    const msg = (message || '').trim();
    if (!msg) { toast('Write a commit message first.', 'warn'); return; }
    await this.deps.saveAllBeforeCommit();
    const author = await this.author();
    if (!author) return;
    try {
      if (!this.status.some((e) => e.staged)) await this.service.stageAll(this.status);
      const oid = await this.service.commit(msg, author);
      this.draft = '';
      toast(`Committed ${oid.slice(0, 7)}: ${msg.split('\n')[0]}`, 'success');
    } catch (err) {
      toast(`Commit failed: ${err.message}`, 'error');
    }
    await this.refresh();
    this.deps.afterCommit();
  }

  async branchMenu() {
    const { list, current } = await this.service.branches();
    const items = [
      ...list.map((b) => ({ label: b === current ? `● ${b}` : b, branch: b })),
      { label: '+ Create new branch…', create: true },
    ];
    const pick = await this.deps.pick(items, { placeholder: 'Switch to branch' });
    if (!pick) return;
    if (pick.create) {
      const name = await prompt({ title: 'New branch', label: 'Branch name', value: '', validate: (v) => (/^[\w./-]+$/.test(v) && !v.includes('..') ? null : 'Use letters, digits, - _ . / only.') });
      if (!name) return;
      await this.op(() => this.service.createBranch(name, true));
      toast(`Created and switched to ${name}.`, 'success');
      return;
    }
    if (pick.branch === current) return;
    if (this.deps.hasDirtyBuffers()) {
      const c = await choose({ title: 'Unsaved files', message: 'Save your open files before switching branches?', buttons: [{ id: 'save', label: 'Save all & switch', kind: 'primary' }, { id: 'cancel', label: 'Cancel' }] });
      if (c !== 'save') return;
      await this.deps.saveAllBeforeCommit();
    }
    try {
      await this.service.checkout(pick.branch);
      toast(`Switched to ${pick.branch}.`, 'success');
    } catch (err) {
      toast(err.code === 'CheckoutConflictError'
        ? `Can't switch: your uncommitted changes to ${(err.data && err.data.filepaths || []).join(', ')} would be overwritten. Commit or discard them first.`
        : `Switch failed: ${err.message}`, 'error');
    }
    await this.refresh();
    this.deps.afterWorkingTreeChange();
  }

  async credentials(url) {
    let host = 'default';
    try { host = new URL(url).host; } catch { /* keep default */ }
    let cred = await loadSecret(`git:${host}`);
    if (!cred) {
      const token = await prompt({ title: `Access token for ${host}`, label: 'Personal access token (stored encrypted on this device)', value: '', placeholder: 'ghp_…' });
      if (!token) return null;
      const username = host.includes('gitlab') ? 'oauth2' : token;
      const password = host.includes('gitlab') ? token : 'x-oauth-basic';
      cred = { username, password };
      await saveSecret(`git:${host}`, cred);
    }
    return { cred, host };
  }

  async remoteUrl() {
    const remotes = await this.service.remotes();
    let origin = remotes.find((r) => r.remote === 'origin');
    if (!origin) {
      const url = await prompt({ title: 'Add remote "origin"', label: 'Repository URL (https)', placeholder: 'https://github.com/you/repo.git', validate: (v) => (/^https?:\/\//.test(v) ? null : 'Use an https:// URL (SSH is not available in the browser).') });
      if (!url) return null;
      await this.service.addRemote('origin', url);
      origin = { remote: 'origin', url };
    }
    return origin.url;
  }

  async network(kind) {
    const url = await this.remoteUrl();
    if (!url) return;
    const auth = await this.credentials(url);
    if (!auth) return;
    const st = this.deps.getSettings();
    const progress = toastProgress(`${kind === 'push' ? 'Pushing' : 'Pulling'}…`);
    try {
      if (kind === 'push') {
        const res = await this.service.push({ corsProxy: st.gitCorsProxy, auth: auth.cred, onProgress: progress.update });
        if (res && res.ok === false) throw new Error(res.error || 'push rejected');
        toast('Pushed.', 'success');
      } else {
        const author = await this.author();
        if (!author) return;
        await this.service.pull({ corsProxy: st.gitCorsProxy, auth: auth.cred, author, onProgress: progress.update });
        toast('Pulled.', 'success');
        this.deps.afterWorkingTreeChange();
      }
    } catch (err) {
      if (/401|403|auth/i.test(err.message)) await deleteSecret(`git:${auth.host}`);
      toast(`${kind === 'push' ? 'Push' : 'Pull'} failed: ${err.message}${/fetch|network|CORS/i.test(err.message) ? ' (check the network and the CORS proxy in Settings → Git)' : ''}`, 'error');
    } finally {
      progress.done();
    }
    await this.refresh();
  }

  push() { return this.network('push'); }
  pull() { return this.network('pull'); }

  moreMenu(e) {
    const r = e.currentTarget.getBoundingClientRect();
    popupMenu([
      { label: 'Refresh', icon: 'refresh', run: () => this.refresh() },
      { label: 'Pull', icon: 'download', run: () => this.pull() },
      { label: 'Push', icon: 'upload', run: () => this.push() },
      { label: 'Set remote URL…', icon: 'edit', run: async () => {
        const url = await prompt({ title: 'Remote "origin"', label: 'Repository URL (https)', value: (await this.service.remotes()).find((x) => x.remote === 'origin')?.url || '' });
        if (url) await this.op(() => this.service.addRemote('origin', url));
      } },
      { label: 'Forget saved tokens', icon: 'trash', run: async () => {
        const remotes = await this.service.remotes();
        for (const rm of remotes) { try { await deleteSecret(`git:${new URL(rm.url).host}`); } catch { /* ignore */ } }
        toast('Saved tokens removed.', 'success');
      } },
      '-',
      { label: 'About git here', icon: 'info', run: () => showModal('Git in CodeEditor', h('div.modal-message',
        h('p', 'Commits, branches, staging and diffs run locally with isomorphic-git, a JavaScript implementation of git — no server needed.'),
        h('p', 'Push, pull and clone need the network. Browsers block direct requests to GitHub\'s git endpoints (CORS), so they go through the proxy set in Settings → Git. Use a proxy you trust, or host your own.'),
        h('p', 'Tokens are encrypted with a non-extractable device key before being stored.'))) },
    ], { x: r.left, y: r.bottom });
  }
}

function toastProgress(label) {
  const host = document.getElementById('toasts');
  const el = h('div.toast', label);
  host.append(el);
  return {
    update: (p) => { if (p && p.phase) el.textContent = `${label} ${p.phase}${p.total ? ` ${Math.round((p.loaded / p.total) * 100)}%` : ''}`; },
    done: () => el.remove(),
  };
}
