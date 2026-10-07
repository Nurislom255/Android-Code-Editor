// editor/languages.js — which syntax mode a file gets, loaded on demand.
//
// Each `load()` is a dynamic import(), so the bundler (esbuild with code
// splitting) puts every language in its own small file that is only fetched
// the first time you open, say, a .py file. First load of the app stays fast.
//
// "lezer: true" languages have a real incremental parser (CodeMirror's Lezer —
// the web counterpart of tree-sitter in the spec), which powers syntax error
// markers, outline, sticky scroll and expand-selection. The others use
// CodeMirror's "legacy" stream modes: highlighting only.

import { StreamLanguage, LanguageDescription, LanguageSupport } from '@codemirror/language';

const legacy = (loader) => async () => StreamLanguage.define(await loader());

export const LANGUAGES = [
  { id: 'javascript', name: 'JavaScript', ext: ['js', 'mjs', 'cjs'], lezer: true, runnable: true,
    load: async () => (await import('@codemirror/lang-javascript')).javascript() },
  { id: 'jsx', name: 'JavaScript JSX', ext: ['jsx'], lezer: true,
    load: async () => (await import('@codemirror/lang-javascript')).javascript({ jsx: true }) },
  { id: 'typescript', name: 'TypeScript', ext: ['ts', 'mts', 'cts'], lezer: true,
    load: async () => (await import('@codemirror/lang-javascript')).javascript({ typescript: true }) },
  { id: 'tsx', name: 'TypeScript JSX', ext: ['tsx'], lezer: true,
    load: async () => (await import('@codemirror/lang-javascript')).javascript({ jsx: true, typescript: true }) },
  { id: 'html', name: 'HTML', ext: ['html', 'htm', 'xhtml'], lezer: true, previewable: true,
    load: async () => (await import('@codemirror/lang-html')).html() },
  { id: 'css', name: 'CSS', ext: ['css'], lezer: true,
    load: async () => (await import('@codemirror/lang-css')).css() },
  { id: 'scss', name: 'SCSS', ext: ['scss'],
    load: legacy(async () => (await import('@codemirror/legacy-modes/mode/css')).sCSS) },
  { id: 'less', name: 'Less', ext: ['less'],
    load: legacy(async () => (await import('@codemirror/legacy-modes/mode/css')).less) },
  { id: 'json', name: 'JSON', ext: ['json', 'jsonc', 'webmanifest', 'babelrc', 'eslintrc'], lezer: true,
    load: async () => (await import('@codemirror/lang-json')).json() },
  { id: 'markdown', name: 'Markdown', ext: ['md', 'markdown', 'mdown'], lezer: true, previewable: true,
    load: async () => {
      const { markdown, markdownLanguage } = await import('@codemirror/lang-markdown');
      return markdown({ base: markdownLanguage, codeLanguages: codeBlockLanguage });
    } },
  { id: 'python', name: 'Python', ext: ['py', 'pyw', 'pyi'], lezer: true,
    load: async () => (await import('@codemirror/lang-python')).python() },
  { id: 'c', name: 'C', ext: ['c', 'h'], lezer: true,
    load: async () => (await import('@codemirror/lang-cpp')).cpp() },
  { id: 'cpp', name: 'C++', ext: ['cpp', 'cc', 'cxx', 'c++', 'hpp', 'hh', 'hxx', 'ino'], lezer: true,
    load: async () => (await import('@codemirror/lang-cpp')).cpp() },
  { id: 'java', name: 'Java', ext: ['java'], lezer: true,
    load: async () => (await import('@codemirror/lang-java')).java() },
  { id: 'kotlin', name: 'Kotlin', ext: ['kt', 'kts'],
    load: legacy(async () => (await import('@codemirror/legacy-modes/mode/clike')).kotlin) },
  { id: 'csharp', name: 'C#', ext: ['cs'],
    load: legacy(async () => (await import('@codemirror/legacy-modes/mode/clike')).csharp) },
  { id: 'dart', name: 'Dart', ext: ['dart'],
    load: legacy(async () => (await import('@codemirror/legacy-modes/mode/clike')).dart) },
  { id: 'go', name: 'Go', ext: ['go'],
    load: legacy(async () => (await import('@codemirror/legacy-modes/mode/go')).go) },
  { id: 'rust', name: 'Rust', ext: ['rs'],
    load: legacy(async () => (await import('@codemirror/legacy-modes/mode/rust')).rust) },
  { id: 'swift', name: 'Swift', ext: ['swift'],
    load: legacy(async () => (await import('@codemirror/legacy-modes/mode/swift')).swift) },
  { id: 'php', name: 'PHP', ext: ['php'],
    load: legacy(async () => (await import('@codemirror/legacy-modes/mode/clike')).php) },
  { id: 'ruby', name: 'Ruby', ext: ['rb'],
    load: legacy(async () => (await import('@codemirror/legacy-modes/mode/ruby')).ruby) },
  { id: 'lua', name: 'Lua', ext: ['lua'],
    load: legacy(async () => (await import('@codemirror/legacy-modes/mode/lua')).lua) },
  { id: 'shell', name: 'Shell', ext: ['sh', 'bash', 'zsh'], names: ['.bashrc', '.zshrc', '.profile'],
    load: legacy(async () => (await import('@codemirror/legacy-modes/mode/shell')).shell) },
  { id: 'yaml', name: 'YAML', ext: ['yml', 'yaml'],
    load: legacy(async () => (await import('@codemirror/legacy-modes/mode/yaml')).yaml) },
  { id: 'toml', name: 'TOML', ext: ['toml'],
    load: legacy(async () => (await import('@codemirror/legacy-modes/mode/toml')).toml) },
  { id: 'xml', name: 'XML', ext: ['xml', 'svg', 'plist', 'xsd'],
    load: legacy(async () => (await import('@codemirror/legacy-modes/mode/xml')).xml) },
  { id: 'sql', name: 'SQL', ext: ['sql'],
    load: legacy(async () => (await import('@codemirror/legacy-modes/mode/sql')).standardSQL) },
  { id: 'dockerfile', name: 'Dockerfile', ext: [], names: ['Dockerfile', 'Containerfile'],
    load: legacy(async () => (await import('@codemirror/legacy-modes/mode/dockerfile')).dockerFile) },
  { id: 'properties', name: 'Properties', ext: ['ini', 'cfg', 'conf', 'properties', 'env', 'editorconfig', 'gitconfig'],
    names: ['.editorconfig', '.env', '.gitconfig', '.npmrc'],
    load: legacy(async () => (await import('@codemirror/legacy-modes/mode/properties')).properties) },
  { id: 'diff', name: 'Diff', ext: ['diff', 'patch'],
    load: legacy(async () => (await import('@codemirror/legacy-modes/mode/diff')).diff) },
];

export const PLAIN = { id: 'plain', name: 'Plain Text', ext: ['txt'], load: async () => [] };

const byId = new Map([...LANGUAGES, PLAIN].map((l) => [l.id, l]));

export function languageById(id) {
  return byId.get(id) || PLAIN;
}

export function languageForName(fileName) {
  const base = fileName.split('/').pop();
  for (const l of LANGUAGES) if (l.names && l.names.includes(base)) return l;
  const dot = base.lastIndexOf('.');
  const ext = dot >= 0 ? base.slice(dot + 1).toLowerCase() : '';
  if (!ext) return PLAIN;
  for (const l of LANGUAGES) if (l.ext.includes(ext)) return l;
  return PLAIN;
}

const loaded = new Map();
/** Loads (once) and returns the CodeMirror extension for a language id. */
export function loadLanguage(id) {
  if (!loaded.has(id)) {
    const p = languageById(id).load().catch((err) => {
      loaded.delete(id);
      console.warn(`language ${id} failed to load`, err);
      return [];
    });
    loaded.set(id, p);
  }
  return loaded.get(id);
}

/** Fenced code blocks in Markdown: ```js ... ``` get highlighted too.
 * Must answer synchronously; a LanguageDescription lets Markdown load the
 * language in the background and re-highlight when it arrives. */
const fencedCache = new Map();
function codeBlockLanguage(info) {
  const name = info.trim().split(/\s+/)[0].toLowerCase();
  const alias = { js: 'javascript', ts: 'typescript', py: 'python', sh: 'shell', bash: 'shell', 'c++': 'cpp', yml: 'yaml', md: 'markdown', kt: 'kotlin', node: 'javascript' };
  const lang = byId.get(alias[name] || name) || LANGUAGES.find((l) => l.ext.includes(name));
  if (!lang || lang.id === 'markdown') return null;
  if (!fencedCache.has(lang.id)) {
    fencedCache.set(lang.id, LanguageDescription.of({
      name: lang.name,
      load: async () => {
        const ext = await loadLanguage(lang.id);
        return ext instanceof LanguageSupport ? ext : new LanguageSupport(ext);
      },
    }));
  }
  return fencedCache.get(lang.id);
}
