// core/paths.js — POSIX-style path helpers for project-relative paths.
// Project paths never start with "/" ("src/app.js"); the project root is "".

export function normalize(path) {
  const out = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (out.length === 0) return null; // escapes the project root
      out.pop();
    } else out.push(part);
  }
  return out.join('/');
}

export function join(...parts) {
  return normalize(parts.filter((p) => p !== '' && p != null).join('/')) ?? '';
}

export function dirname(path) {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

export function basename(path) {
  const i = path.lastIndexOf('/');
  return i < 0 ? path : path.slice(i + 1);
}

export function extname(path) {
  const base = basename(path);
  const i = base.lastIndexOf('.');
  return i <= 0 ? '' : base.slice(i).toLowerCase();
}

export function isExternalUrl(ref) {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref);
}

/**
 * Resolves a reference found in a file (href/src/url()/import specifier)
 * against that file's folder. "/x" means project root. Returns null for
 * external URLs, data: URLs, anchors and paths escaping the project.
 */
export function resolveRef(fromDir, ref) {
  if (!ref) return null;
  const clean = ref.trim().split(/[?#]/)[0];
  if (!clean || isExternalUrl(ref.trim())) return null;
  let decoded = clean;
  try { decoded = decodeURIComponent(clean); } catch { /* keep raw */ }
  if (decoded.startsWith('/')) return normalize(decoded);
  return normalize((fromDir ? fromDir + '/' : '') + decoded);
}

export function relative(fromDir, toPath) {
  const a = fromDir ? fromDir.split('/') : [];
  const b = toPath.split('/');
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return [...Array(a.length - i).fill('..'), ...b.slice(i)].join('/');
}

/** Rejects names that can't be a single path segment. */
export function validateName(name) {
  if (!name || !name.trim()) return 'Name cannot be empty.';
  if (name.includes('/') || name.includes('\\')) return 'Use a single name, without slashes.';
  if (name === '.' || name === '..') return 'That name is reserved.';
  if (/[\u0000-\u001f<>:"|?*]/.test(name)) return 'Name contains characters most file systems reject.';
  return null;
}

/**
 * Resolves like a browser resolves a relative URL on a web server rooted at
 * the project: "../" above the root stays at the root. Used by the preview,
 * which must behave like the page would when deployed.
 */
export function resolveUrlRef(fromDir, ref) {
  if (!ref || isExternalUrl(ref.trim())) return null;
  try {
    const u = new URL(ref.trim(), `http://project.invalid/${fromDir ? fromDir + '/' : ''}`);
    if (u.host !== 'project.invalid') return null;
    const p = decodeURIComponent(u.pathname).replace(/^\/+/, '');
    return p || null;
  } catch {
    return null;
  }
}
