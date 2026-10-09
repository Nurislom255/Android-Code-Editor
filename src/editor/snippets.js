// editor/snippets.js — built-in snippets per language + your own from Settings
// (spec §2 Phase 2: "Data, not plugins").
//
// Syntax (CodeMirror's): ${1:name} is the first tab stop with default text
// "name"; equal names are linked (edit one, all change); ${0} or ${} is where
// the cursor ends. Swipe right / Tab jumps to the next stop.

import { snippetCompletion } from '@codemirror/autocomplete';

const JS = [
  ['log', 'console.log(${1:value});${0}', 'console.log'],
  ['fn', 'function ${1:name}(${2:params}) {\n\t${0}\n}', 'function'],
  ['afn', 'async function ${1:name}(${2:params}) {\n\t${0}\n}', 'async function'],
  ['arrow', 'const ${1:name} = (${2:params}) => {\n\t${0}\n};', 'arrow function'],
  ['fori', 'for (let ${1:i} = 0; ${1:i} < ${2:array}.length; ${1:i}++) {\n\t${0}\n}', 'indexed for loop'],
  ['forof', 'for (const ${1:item} of ${2:items}) {\n\t${0}\n}', 'for…of loop'],
  ['ife', 'if (${1:condition}) {\n\t${2}\n} else {\n\t${0}\n}', 'if / else'],
  ['tryc', 'try {\n\t${1}\n} catch (${2:err}) {\n\t${0}\n}', 'try / catch'],
  ['cls', 'class ${1:Name} {\n\tconstructor(${2}) {\n\t\t${0}\n\t}\n}', 'class'],
  ['imp', "import { ${2:name} } from '${1:module}';${0}", 'import'],
  ['qs', "document.querySelector('${1:selector}')${0}", 'querySelector'],
  ['ael', "${1:element}.addEventListener('${2:click}', (${3:event}) => {\n\t${0}\n});", 'addEventListener'],
  ['fetchj', "const ${1:res} = await fetch('${2:url}');\nconst ${3:data} = await ${1:res}.json();${0}", 'fetch JSON'],
  ['timeout', 'setTimeout(() => {\n\t${0}\n}, ${1:1000});', 'setTimeout'],
];

const SNIPPETS = {
  js: JS,
  python: [
    ['def', 'def ${1:name}(${2:args}):\n\t${0:pass}', 'function'],
    ['cls', 'class ${1:Name}:\n\tdef __init__(self${2:, args}):\n\t\t${0:pass}', 'class'],
    ['ifmain', "if __name__ == '__main__':\n\t${0:main()}", 'main guard'],
    ['fori', 'for ${1:i} in range(${2:n}):\n\t${0:pass}', 'for in range'],
    ['forin', 'for ${1:item} in ${2:items}:\n\t${0:pass}', 'for in'],
    ['tryc', 'try:\n\t${1:pass}\nexcept ${2:Exception} as ${3:e}:\n\t${0:raise}', 'try / except'],
    ['with', "with open(${1:path}, '${2:r}') as ${3:f}:\n\t${0:pass}", 'with open'],
    ['lc', '[${1:x} for ${1:x} in ${2:items}]${0}', 'list comprehension'],
    ['pr', 'print(${1})${0}', 'print'],
    ['inp', "${1:value} = input('${2:prompt}')${0}", 'input'],
  ],
  html: [
    ['html5', '<!DOCTYPE html>\n<html lang="${1:en}">\n<head>\n\t<meta charset="UTF-8">\n\t<meta name="viewport" content="width=device-width, initial-scale=1.0">\n\t<title>${2:Document}</title>\n\t<link rel="stylesheet" href="${3:style.css}">\n</head>\n<body>\n\t${0}\n\t<script src="${4:app.js}"></script>\n</body>\n</html>', 'HTML5 page'],
    ['link', '<link rel="stylesheet" href="${1:style.css}">${0}', 'stylesheet link'],
    ['script', '<script src="${1:app.js}"></script>${0}', 'script tag'],
    ['div', '<div class="${1}">${0}</div>', 'div'],
    ['a', '<a href="${1:#}">${2:text}</a>${0}', 'link'],
    ['img', '<img src="${1}" alt="${2}">${0}', 'image'],
    ['ul', '<ul>\n\t<li>${1}</li>\n\t<li>${0}</li>\n</ul>', 'list'],
    ['btn', '<button type="${1:button}" id="${2}">${3:Click}</button>${0}', 'button'],
    ['input', '<input type="${1:text}" id="${2}" placeholder="${3}">${0}', 'input'],
  ],
  css: [
    ['flex', 'display: flex;\njustify-content: ${1:center};\nalign-items: ${2:center};${0}', 'flexbox'],
    ['grid', 'display: grid;\ngrid-template-columns: ${1:repeat(3, 1fr)};\ngap: ${2:1rem};${0}', 'grid'],
    ['media', '@media (max-width: ${1:600px}) {\n\t${0}\n}', 'media query'],
    ['kf', '@keyframes ${1:name} {\n\tfrom { ${2} }\n\tto { ${0} }\n}', 'keyframes'],
    ['center', 'position: absolute;\ntop: 50%;\nleft: 50%;\ntransform: translate(-50%, -50%);${0}', 'absolute center'],
    ['var', 'var(--${1:name})${0}', 'custom property'],
  ],
  clike: [
    ['main', '#include <iostream>\n\nint main() {\n\t${0}\n\treturn 0;\n}', 'C++ main'],
    ['cmain', '#include <stdio.h>\n\nint main(void) {\n\t${0}\n\treturn 0;\n}', 'C main'],
    ['inc', '#include <${1:iostream}>${0}', '#include'],
    ['fori', 'for (int ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n\t${0}\n}', 'for loop'],
    ['cout', 'std::cout << ${1} << std::endl;${0}', 'cout'],
    ['printf', 'printf("${1:%d}\\n", ${2});${0}', 'printf'],
    ['struct', 'struct ${1:Name} {\n\t${0}\n};', 'struct'],
    ['psvm', 'public static void main(String[] args) {\n\t${0}\n}', 'Java main'],
    ['sout', 'System.out.println(${1});${0}', 'Java println'],
  ],
  markdown: [
    ['link', '[${1:text}](${2:url})${0}', 'link'],
    ['img', '![${1:alt}](${2:src})${0}', 'image'],
    ['code', '```${1:js}\n${0}\n```', 'code block'],
    ['table', '| ${1:A} | ${2:B} |\n| --- | --- |\n| ${3} | ${0} |', 'table'],
    ['task', '- [ ] ${0}', 'task item'],
  ],
};

const GROUP = {
  javascript: 'js', jsx: 'js', typescript: 'js', tsx: 'js',
  python: 'python', html: 'html', css: 'css', scss: 'css', less: 'css',
  c: 'clike', cpp: 'clike', java: 'clike', kotlin: 'clike', csharp: 'clike',
  markdown: 'markdown',
};

/** Parses the user snippets JSON from Settings; returns {languageId: [[label, body, detail]]}. */
export function parseUserSnippets(json) {
  if (!json || !json.trim()) return { snippets: {}, error: null };
  try {
    const data = JSON.parse(json);
    const out = {};
    for (const [lang, list] of Object.entries(data)) {
      if (!Array.isArray(list)) continue;
      out[lang] = list
        .filter((s) => s && typeof s.label === 'string' && typeof s.body === 'string')
        .map((s) => [s.label, s.body, s.detail || 'user snippet']);
    }
    return { snippets: out, error: null };
  } catch (err) {
    return { snippets: {}, error: `User snippets JSON is invalid: ${err.message}` };
  }
}

/** Completion source for a language: built-ins + user snippets ("*" = every language).
 * `builtins: false` when Emmet already covers them (HTML: div, a, img, ul…). */
export function snippetSource(languageId, userSnippets = {}, { builtins = true } = {}) {
  const list = [
    ...(builtins ? SNIPPETS[GROUP[languageId]] || [] : []),
    ...(userSnippets[languageId] || []),
    ...(userSnippets['*'] || []),
  ];
  if (!list.length) return null;
  const options = list.map(([label, body, detail]) => snippetCompletion(body, { label, detail, type: 'snippet', boost: -1 }));
  return (context) => {
    const word = context.matchBefore(/[\w$#]+/);
    if (!word || (word.from === word.to && !context.explicit)) return null;
    // Don't offer snippets inside strings/comments.
    return { from: word.from, options, validFor: /^[\w$#]*$/ };
  };
}

export function builtinSnippets(group) {
  return SNIPPETS[group] || [];
}
