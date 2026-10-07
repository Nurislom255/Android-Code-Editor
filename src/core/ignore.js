// core/ignore.js — what project search / quick open skip (spec §2: respects
// .gitignore and the default ignore list).
//
// Two layers:
//  1. A plain name list from Settings (".git node_modules build"): any path
//     segment with that exact name is skipped. This is also what the file tree
//     hides by default.
//  2. .gitignore files, using the `ignore` package (a faithful implementation of
//     git's own rules: negation with "!", "dir/" patterns, "**", anchoring).
//     A .gitignore in a subfolder only applies below that folder, like in git.

import ignore from 'ignore';

export class IgnoreRules {
  constructor(names = [], matchers = []) {
    this.names = new Set(names);
    this.matchers = matchers; // {base:string, ig}
  }

  /** Returns a new rule set that also applies the .gitignore found in `dir`. */
  withGitignore(dir, text) {
    const ig = ignore({ allowRelativePaths: true }).add(text);
    return new IgnoreRules([...this.names], [...this.matchers, { base: dir, ig }]);
  }

  isNameIgnored(name) {
    return this.names.has(name);
  }

  /** @param {string} path project-relative path */
  isIgnored(path, isDir = false) {
    for (const seg of path.split('/')) if (this.names.has(seg)) return true;
    for (const { base, ig } of this.matchers) {
      if (base && !(path === base || path.startsWith(base + '/'))) continue;
      const rel = base ? path.slice(base.length + 1) : path;
      if (!rel) continue;
      if (ig.ignores(isDir ? rel + '/' : rel)) return true;
    }
    return false;
  }
}
