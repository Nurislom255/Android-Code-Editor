// storage/projects.js — the list of projects the app knows about, and how to
// get a ProjectFs for each kind:
//
//   browser  a folder inside the browser's private storage (OPFS). Always
//            available, needs no permission, survives restarts. The default on
//            Android Chrome / the Capacitor WebView, where folder pickers don't
//            exist. Import/export (zip, files) moves code in and out.
//   folder   a real folder picked with showDirectoryPicker (desktop Chrome/Edge).
//            The handle is kept in IndexedDB; after a restart the browser asks
//            for permission again, which needs a tap (user activation).
//   device   a real path on the device via @capacitor/filesystem (Capacitor build).

import { HandleProjectFs, isOpfsSupported, fsError } from './projectFs.js';
import { CapacitorProjectFs, getCapacitorFilesystem } from './capacitorFs.js';
import { getAll, put, del } from './db.js';
import { validateName } from '../core/paths.js';

const BROWSER_ROOT = 'projects';

async function browserRoot() {
  if (!isOpfsSupported()) throw fsError('ENOTSUP', 'This browser has no private file storage (OPFS).');
  const opfs = await navigator.storage.getDirectory();
  return opfs.getDirectoryHandle(BROWSER_ROOT, { create: true });
}

export async function requestPersistentStorage() {
  // Asks the browser not to evict our storage under pressure. Chrome grants it
  // silently for installed/engaged sites; harmless if refused.
  try {
    if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) {
      return await navigator.storage.persist();
    }
    return true;
  } catch {
    return false;
  }
}

export async function listProjects() {
  let known = [];
  try { known = await getAll('projects'); } catch { /* no IndexedDB */ }
  // OPFS is the source of truth for browser projects.
  if (isOpfsSupported()) {
    try {
      const root = await browserRoot();
      const names = [];
      for await (const [name, h] of root.entries()) if (h.kind === 'directory') names.push(name);
      const byId = new Map(known.map((p) => [p.id, p]));
      for (const name of names) {
        const id = `browser:${name}`;
        if (!byId.has(id)) known.push({ id, kind: 'browser', name, lastOpened: 0 });
      }
      known = known.filter((p) => p.kind !== 'browser' || names.includes(p.name));
    } catch { /* ignore */ }
  }
  return known.sort((a, b) => (b.lastOpened || 0) - (a.lastOpened || 0));
}

export async function touchProject(project) {
  const { fs, ...rest } = project; // never try to store the live fs object
  try { await put('projects', { ...rest, lastOpened: Date.now() }); } catch { /* ignore */ }
}

export async function forgetProject(id) {
  try { await del('projects', id); } catch { /* ignore */ }
}

export async function createBrowserProject(name) {
  const problem = validateName(name);
  if (problem) throw new Error(problem);
  const root = await browserRoot();
  try {
    await root.getDirectoryHandle(name);
    throw fsError('EEXIST', `A project named "${name}" already exists.`);
  } catch (err) {
    if (err.code === 'EEXIST') throw err;
  }
  await root.getDirectoryHandle(name, { create: true });
  const project = { id: `browser:${name}`, kind: 'browser', name, lastOpened: Date.now() };
  await touchProject(project);
  return project;
}

export async function deleteBrowserProject(name) {
  const root = await browserRoot();
  await root.removeEntry(name, { recursive: true });
  await forgetProject(`browser:${name}`);
}

export async function pickFolderProject() {
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
  // Reuse the registry entry if this exact folder was opened before.
  const known = await listProjects();
  for (const p of known) {
    if (p.kind === 'folder' && p.handle && (await p.handle.isSameEntry(handle).catch(() => false))) {
      return { ...p, handle };
    }
  }
  const project = { id: `folder:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, kind: 'folder', name: handle.name, handle, lastOpened: Date.now() };
  await touchProject(project);
  return project;
}

export function deviceProject(rootPath, directory) {
  const name = rootPath.replace(/\/+$/, '').split('/').pop() || rootPath;
  return { id: `device:${directory || ''}:${rootPath}`, kind: 'device', name, rootPath, directory, lastOpened: Date.now() };
}

/** 'granted' | 'prompt' | 'denied' */
export async function permissionState(project) {
  if (project.kind !== 'folder') return 'granted';
  try {
    return await project.handle.queryPermission({ mode: 'readwrite' });
  } catch {
    return 'denied';
  }
}

/** Must run inside a click handler (needs user activation). */
export async function requestFolderPermission(project) {
  if (project.kind !== 'folder') return true;
  return (await project.handle.requestPermission({ mode: 'readwrite' })) === 'granted';
}

export async function fsForProject(project) {
  if (project.kind === 'browser') {
    const root = await browserRoot();
    const dir = await root.getDirectoryHandle(project.name);
    return new HandleProjectFs(dir, { kind: 'browser', id: project.id, name: project.name });
  }
  if (project.kind === 'folder') {
    if ((await permissionState(project)) !== 'granted') throw fsError('EACCES', 'Permission to this folder is needed again.');
    return new HandleProjectFs(project.handle, { kind: 'folder', id: project.id, name: project.name });
  }
  if (project.kind === 'device') {
    const plugin = getCapacitorFilesystem();
    if (!plugin) throw fsError('ENOTSUP', 'Device folders need the Capacitor Filesystem plugin (Android build).');
    return new CapacitorProjectFs(plugin, { rootPath: project.rootPath, directory: project.directory, id: project.id, name: project.name });
  }
  throw new Error(`Unknown project kind: ${project.kind}`);
}
