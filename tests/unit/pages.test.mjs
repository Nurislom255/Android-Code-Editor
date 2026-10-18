// Which web page loads a script (core/pages.js): Run on app.js shows index.html.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scriptsOf, pagesNear, PAGE_ONLY } from '../../src/core/pages.js';

test('scriptsOf: the project scripts a page loads, as project paths', () => {
  const html = `<script src="main.js"></script>
    <script defer src='js/app.js?v=2'></script>
    <script type="module" src="./lib/x.mjs"></script>
    <script src="https://cdn.example.com/lib.js"></script>
    <script src="//cdn.example.com/other.js"></script>
    <!-- <script src="old.js"></script> -->
    <script>inline()</script>
    <script src="/root.js"></script>`;
  assert.deepEqual(scriptsOf('site/index.html', html), ['site/main.js', 'site/js/app.js', 'site/lib/x.mjs', 'root.js']);
  assert.deepEqual(scriptsOf('index.html', '<script src="../up.js"></script>'), ['up.js']); // like a server: never above the root
});

test('pagesNear: the same folder first (index.html first), then folders above, then the rest', () => {
  const all = ['about.html', 'index.html', 'src/app.js', 'src/demo.html', 'src/index.html', 'other/page.html', 'style.css'];
  assert.deepEqual(pagesNear('src/app.js', all), ['src/index.html', 'src/demo.html', 'index.html', 'about.html', 'other/page.html']);
  assert.deepEqual(pagesNear('app.js', all), ['index.html', 'about.html', 'src/index.html', 'other/page.html', 'src/demo.html']); // elsewhere: index pages first
});

test('PAGE_ONLY: errors about names that exist only in a web page', () => {
  assert.match('ReferenceError: document is not defined', PAGE_ONLY);
  assert.match('ReferenceError: alert is not defined', PAGE_ONLY);
  assert.doesNotMatch('ReferenceError: foo is not defined', PAGE_ONLY);
  assert.doesNotMatch('ReferenceError: mydocument is not defined', PAGE_ONLY);
});
