import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../scripts/mustache.js';

test('renders bare variable, escaped by default', () => {
  assert.equal(render('Hello {{name}}', { name: 'World' }), 'Hello World');
});

test('escapes HTML special chars in {{var}}', () => {
  assert.equal(
    render('{{x}}', { x: '<script>alert(1)</script>' }),
    '&lt;script&gt;alert(1)&lt;/script&gt;'
  );
});

test('triple-stash {{{raw}}} bypasses escaping', () => {
  assert.equal(render('{{{html}}}', { html: '<b>x</b>' }), '<b>x</b>');
});

test('section iterates array with sub-context', () => {
  const tmpl = '{{#items}}[{{name}}]{{/items}}';
  assert.equal(render(tmpl, { items: [{ name: 'a' }, { name: 'b' }] }), '[a][b]');
});

test('inverted section renders only when falsy/empty', () => {
  assert.equal(render('{{^items}}empty{{/items}}', { items: [] }), 'empty');
  assert.equal(render('{{^items}}empty{{/items}}', { items: [{}] }), '');
});

test('missing key renders as empty string, not "undefined"', () => {
  assert.equal(render('x={{missing}}', {}), 'x=');
});

test('nested sections respect inherited context', () => {
  const tmpl = '{{#a}}{{#b}}{{x}}{{/b}}{{/a}}';
  assert.equal(render(tmpl, { a: { b: [{ x: 'ok' }] } }), 'ok');
});

test('falsy section (false, null, undefined, empty array) renders nothing', () => {
  for (const val of [false, null, undefined, []]) {
    assert.equal(render('{{#x}}body{{/x}}', { x: val }), '');
  }
});

test('preserves literal text around tags', () => {
  assert.equal(render('a {{x}} b', { x: '1' }), 'a 1 b');
});
