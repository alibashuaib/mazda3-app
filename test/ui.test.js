'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { onAsyncClick } = require('../src/core/async-click.js');

/* A button is only ever touched through .onclick and .disabled, so a plain
   object stands in for the element. */
function fakeButton() { return { disabled: false, onclick: null }; }

/* A save that stays pending until released, which is the window the real bug
   lived in — the handler awaits, and the button is still clickable. */
function deferred() {
  let release;
  const promise = new Promise(res => { release = res; });
  return { promise, release };
}

test('onAsyncClick runs the handler and returns its value', async () => {
  const btn = fakeButton();
  onAsyncClick(btn, async () => 'done');
  assert.strictEqual(await btn.onclick(), 'done');
});

/* Regression for #3: a double-tap on Save used to run the whole body twice
   and push two records with different uid()s. */
test('onAsyncClick ignores a second click while the first is still awaiting', async () => {
  const btn = fakeButton();
  const gate = deferred();
  let runs = 0;
  onAsyncClick(btn, async () => { runs++; await gate.promise; });

  const first = btn.onclick();
  btn.onclick();            // the double-tap, mid-await
  btn.onclick();
  assert.strictEqual(runs, 1);
  assert.strictEqual(btn.disabled, true);

  gate.release();
  await first;
  assert.strictEqual(runs, 1);
  assert.strictEqual(btn.disabled, false);
});

test('onAsyncClick accepts a genuine second click after the first settles', async () => {
  const btn = fakeButton();
  let runs = 0;
  onAsyncClick(btn, async () => { runs++; });
  await btn.onclick();
  await btn.onclick();
  assert.strictEqual(runs, 2);
});

/* The validation paths bail early and leave the modal open — the button has
   to come back, or the user is stuck looking at a dead Save. */
test('onAsyncClick re-enables the button when the handler bails early', async () => {
  const btn = fakeButton();
  onAsyncClick(btn, async () => undefined);   // e.g. return toast('Litres required')
  await btn.onclick();
  assert.strictEqual(btn.disabled, false);
});

test('onAsyncClick re-enables the button when the handler throws', async () => {
  const btn = fakeButton();
  onAsyncClick(btn, async () => { throw new Error('save blew up'); });
  await assert.rejects(() => btn.onclick(), /save blew up/);
  assert.strictEqual(btn.disabled, false);
});

test('onAsyncClick returns the button so it can be chained into append', () => {
  const btn = fakeButton();
  assert.strictEqual(onAsyncClick(btn, async () => {}), btn);
});
