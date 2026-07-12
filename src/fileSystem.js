// fileSystem.js
//
// WHY THIS FILE EXISTS:
// The rest of the app (editor.js, main.js) should never call browser-specific
// or Capacitor-specific file APIs directly. Instead it talks to a single
// FileSystemProvider interface. Today that interface has one real
// implementation (BrowserFSProvider, using the File System Access API).
// When you wrap this in Capacitor, you add a CapacitorFSProvider that
// implements the same four methods using @capacitor/filesystem, and
// nothing else in the app changes. This is "dependency inversion" —
// the app depends on an interface, not a concrete implementation.
//
// ALTERNATIVE REJECTED: calling showDirectoryPicker()/Capacitor.Filesystem
// directly from main.js. Faster to write today, but every future platform
// (a second wrapper, a Node-based desktop build, etc.) would mean hunting
// through UI code for file calls to swap out. One seam is cheaper long-term.

export class FileSystemProvider {
  async pickFolder() { throw new Error('pickFolder() not implemented'); }
  async listTree(rootHandle) { throw new Error('listTree() not implemented'); }
  async readFile(fileHandle) { throw new Error('readFile() not implemented'); }
  async writeFile(fileHandle, contents) { throw new Error('writeFile() not implemented'); }
}

/**
 * Real implementation using the browser's native File System Access API.
 * Supported in desktop Chrome/Edge today. NOT supported in Safari, Firefox,
 * or (currently) inside most Android WebViews — which is exactly why this
 * sits behind an interface rather than being called directly.
 */
export class BrowserFSProvider extends FileSystemProvider {
  async pickFolder() {
    if (!isFileSystemAccessSupported()) {
      throw new Error('File System Access API not supported in this browser.');
    }
    // Persists only for this session unless you also store the handle
    // in IndexedDB (handles themselves ARE structured-cloneable, so a
    // "remember last folder" feature is a realistic next step).
    //
    // mode: 'readwrite' (not the default 'read') matters: without it, this
    // grants read-only access, and the FIRST write later (Save, Create
    // File, Create Folder) has to silently request a permission UPGRADE.
    // That upgrade needs an active "user activation" window (Chromium
    // gives you a few seconds after a click) — and by the time a write
    // happens, you've often just spent several seconds typing into a
    // window.prompt() dialog, so that window has already expired. Asking
    // for readwrite right here, still inside the activation window from
    // the "Open Folder" click itself, settles it once and avoids that.
    return await window.showDirectoryPicker({ mode: 'readwrite' });
  }

  /** Recursively walks a directory handle into a plain tree the UI can render. */
  async listTree(dirHandle, path = '') {
    const entries = [];
    for await (const [name, handle] of dirHandle.entries()) {
      const entryPath = path ? `${path}/${name}` : name;
      if (handle.kind === 'directory') {
        entries.push({
          name, kind: 'directory', handle, path: entryPath,
          children: await this.listTree(handle, entryPath),
        });
      } else {
        entries.push({ name, kind: 'file', handle, path: entryPath });
      }
    }
    // directories first, then alphabetical — matches how most file trees read
    entries.sort((a, b) =>
      a.kind === b.kind ? a.name.localeCompare(b.name) : (a.kind === 'directory' ? -1 : 1)
    );
    return entries;
  }

  async readFile(fileHandle) {
    const file = await fileHandle.getFile();
    return await file.text();
  }

  async writeFile(fileHandle, contents) {
    const writable = await fileHandle.createWritable();
    await writable.write(contents);
    await writable.close();
  }

  /** Creates (or opens, if it already exists) a file inside dirHandle. */
  async createFile(dirHandle, name) {
    return await dirHandle.getFileHandle(name, { create: true });
  }

  /** Creates (or opens, if it already exists) a subfolder inside dirHandle. */
  async createFolder(dirHandle, name) {
    return await dirHandle.getDirectoryHandle(name, { create: true });
  }

  /** Convenience: create a file AND write its initial contents in one call. */
  async writeNewFile(dirHandle, name, contents) {
    const fileHandle = await this.createFile(dirHandle, name);
    await this.writeFile(fileHandle, contents);
    return fileHandle;
  }
}

/**
 * Fallback used when no real folder access exists (Safari, most WebView
 * wrappers, or Capacitor before you've wired CapacitorFSProvider in).
 * Files live only in memory for the session; "opening" means picking files
 * via <input type=file>, "saving" means triggering a browser download.
 * This is intentionally honest about its limits rather than pretending to
 * be real folder access.
 */
export class InMemoryFSProvider extends FileSystemProvider {
  constructor() {
    super();
    this._counter = 0;
  }

  async openFilesFromPicker(fileList) {
    const results = [];
    for (const file of fileList) {
      const contents = await file.text();
      results.push({
        name: file.name,
        kind: 'file',
        path: file.name,
        // a fake "handle": writeFile() below recognizes this shape
        handle: { __memory: true, id: ++this._counter, lastContents: contents },
      });
    }
    return results;
  }

  async readFile(fakeHandle) {
    return fakeHandle.lastContents ?? '';
  }

  async writeFile(fakeHandle, contents) {
    fakeHandle.lastContents = contents;
    // No real disk to write to — trigger a download so the user has a copy.
    const blob = new Blob([contents], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fakeHandle.suggestedName || 'untitled.txt';
    a.click();
    URL.revokeObjectURL(url);
  }
}

/**
 * "Save As" — not tied to a directory handle, so it lives outside the
 * provider classes. Uses the native save-file picker where available
 * (lets you choose ANY folder, not just the one you opened); falls back
 * to a plain download when the picker API isn't supported.
 */
export async function saveAs(suggestedName, contents) {
  if ('showSaveFilePicker' in window) {
    const handle = await window.showSaveFilePicker({ suggestedName });
    const writable = await handle.createWritable();
    await writable.write(contents);
    await writable.close();
    return handle;
  }
  const blob = new Blob([contents], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  a.click();
  URL.revokeObjectURL(url);
  return null;
}

/**
 * Defensive re-check for write permission, meant to be called as the very
 * FIRST thing inside a click handler — before any window.prompt()/alert(),
 * before any other await. requestPermission() itself needs a live
 * user-activation window, so the earlier it runs relative to the actual
 * click, the more likely it succeeds without re-prompting the user.
 * Cheap to call even when permission is already granted (queryPermission
 * resolves instantly in that case, no dialog shown).
 */
export async function ensureWritePermission(handle) {
  if (!handle || typeof handle.queryPermission !== 'function') return true; // e.g. InMemory fake handles
  const opts = { mode: 'readwrite' };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  return (await handle.requestPermission(opts)) === 'granted';
}

export function isFileSystemAccessSupported() {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

/**
 * TODO (Capacitor phase): add and return a CapacitorFSProvider here when
 * `window.Capacitor` is detected, using @capacitor/filesystem under the hood.
 * Nothing in editor.js or main.js should need to change when you do this.
 */
export function detectProvider() {
  if (isFileSystemAccessSupported()) return new BrowserFSProvider();
  return new InMemoryFSProvider();
}
