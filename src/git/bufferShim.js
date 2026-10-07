// isomorphic-git (and its sha.js dependency) expect Node's global `Buffer`.
// This module must be imported BEFORE isomorphic-git: ES modules run in
// import order, so the global exists by the time git's code needs it.
import { Buffer } from 'buffer';

if (!globalThis.Buffer) globalThis.Buffer = Buffer;
