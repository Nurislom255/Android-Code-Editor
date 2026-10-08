// Table-driven tests for the automatic-semicolon rules (core/semicolons.js).
// `|` marks the cursor; the character just before it is the one just typed,
// text after it is what the editor auto-inserted (closing brackets).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoSemicolon, scopeAt, enterStepsOver, isBareJump, codePart, completionPlan, prefersNoSemicolons } from '../../src/core/semicolons.js';

function wants(src, lang, scope = 'body') {
  const i = src.indexOf('|');
  const before = src.slice(0, i);
  return autoSemicolon(before, src.slice(i + 1), before.slice(-1), lang, scope);
}

// [source with |, language, scope, expected]
const CASES = [
  // ---- obvious statements in a function body
  ['    int x =|', 'cpp', 'body', true],
  ['    std::vector<int> v =|', 'cpp', 'body', true],
  ['    const char* p =|', 'cpp', 'body', true],
  ['    auto it =|', 'cpp', 'body', true],
  ['    unsigned long long n =|', 'cpp', 'body', true],
  ['    int arr[3] =|', 'cpp', 'body', true],
  ['    x =|', 'cpp', 'body', true],
  ['    x +=|', 'cpp', 'body', true],
  ['    mask <<=|', 'cpp', 'body', true],
  ['    this->n =|', 'cpp', 'body', true],
  ['    arr[i] =|', 'cpp', 'body', true],
  ['    *p =|', 'cpp', 'body', true],
  ['    returnValue =|', 'cpp', 'body', true],
  ['    struct Point p =|', 'c', 'body', true],
  ['    return |', 'cpp', 'body', true],
  ['    throw |', 'cpp', 'body', true],
  ['    foo(|)', 'cpp', 'body', true],
  ['    v.push_back(|)', 'cpp', 'body', true],
  ['    std::sort(|)', 'cpp', 'body', true],
  ['    p->run(|)', 'cpp', 'body', true],
  ['    std::cout <<|', 'cpp', 'body', true],
  ['    cin >>|', 'cpp', 'body', true],
  ['    i++|', 'cpp', 'body', true],
  ['    n--|', 'cpp', 'body', true],
  ['    using T =|', 'cpp', 'body', true],
  ['    printf(|)', 'c', 'body', true],
  // ---- globals and class fields: only with an initializer
  ['int counter =|', 'cpp', 'top', true],
  ['  int x =|', 'cpp', 'class', true],
  ['  private int count =|', 'java', 'class', true],
  ['  count =|', 'javascript', 'class', true],
  // ---- never
  ['    if (|)', 'cpp', 'body', false],
  ['    for (int i =|', 'cpp', 'body', false],
  ['    for (int i = 0; i < n; i++|)', 'cpp', 'body', false],
  ['    while (|)', 'cpp', 'body', false],
  ['    switch (|)', 'cpp', 'body', false],
  ['    } else if (|)', 'cpp', 'body', false],
  ['    x ==|', 'cpp', 'body', false],
  ['    a <=|', 'cpp', 'body', false],
  ['    a !=|', 'cpp', 'body', false],
  ['int main(|)', 'cpp', 'top', false],
  ['Foo::Foo(|)', 'cpp', 'top', false],
  ['foo(|)', 'cpp', 'top', false],
  ['  void run(|)', 'cpp', 'class', false],
  ['  render(|)', 'javascript', 'class', false],
  ['  return |', 'cpp', 'class', false],
  ['    int b =|', 'cpp', 'none', false],        // a default argument on its own line
  ['  a: foo(|)', 'javascript', 'none', false],  // inside an object literal
  ['    // x =|', 'cpp', 'body', false],
  ['#define X =|', 'cpp', 'top', false],
  ['    x =|y', 'cpp', 'body', false],           // text after the cursor
  ['    T& operator=|', 'cpp', 'class', false],
  ['    else x =|', 'cpp', 'body', false],
  ['    return x =|', 'cpp', 'body', false],
  ['    retur |', 'cpp', 'body', false],
  ['    foo(a, |)', 'cpp', 'body', false],       // a space inside the call
  ['    int x;|', 'cpp', 'body', false],
  ['    if (x) foo(|)', 'cpp', 'body', false],
  // ---- JS / TS
  ['const a =|', 'javascript', 'body', true],
  ['let { a, b } =|', 'javascript', 'body', true],
  ['export const x =|', 'javascript', 'body', true],
  ['console.log(|)', 'javascript', 'body', true],
  ['document.querySelector("#x").addEventListener(|)', 'javascript', 'body', true],
  ['  .then(|)', 'javascript', 'body', true],
  ['await load(|)', 'javascript', 'body', true],
  ['function foo(|)', 'javascript', 'body', false],
  ['let n: number =|', 'typescript', 'body', true],
  ['type Id =|', 'typescript', 'body', true],
  // ---- Java / C#
  ['    System.out.println(|)', 'java', 'body', true],
  ['    String s =|', 'java', 'body', true],
  ['    Console.WriteLine(|)', 'csharp', 'body', true],
  ['    var x =|', 'csharp', 'body', true],
  // ---- languages without semicolons
  ['x =|', 'python', 'body', false],
  ['val x =|', 'kotlin', 'body', false],
  ['x :=|', 'go', 'body', false],
];

test(`automatic semicolon rules: ${CASES.length} cases`, () => {
  const failures = [];
  for (const [src, lang, scope, expected] of CASES) {
    const got = wants(src, lang, scope);
    if (got !== expected) failures.push(`${JSON.stringify(src)} [${lang}, ${scope}]: expected ${expected}, got ${got}`);
  }
  assert.equal(failures.length, 0, '\n' + failures.join('\n'));
});

test('Enter steps over the pending ; unless the line continues', () => {
  const cases = [
    // [line before the cursor, text between cursor and ;, expected]
    ['    int x = 5', '', true],
    ['    int x = ', '', false],
    ['    std::cout << ', '', false],
    ['    obj.', '', false],
    ['    p->', '', false],
    ['    total = a +', '', false],
    ['    foo(a', ')', true],
    ['    foo(', ')', false],
    ['    foo(a, ', ')', false],
    ['    printf("hi', '")', true],
    ['    i++', '', true],
    ['    return', '', true],
    ['    ', '', false],
  ];
  for (const [before, between, expected] of cases) assert.equal(enterStepsOver(before, between), expected, `${JSON.stringify(before)} | ${JSON.stringify(between)}`);
});

test('break / continue / return alone get their ; on Enter', () => {
  assert.equal(isBareJump('        break'), true);
  assert.equal(isBareJump('  return  '), true);
  assert.equal(isBareJump('  breakpoint'), false);
  assert.equal(isBareJump('  return x'), false);
});

test('code part of a line', () => {
  assert.equal(codePart('  x = 1 // set x  '), '  x = 1');
  assert.equal(codePart('  url = "http://x" // c'), '  url = "http://x"');
  assert.equal(codePart('  foo();   '), '  foo();');
});

test('complete statement plans', () => {
  const plan = completionPlan;
  assert.deepEqual(plan('    int x = 5', 'cpp', 'body'), { append: ';', block: false });
  assert.deepEqual(plan('    foo(a, b', 'cpp', 'body'), { append: ');', block: false });
  assert.deepEqual(plan('    foo(a, [b', 'javascript', 'body'), { append: ']);', block: false });
  assert.deepEqual(plan('    if (x > 0)', 'cpp', 'body'), { append: ' {}', block: true });
  assert.deepEqual(plan('    } else if (x)', 'cpp', 'body'), { append: ' {}', block: true });
  assert.deepEqual(plan('    for (int i = 0; i < n; i++)', 'cpp', 'body'), { append: ' {}', block: true });
  assert.deepEqual(plan('    x = 1;', 'cpp', 'body'), { append: '', block: false });
  assert.deepEqual(plan('int square(int x)', 'cpp', 'top'), { append: ' {}', block: true });
  assert.deepEqual(plan('int x = foo(1)', 'cpp', 'top'), { append: ';', block: false });
  assert.deepEqual(plan('struct Point', 'cpp', 'top'), { append: ' {};', block: true });
  assert.deepEqual(plan('  render()', 'javascript', 'class'), { append: ' {}', block: true });
  assert.deepEqual(plan('const f = () =>', 'javascript', 'body'), { append: ' {};', block: true });
  assert.deepEqual(plan('    if (x) return y', 'cpp', 'body'), { append: ';', block: false });
  assert.deepEqual(plan('if x > 0', 'python', 'body'), { append: ':', block: false });
  assert.deepEqual(plan('def run(self):', 'python', 'body'), { append: '', block: false });
  assert.deepEqual(plan('x = 1', 'python', 'body'), { append: '', block: false });
  assert.deepEqual(plan('#include <vector>', 'cpp', 'top'), { append: '', block: false });
  assert.deepEqual(plan('x <- 1', 'r', 'body'), { append: '', block: false });
});

test('semicolon-less JS files are detected', () => {
  assert.equal(prefersNoSemicolons("import a from 'a'\nconst b = 1\nlet c = 2\nfoo(b)\nreturn c\n"), true);
  assert.equal(prefersNoSemicolons("import a from 'a';\nconst b = 1;\nlet c = 2;\nfoo(b);\n"), false);
  assert.equal(prefersNoSemicolons('const x = 1\n'), false, 'too little evidence');
});

test('where a line sits: function body, class body, top level or none', () => {
  const cases = [
    // [code above the line, language, expected]
    ['int main() {\n', 'cpp', 'body'],
    ['int main() {\n    int a = 1;\n', 'cpp', 'body'],
    ['', 'cpp', 'top'],
    ['#include <vector>\n', 'cpp', 'top'],
    ['struct Point {\n', 'cpp', 'class'],
    ['class A : public B {\npublic:\n', 'cpp', 'class'],
    ['namespace geo {\n', 'cpp', 'top'],
    ['void f(int a,\n', 'cpp', 'none'],                    // parameter list
    ['int a[] = {\n', 'cpp', 'none'],                      // initializer
    ['enum Color {\n', 'cpp', 'none'],
    ['void A::run() const {\n    if (x) {\n', 'cpp', 'body'],
    ['int main() {\n    auto f = [](int x) {\n', 'cpp', 'body'],
    ['int main() {\n    std::sort(v.begin(), v.end(), [](int a, int b) {\n', 'cpp', 'body'],
    ['int main() {\n    // a { in a comment\n    s = "}";\n', 'cpp', 'body'],
    ['', 'javascript', 'body'],
    ['class A {\n', 'javascript', 'class'],
    ['class A {\n  render() {\n', 'javascript', 'body'],
    ['const o = {\n', 'javascript', 'none'],
    ['items.forEach((x) => {\n', 'javascript', 'body'],
    ['const s = `\n', 'javascript', 'body'],                // (inside a template literal: the line itself is text)
    ['public class Main {\n', 'java', 'class'],
    ['public class Main {\n  void run() {\n', 'java', 'body'],
    ['class A {\n  void m() {\n    t = new Thread(new Runnable() {\n', 'java', 'class'],
  ];
  for (const [text, lang, expected] of cases) assert.equal(scopeAt(text, lang), expected, `${JSON.stringify(text)} [${lang}]`);
});
