'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { html, raw, esc, Raw } = require('../src/ui/html.js');

test('esc replaces every dangerous character', () => {
  assert.strictEqual(esc('&'), '&amp;');
  assert.strictEqual(esc('<'), '&lt;');
  assert.strictEqual(esc('>'), '&gt;');
  assert.strictEqual(esc('"'), '&quot;');
  assert.strictEqual(esc("'"), '&#39;');
});

/* The acceptance criterion from the design spec. */
test('a hostile vehicle nickname renders as literal text', () => {
  const out = String(html`<h3>${'<img src=x onerror=alert(1)>'}</h3>`);
  assert.strictEqual(out, '<h3>&lt;img src=x onerror=alert(1)&gt;</h3>');
  assert.ok(!out.includes('<img'), 'the tag must not survive');
});

test('an attribute value cannot be broken out of', () => {
  const out = String(html`<div title="${'" onmouseover="alert(1)'}"></div>`);
  assert.ok(!out.includes('onmouseover="'), 'the quote must be escaped');
  assert.ok(out.includes('&quot;'));
});

test('null and undefined render as nothing, not as the word', () => {
  assert.strictEqual(String(html`<p>${null}</p>`), '<p></p>');
  assert.strictEqual(String(html`<p>${undefined}</p>`), '<p></p>');
});

test('zero and false render, because they are real values', () => {
  assert.strictEqual(String(html`<p>${0}</p>`), '<p>0</p>');
  assert.strictEqual(String(html`<p>${false}</p>`), '<p>false</p>');
});

test('numbers pass through unchanged', () => {
  assert.strictEqual(String(html`<b>${316000}</b>`), '<b>316000</b>');
});

test('raw() passes markup through untouched', () => {
  assert.strictEqual(String(html`<div>${raw('<svg/>')}</div>`), '<div><svg/></div>');
});

/* Nesting is the reason html() returns a Raw rather than a plain string:
   an inner result must not be escaped a second time. */
test('a nested html result is not double-escaped', () => {
  const inner = html`<b>${'a & b'}</b>`;
  assert.strictEqual(String(html`<p>${inner}</p>`), '<p><b>a &amp; b</b></p>');
});

test('an array of html results joins with no separator', () => {
  const items = ['x', 'y'].map(v => html`<li>${v}</li>`);
  assert.strictEqual(String(html`<ul>${items}</ul>`), '<ul><li>x</li><li>y</li></ul>');
});

test('an array of plain strings is escaped element-wise', () => {
  assert.strictEqual(String(html`<p>${['<a>', '<b>']}</p>`), '<p>&lt;a&gt;&lt;b&gt;</p>');
});

test('html returns a Raw, and Raw is a String subclass', () => {
  const out = html`<p>hi</p>`;
  assert.ok(out instanceof Raw);
  assert.ok(out instanceof String);
  assert.strictEqual(`${out}`, '<p>hi</p>');
  assert.strictEqual(out.length, '<p>hi</p>'.length);
});

/* linkedom's innerHTML setter passes its value straight to the parser instead of
   coercing it, so a plain marker object would throw here. A String subclass does
   not. This test pins the reason for that design choice. */
test('a Raw can be assigned to innerHTML under the DOM harness', () => {
  const { setupDom } = require('./helpers/dom.js');
  const { document, cleanup } = setupDom();
  const d = document.createElement('div');
  d.innerHTML = html`<b>${'a & b'}</b>`;
  assert.strictEqual(d.innerHTML, '<b>a &amp; b</b>');
  cleanup();
});

test('a Raw survives the el() helper, which assigns to innerHTML', () => {
  const { setupDom } = require('./helpers/dom.js');
  const { document, cleanup } = setupDom();
  const { el } = require('../src/core/helpers.js');
  assert.strictEqual(el('p', 'k', html`<i>${'<x>'}</i>`).outerHTML, '<p class="k"><i>&lt;x&gt;</i></p>');
  cleanup();
});

test('a template with no interpolations still returns a Raw', () => {
  const out = html`<hr/>`;
  assert.ok(out instanceof Raw);
  assert.strictEqual(String(out), '<hr/>');
});
