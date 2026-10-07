// Table-driven tests for the automatic-semicolon rules (core/semicolons.js).
// `|` marks the cursor; text after it on the same line is what the editor
// auto-inserted after the cursor (closing brackets/quotes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wantsSemicolon, canStepOver, isBareJump, completionPlan, prefersNoSemicolons, scan } from '../../src/core/semicolons.js';

function split(src) {
  const i = src.indexOf('|');
  const before = src.slice(0, i);
  const rest = src.slice(i + 1);
  const nl = rest.indexOf('\n');
  return { before, after: nl < 0 ? rest : rest.slice(0, nl) };
}
const wants = (src, lang) => { const { before, after } = split(src); return wantsSemicolon(before, after, lang); };

const CPP_FN = (body) => `#include <iostream>\nint main() {\n    ${body}\n}`;
const JAVA_FN = (body) => `public class Main {\n  public static void main(String[] args) {\n    ${body}\n  }\n}`;
const CS_FN = (body) => `namespace App {\n  class P {\n    static void Main() {\n      ${body}\n    }\n  }\n}`;

// [description, language, source with |, expected]
const CASES = [
  // ---- C++: statements in a function body that need `;`
  ['C++ declaration with initializer', 'cpp', CPP_FN('int x = |'), true],
  ['C++ declaration, value typed', 'cpp', CPP_FN('int total = a + b|'), true],
  ['C++ declaration without initializer', 'cpp', CPP_FN('std::string name |'), true],
  ['C++ template type declaration', 'cpp', CPP_FN('std::vector<int> v = |'), true],
  ['C++ pointer declaration', 'cpp', CPP_FN('const char* p = |'), true],
  ['C++ return', 'cpp', CPP_FN('return |'), true],
  ['C++ return value', 'cpp', CPP_FN('return a * 2|'), true],
  ['C++ break', 'cpp', 'int f() {\n  while (1) {\n    break|\n  }\n}', true],
  ['C++ continue', 'cpp', 'int f() {\n  for (;;) {\n    continue|\n  }\n}', true],
  ['C++ throw', 'cpp', CPP_FN('throw std::runtime_error(|)'), true],
  ['C++ call with auto-closed paren', 'cpp', CPP_FN('printf(|)'), true],
  ['C++ call, cursor inside auto-closed string', 'cpp', CPP_FN('printf("hello|")'), true],
  ['C++ method call', 'cpp', CPP_FN('v.push_back(|)'), true],
  ['C++ assignment', 'cpp', CPP_FN('x = |'), true],
  ['C++ compound assignment', 'cpp', CPP_FN('x += |'), true],
  ['C++ increment', 'cpp', CPP_FN('i++|'), true],
  ['C++ cout chain', 'cpp', CPP_FN('std::cout << "x" << |'), true],
  ['C++ cin', 'cpp', CPP_FN('cin >> n|'), true],
  ['C++ using namespace (top level)', 'cpp', 'using namespace |', true],
  ['C++ using alias in body', 'cpp', CPP_FN('using T = |'), true],
  ['C++ brace initializer {|}', 'cpp', CPP_FN('int a[] = {|}'), true],
  ['C++ global with initializer', 'cpp', 'int counter = |', true],
  ['C++ struct field', 'cpp', 'struct Point {\n  int x |\n};', true],
  ['C++ pure virtual', 'cpp', 'class A {\n  virtual void f() = 0|\n};', true],
  ['C++ single-line if body', 'cpp', CPP_FN('if (x) return |'), true],
  ['C++ lambda assigned (statement continues after the body)', 'cpp', CPP_FN('auto f = [](int a) { return a; }|'), true],
  ['C++ call with a lambda argument', 'cpp', CPP_FN('std::sort(v.begin(), v.end(), [](int a, int b) { return a < b; }|)'), true],
  // ---- C++: never
  ['C++ #include', 'cpp', '#include <iostream>|', false],
  ['C++ #define', 'cpp', '#define MAX 10|', false],
  ['C++ function header (top level)', 'cpp', 'int main(|)', false],
  ['C++ method header in a class', 'cpp', 'class A {\n  void run(|)\n};', false],
  ['C++ global without initializer', 'cpp', 'int counter |', false],
  ['C++ if header', 'cpp', CPP_FN('if (x > 0|)'), false],
  ['C++ for header (semicolons inside)', 'cpp', CPP_FN('for (int i = 0; i < n; i++|)'), false],
  ['C++ while header', 'cpp', CPP_FN('while (running|)'), false],
  ['C++ else', 'cpp', CPP_FN('} else |'), false],
  ['C++ switch header', 'cpp', CPP_FN('switch (c|)'), false],
  ['C++ case label', 'cpp', CPP_FN('switch (c) {\n    case 1:|'), false],
  ['C++ access specifier', 'cpp', 'class A {\npublic:|\n};', false],
  ['C++ class header', 'cpp', 'class Shape : public Base |', false],
  ['C++ struct header', 'cpp', 'struct Point |', false],
  ['C++ namespace header', 'cpp', 'namespace geo |', false],
  ['C++ template header', 'cpp', 'template <typename T|>', false],
  ['C++ inside a line comment', 'cpp', CPP_FN('// return x|'), false],
  ['C++ inside a block comment', 'cpp', CPP_FN('/* int x = |'), false],
  ['C++ inside an unterminated string', 'cpp', CPP_FN('s = "abc|'), false],
  ['C++ line ending with a comma (multi-line args)', 'cpp', CPP_FN('foo(a,|'), false],
  ['C++ already has a semicolon', 'cpp', CPP_FN('x = 1;|'), false],
  ['C++ label', 'cpp', CPP_FN('retry:|'), false],
  ['C++ text after cursor that is not a closer', 'cpp', CPP_FN('x = |y'), false],
  ['C++ inside an initializer list on a new line', 'cpp', CPP_FN('int a[] = {\n      1, 2|\n    };'), false],
  ['C++ the cursor is inside a nested block', 'cpp', CPP_FN('if (x) { y = 1|}'), false],
  // ---- C
  ['C declaration', 'c', 'int main(void) {\n  int n = |\n}', true],
  ['C struct variable', 'c', 'int main(void) {\n  struct Point p = {|}\n}', true],
  ['C typedef', 'c', 'typedef unsigned long |', true],
  // ---- Java
  ['Java println', 'java', JAVA_FN('System.out.println(|)'), true],
  ['Java generic declaration', 'java', JAVA_FN('List<String> names = new ArrayList<>(|)'), true],
  ['Java field', 'java', 'public class A {\n  private int count |\n}', true],
  ['Java field with initializer', 'java', 'public class A {\n  private final int max = |\n}', true],
  ['Java import', 'java', 'import java.util.List|', true],
  ['Java package', 'java', 'package com.example|', true],
  ['Java method header', 'java', 'public class A {\n  public void run(|)\n}', false],
  ['Java annotation', 'java', 'public class A {\n  @Override|\n}', false],
  ['Java class header', 'java', 'public class Main |', false],
  ['Java lambda body continues the statement', 'java', JAVA_FN('list.forEach(x -> { print(x); }|)'), true],
  // ---- C#
  ['C# using directive', 'csharp', 'using System|', true],
  ['C# var declaration', 'csharp', CS_FN('var x = |'), true],
  ['C# call', 'csharp', CS_FN('Console.WriteLine(|)'), true],
  ['C# using statement header', 'csharp', CS_FN('using (var f = Open(|))'), false],
  ['C# foreach header', 'csharp', CS_FN('foreach (var x in xs|)'), false],
  ['C# property header', 'csharp', 'class P {\n  public int X |\n}', true],
  // ---- JavaScript / TypeScript
  ['JS const', 'javascript', 'const a = |', true],
  ['JS let without value', 'javascript', 'let count |', true],
  ['JS call at top level', 'javascript', 'console.log(|)', true],
  ['JS object literal {|}', 'javascript', 'const obj = {|}', true],
  ['JS arrow function with block body', 'javascript', 'const f = () => {}|', true],
  ['JS await', 'javascript', 'async function f() {\n  await load(|)\n}', true],
  ['JS import', 'javascript', "import x from 'y'|", true],
  ['JS export default value', 'javascript', 'export default config|', true],
  ['JS class field', 'javascript', 'class A {\n  count = |\n}', true],
  ['JS return in a callback', 'javascript', 'items.map((x) => {\n  return x * 2|\n});', true],
  ['JS template literal call', 'javascript', 'log(`a ${b}|`)', true],
  ['JS function declaration', 'javascript', 'function foo(|)', false],
  ['JS class method header', 'javascript', 'class A {\n  render(|)\n}', false],
  ['JS inside an object literal', 'javascript', 'const o = {\n  a: 1|\n};', false],
  ['JS inside a template literal', 'javascript', 'const s = `line ${x} |', false],
  ['JS if header', 'javascript', 'if (ready|)', false],
  ['JS export function', 'javascript', 'export function run(|)', false],
  ['JS label', 'javascript', 'outer:|', false],
  ['JS destructuring {|}', 'javascript', 'const {|} = obj', false],
  ['TS type alias', 'typescript', 'type Id = |', true],
  ['TS interface member', 'typescript', 'interface User {\n  name: string|\n}', true],
  ['TS interface header', 'typescript', 'export interface User |', false],
  ['TS typed let', 'typescript', 'let n: number = |', true],
  ['TSX return (|)', 'tsx', 'function App() {\n  return (|)\n}', true],
  ['TSX inside JSX parens', 'tsx', 'function App() {\n  return (\n    <div>|\n  );\n}', false],
  // ---- languages without semicolons
  ['Python never', 'python', 'x = |', false],
  ['Kotlin never', 'kotlin', 'val x = |', false],
  ['Go never', 'go', 'x := |', false],
];

test(`semicolon rules: ${CASES.length} cases`, () => {
  const failures = [];
  for (const [name, lang, src, expected] of CASES) {
    let got;
    try { got = wants(src, lang); } catch (err) { got = `threw ${err.message}`; }
    if (got !== expected) failures.push(`${name} [${lang}]: expected ${expected}, got ${got}\n      ${JSON.stringify(src)}`);
  }
  assert.equal(failures.length, 0, '\n' + failures.join('\n'));
});

test('Enter steps over the pending ; only when the statement is complete', () => {
  const cases = [
    // [before cursor, between cursor and the pending ;, lang, expected]
    ['  int x = 5', '', 'cpp', true],
    ['  int x = ', '', 'cpp', false],               // ends with =
    ['  std::cout << ', '', 'cpp', false],          // ends with <<
    ['  obj.', '', 'javascript', false],            // ends with .
    ['  p->', '', 'cpp', false],                    // ends with ->
    ['  total = a +', '', 'cpp', false],            // ends with an operator
    ['  foo(a', ')', 'cpp', true],                  // auto-closed paren counts
    ['  foo(', ')', 'cpp', false],                  // empty parens: Enter splits them
    ['  foo(a, ', ')', 'cpp', false],               // after a comma
    ['  printf("hi', '")', 'cpp', true],            // cursor inside an auto-closed string
    ['  const o = {', '}', 'javascript', false],    // Enter opens the block
    ['  i++', '', 'cpp', true],
    ['  return', '', 'cpp', true],
    ['  x = foo(bar(1', '))', 'javascript', true],
  ];
  for (const [before, between, lang, expected] of cases) {
    assert.equal(canStepOver(before, between, lang), expected, `${JSON.stringify(before)} | ${JSON.stringify(between)}`);
  }
});

test('break / continue / return alone + Enter get their ;', () => {
  assert.equal(isBareJump('void f() {\n  while (1) {\n    break', 'cpp'), true);
  assert.equal(isBareJump('function f() {\n  return', 'javascript'), true);
  assert.equal(isBareJump('void f() {\n  breakpoint', 'cpp'), false);
  assert.equal(isBareJump('def f():\n  return', 'python'), false);
});

test('complete statement plans', () => {
  const plan = (before, lang) => completionPlan(before, lang);
  assert.deepEqual(plan('int main() {\n  int x = 5', 'cpp'), { append: ';', block: false });
  assert.deepEqual(plan('int main() {\n  foo(a, b', 'cpp'), { append: ');', block: false });
  assert.deepEqual(plan('int main() {\n  if (x > 0)', 'cpp'), { append: ' {}', block: true });
  assert.deepEqual(plan('int main() {\n  for (int i = 0; i < n; i++)', 'cpp'), { append: ' {}', block: true });
  assert.deepEqual(plan('int main() {\n  x = 1;', 'cpp'), { append: '', block: false });
  assert.deepEqual(plan('int square(int x)', 'cpp'), { append: ' {}', block: true });
  assert.deepEqual(plan('struct Point', 'cpp'), { append: ' {};', block: true });
  assert.deepEqual(plan('class A {\n  render()', 'javascript'), { append: ' {}', block: true });
  assert.deepEqual(plan('const f = () =>', 'javascript'), { append: ' {};', block: true });
  assert.deepEqual(plan('if x > 0', 'python'), { append: ':', block: false });
  assert.deepEqual(plan('def run(self):', 'python'), { append: '', block: false });
  assert.deepEqual(plan('x = 1', 'python'), { append: '', block: false });
  assert.deepEqual(plan('x <- 1', 'r'), { append: '', block: false });
});

test('semicolon-less JS files are detected', () => {
  assert.equal(prefersNoSemicolons("import a from 'a'\nconst b = 1\nlet c = 2\nfoo(b)\nreturn c\n"), true);
  assert.equal(prefersNoSemicolons("import a from 'a';\nconst b = 1;\nlet c = 2;\nfoo(b);\n"), false);
  assert.equal(prefersNoSemicolons('const x = 1\n'), false, 'too little evidence');
});

test('scanner: scope and statement text', () => {
  const s = scan('class A {\n  int x;\n  void f() {\n    int y = 1;\n    foo(', 'cpp');
  assert.equal(s.scope, 'body');
  assert.equal(s.stmt.trim(), 'foo(');
  assert.equal(scan('class A {\n  ', 'cpp').scope, 'class');
  assert.equal(scan('namespace n {\n  ', 'cpp').scope, 'top');
  assert.equal(scan('', 'javascript').scope, 'body');
  assert.equal(scan('const s = "a { b', 'javascript').mode, 'string');
});
