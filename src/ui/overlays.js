// ui/overlays.js — modal dialogs, toasts and popup menus.
//
// Replaces window.prompt()/confirm(): those block the whole page, look out of
// place, and inside some Android WebViews aren't implemented at all. All of
// these return Promises, so callers write `const name = await prompt(...)`.

import { h, icon } from './dom.js';

const root = () => document.getElementById('overlay-root');

let openModals = 0;
export const isModalOpen = () => openModals > 0;

function modal(content, { onClose, className = '' } = {}) {
  const backdrop = h('div.modal-backdrop');
  const box = h(`div.modal${className ? '.' + className : ''}`, { role: 'dialog', 'aria-modal': 'true' }, content);
  backdrop.append(box);
  root().append(backdrop);
  openModals++;
  const prevFocus = document.activeElement;
  const close = (value) => {
    if (!backdrop.isConnected) return;
    backdrop.remove();
    openModals--;
    document.removeEventListener('keydown', onKey, true);
    if (prevFocus && prevFocus.focus && document.contains(prevFocus)) prevFocus.focus({ preventScroll: true });
    onClose && onClose(value);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); }
  };
  document.addEventListener('keydown', onKey, true);
  backdrop.addEventListener('pointerdown', (e) => { if (e.target === backdrop) close(null); });
  return { box, close };
}

/**
 * @param {{title:string, message?:string|Node, buttons:{id:string,label:string,kind?:string}[]}} o
 * @returns {Promise<string|null>} the chosen button id, null when dismissed
 */
export function choose({ title, message = '', buttons }) {
  return new Promise((resolve) => {
    const btns = buttons.map((b) => h(`button.btn${b.kind ? '.btn-' + b.kind : ''}`, { 'data-id': b.id, onclick: () => m.close(b.id) }, b.label));
    const m = modal([
      h('h2.modal-title', title),
      message ? h('div.modal-message', message) : null,
      h('div.modal-buttons', btns),
    ], { onClose: resolve });
    (btns.find((b, i) => buttons[i].kind === 'primary') || btns[0]).focus();
  });
}

export async function confirm(title, message, okLabel = 'OK', kind = 'primary') {
  return (await choose({ title, message, buttons: [{ id: 'cancel', label: 'Cancel' }, { id: 'ok', label: okLabel, kind }] })) === 'ok';
}

/**
 * @returns {Promise<string|null>}
 */
export function prompt({ title, label = '', value = '', placeholder = '', okLabel = 'OK', validate = null, selectBase = true, multiline = false }) {
  return new Promise((resolve) => {
    const input = multiline
      ? h('textarea.input.input-multiline', { rows: 6, placeholder, spellcheck: 'false', autocapitalize: 'off' })
      : h('input.input', { type: 'text', placeholder, spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', autocorrect: 'off' });
    input.value = value;
    const error = h('div.field-error');
    const submit = () => {
      const v = input.value.trim();
      if (!v) { error.textContent = 'Please enter a value.'; return; }
      const problem = validate && validate(v);
      if (problem) { error.textContent = problem; return; }
      m.close(v);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (!multiline || e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); }
    });
    const m = modal([
      h('h2.modal-title', title),
      h('label.field', label ? h('span.field-label', label) : null, input, error),
      h('div.modal-buttons',
        h('button.btn', { onclick: () => m.close(null) }, 'Cancel'),
        h('button.btn.btn-primary', { onclick: submit }, okLabel)),
    ], { onClose: resolve });
    requestAnimationFrame(() => {
      input.focus();
      // Select the file name without its extension, like desktop file managers.
      const dot = value.lastIndexOf('.');
      const slash = value.lastIndexOf('/');
      if (selectBase && dot > slash + 1 && input.setSelectionRange) input.setSelectionRange(slash + 1, dot);
      else if (input.select) input.select();
    });
  });
}

/** Shows arbitrary content in a modal; returns {close, box}. */
export function showModal(title, body, { className = '', actions = null, onClose } = {}) {
  const m = modal([
    h('div.modal-head', h('h2.modal-title', title), h('button.icon-btn', { 'aria-label': 'Close', icon: 'close', onclick: () => m.close(null) })),
    h('div.modal-body', body),
    actions ? h('div.modal-buttons', actions) : null,
  ], { className, onClose });
  return m;
}

// ---- toasts -----------------------------------------------------------------

export function toast(message, kind = 'info', duration = 3500) {
  const host = document.getElementById('toasts');
  if (!host) return;
  const el = h(`div.toast.toast-${kind}`, { role: kind === 'error' ? 'alert' : 'status' }, h('span.toast-text', message));
  el.addEventListener('click', () => el.remove());
  host.append(el);
  while (host.children.length > 4) host.firstChild.remove();
  setTimeout(() => { el.classList.add('leaving'); setTimeout(() => el.remove(), 300); }, kind === 'error' ? Math.max(duration, 6000) : duration);
}

// ---- popup menus -------------------------------------------------------------

/**
 * @param {{label:string, icon?:string, run:()=>void, danger?:boolean, disabled?:boolean, hint?:string}[]|'-'} items
 * @param {{x:number,y:number}} at  viewport coordinates
 */
export function popupMenu(items, at) {
  closeMenus();
  const menu = h('div.popup-menu', { role: 'menu' });
  for (const it of items) {
    if (it === '-') { menu.append(h('div.menu-sep')); continue; }
    if (!it) continue;
    menu.append(h('button.menu-item', {
      role: 'menuitem',
      class: it.danger ? 'danger' : '',
      disabled: it.disabled,
      onclick: () => { closeMenus(); it.run(); },
    }, it.icon ? h('span.menu-icon', { html: icon(it.icon, 16) }) : h('span.menu-icon'), h('span.menu-label', it.label), it.hint ? h('span.menu-hint', it.hint) : null));
  }
  const layer = h('div.menu-layer', { onpointerdown: (e) => { if (e.target === layer) closeMenus(); } }, menu);
  root().append(layer);
  const r = menu.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  menu.style.left = `${Math.max(8, Math.min(at.x, vw - r.width - 8))}px`;
  menu.style.top = `${Math.max(8, at.y + r.height > vh - 8 ? at.y - r.height : at.y)}px`;
  const first = menu.querySelector('.menu-item:not([disabled])');
  if (first) first.focus({ preventScroll: true });
  menu.addEventListener('keydown', (e) => {
    const list = [...menu.querySelectorAll('.menu-item:not([disabled])')];
    const i = list.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length].focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length].focus(); }
    if (e.key === 'Escape') closeMenus();
  });
  return menu;
}

export function closeMenus() {
  for (const el of document.querySelectorAll('.menu-layer')) el.remove();
}
