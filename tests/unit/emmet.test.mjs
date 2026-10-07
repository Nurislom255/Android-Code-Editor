// Emmet: when an abbreviation is offered, and how its output becomes a
// CodeMirror snippet (core/emmetRules.js + the real emmet package).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import expand, { resolveConfig } from 'emmet';
import {
  HTML_TAGS, fieldMarker, toSnippetTemplate, plainExpansion, simplifyBoilerplate,
  markupAbbreviationOk, stylesheetAbbreviationOk, insideCssBlock,
} from '../../src/core/emmetRules.js';

const aliases = new Set(Object.keys(resolveConfig({ type: 'markup', syntax: 'html' }).snippets));
const isKnown = (n) => HTML_TAGS.has(n) || aliases.has(n);
const OPTIONS = { 'output.field': fieldMarker, 'output.indent': '\t', 'stylesheet.fuzzySearchMinScore': 0.5 };

test('markup abbreviations that are offered', () => {
  for (const [abbr, prefix] of [
    ['!', ''], ['div', ''], ['div', '  '], ['section', '<main>'], ['ul>li*3', ''], ['div.card>ul>li*3', '    '],
    ['.row>.col*3', ''], ['#app', ''], ['p{Hello}', ''], ['a[href=#]', ''], ['link:css', ''], ['input:email', ''],
    ['ul>li*3', 'some text '], ['nav>ul>li.item$*4>a', ''], ['h1', ''], ['btn', ''],
  ]) assert.equal(markupAbbreviationOk(abbr, prefix, isKnown), true, `${abbr} after ${JSON.stringify(prefix)}`);
});

test('markup abbreviations that are not offered', () => {
  for (const [abbr, prefix] of [
    ['time', 'Meet me at the '],  // a tag name in the middle of a sentence
    ['table', 'the '],
    ['hello', ''],                // not a tag
    ['ul>', ''],                  // still typing the operator
    ['ul>li*3+', ''],
    ['p', ''],                    // one-letter tag: only when asked for
    ['!', 'text '],               // ! in a sentence
    ['e.g', ''],                  // "e" is not a tag
    ['foo.bar', ''],
    ['{text}', ''],
    ['div{a', ''],                // unbalanced
  ]) assert.equal(markupAbbreviationOk(abbr, prefix, isKnown), false, `${abbr} after ${JSON.stringify(prefix)}`);
  assert.equal(markupAbbreviationOk('p', '', isKnown, true), true, 'one-letter tag when asked for explicitly');
});

test('Emmet output becomes a snippet with tab stops', () => {
  assert.equal(toSnippetTemplate(expand('div', { options: OPTIONS })), '<div>${1}</div>');
  assert.equal(toSnippetTemplate(expand('ul>li*2', { options: OPTIONS })), '<ul>\n\t<li>${1}</li>\n\t<li>${2}</li>\n</ul>');
  const page = simplifyBoilerplate(toSnippetTemplate(expand('!', { options: OPTIONS })));
  assert.match(page, /^<!DOCTYPE html>\n<html lang="en">/);
  assert.match(page, /content="width=device-width, initial-scale=1\.0"/);
  // only two stops: the title, then the body
  assert.deepEqual(page.match(/\$\{[^}]*\}/g), ['${5:Document}', '${6}']);
  // literal braces in text are escaped, so they can't become fields
  assert.equal(toSnippetTemplate(expand('p{a {b}}', { options: OPTIONS })), '<p>a \\{b\\}</p>');
  assert.equal(plainExpansion(expand('a', { options: OPTIONS })), '<a href=""></a>');
});

test('CSS abbreviations', () => {
  const css = (abbr) => plainExpansion(expand(abbr, { type: 'stylesheet', options: OPTIONS }));
  assert.equal(css('m10'), 'margin: 10px;');
  assert.equal(css('df'), 'display: flex;');
  assert.equal(stylesheetAbbreviationOk('m10', css('m10'), '  '), true);
  assert.equal(stylesheetAbbreviationOk('df', css('df'), '  '), true);
  assert.equal(stylesheetAbbreviationOk('p10-20', css('p10-20'), 'color: red; '), true);
  assert.equal(stylesheetAbbreviationOk('color', css('color'), '  '), false, 'the CSS completion already has it');
  assert.equal(stylesheetAbbreviationOk('zi10', css('zi10'), '  '), false, 'unknown property passes through');
  assert.equal(stylesheetAbbreviationOk('foo', css('foo'), '  '), false);
  assert.equal(stylesheetAbbreviationOk('m10', css('m10'), 'margin: '), false, 'not in a value position');
});

test('inside a CSS block?', () => {
  assert.equal(insideCssBlock('.a {\n  '), true);
  assert.equal(insideCssBlock('.a { color: red; }\n'), false);
  assert.equal(insideCssBlock('/* { */ .a '), false);
  assert.equal(insideCssBlock('.a[title="}"] {\n '), true);
  assert.equal(insideCssBlock('@media (x) {\n  .a {\n    '), true);
});
