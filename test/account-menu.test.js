'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { bootApp } = require('./helpers/boot.js');

/* The topbar's inline-end corner held four standalone icon buttons: switch
   vehicle, account, settings, theme. They are one menu now — these assert that
   nothing became unreachable in the move, which is the only way a consolidation
   like this actually goes wrong. */
async function withBoot(opts, fn) {
  if (typeof opts === 'function') { fn = opts; opts = undefined; }
  const ctx = await bootApp(opts);
  try { await fn(ctx); } finally { ctx.cleanup(); }
}

const trigger = d => d.querySelector('#accountBtn');
const menu = d => d.querySelector('#accountMenu');
const items = d => Array.from(menu(d).querySelectorAll('[role="menuitem"], [role="menuitemcheckbox"]'));
const byLabel = (d, re) => items(d).find(b => re.test(b.textContent));
/* linkedom ships no KeyboardEvent constructor, so a plain Event carries the
   key. The listener only reads ev.key and ev.preventDefault(), both of which
   this provides — and dispatching for real still proves the handler is
   actually bound to the menu, which calling it directly would not. */
function key(d, k) {
  const ev = new d.defaultView.Event('keydown', { bubbles: true, cancelable: true });
  ev.key = k;
  menu(d).dispatchEvent(ev);
}

/* linkedom does not track document.activeElement, so focus is observed by
   recording the calls instead. Patch after opening — openAccountMenu() builds
   the items, so anything patched earlier is thrown away with the old nodes. */
function watchFocus(d) {
  const seen = [];
  const targets = items(d).concat([trigger(d)]);
  targets.forEach(nodeEl => {
    nodeEl.focus = () => { seen.push(nodeEl); };
  });
  return { seen, last: () => seen[seen.length - 1] };
}

/* Never assert.strictEqual on two DOM nodes: on failure, node:assert builds a
   diff by inspecting both, and linkedom's parent/child/ownerDocument cycles
   turn that into a ~50s hang instead of a test failure. Compare identity as a
   boolean and describe the mismatch in the message. */
function assertIs(actual, expected, msg) {
  assert.ok(actual === expected,
    `${msg}\n  expected: ${expected && expected.textContent}\n  actual:   ${actual && actual.textContent}`);
}

test('the old standalone buttons are gone — no duplicate entry points', () => withBoot(async ({ document }) => {
  for (const id of ['garageBtn', 'settingsBtn', 'themeToggle']) {
    assert.strictEqual(document.querySelector('#' + id), null,
      `#${id} still exists alongside the menu`);
  }
}));

test('the trigger is a closed menu button until it is opened', () => withBoot(async ({ document, api }) => {
  assert.strictEqual(trigger(document).getAttribute('aria-haspopup'), 'menu');
  assert.strictEqual(trigger(document).getAttribute('aria-expanded'), 'false');
  assert.strictEqual(trigger(document).getAttribute('aria-controls'), menu(document).id);
  assert.strictEqual(menu(document).hidden, true);

  api.toggleAccountMenu();
  assert.strictEqual(trigger(document).getAttribute('aria-expanded'), 'true');
  assert.strictEqual(menu(document).hidden, false);
  assert.strictEqual(menu(document).getAttribute('role'), 'menu');
  assert.ok(menu(document).getAttribute('aria-label'), 'the menu is unnamed');
}));

test('the remaining corner controls are reachable', () => withBoot(async ({ document, api }) => {
  api.toggleAccountMenu();
  assert.ok(byLabel(document, /Switch vehicle/), 'the vehicle switcher was lost in the move');
  assert.ok(byLabel(document, /Dark mode/), 'the theme toggle was lost in the move');
  assert.ok(byLabel(document, /العربية/), 'the language switch was not added');
  assert.ok(byLabel(document, /Export backup/), 'backup export was not added');
  assert.ok(byLabel(document, /Import backup/), 'backup import was not added');
}));

test('language switches directly from the menu', () => withBoot(async ({ document, api, evalInApp }) => {
  api.toggleAccountMenu();
  byLabel(document, /العربية/).onclick();
  assert.strictEqual(document.documentElement.getAttribute('lang'), 'ar');
  assert.strictEqual(document.documentElement.getAttribute('dir'), 'rtl');
  assert.strictEqual(menu(document).hidden, true, 'language switch left the menu open');
  assert.strictEqual(evalInApp("localStorage.getItem('garage.lang')"), 'ar');
}));

test('the current vehicle is named, but is not a menu item', () => withBoot(async ({ document, api }) => {
  api.toggleAccountMenu();
  const head = menu(document).querySelector('.menu-head');
  assert.ok(head, 'the menu does not say which vehicle it is about');
  assert.match(head.textContent, /Mazda/);
  assert.strictEqual(head.getAttribute('role'), 'presentation');
  assert.ok(!items(document).includes(head), 'the vehicle label is focusable as a menu item');
}));

test('Switch vehicle opens its dialog and closes the menu', () => withBoot(async ({ document, api }) => {
  api.toggleAccountMenu();
  byLabel(document, /Switch vehicle/).onclick();
  assert.strictEqual(menu(document).hidden, true, 'Switch vehicle left the menu open');
  assert.strictEqual(document.querySelector('#modalHost').hidden, false, 'Switch vehicle opened no dialog');
  assert.match(document.querySelector('#modalTitle').textContent, /Your garage|مرآبك|المرآب/);
}));

/* The one item that must NOT close: a checkbox you cannot see flip is a
   checkbox you have to reopen the menu to verify. */
test('Dark mode toggles the theme live, updates aria-checked, and stays open', () => withBoot(async ({ document, api }) => {
  api.toggleAccountMenu();
  const dark = byLabel(document, /Dark mode/);
  assert.strictEqual(dark.getAttribute('role'), 'menuitemcheckbox');

  const before = api.currentTheme();
  assert.strictEqual(dark.getAttribute('aria-checked'), String(before === 'dark'),
    'aria-checked did not reflect the live theme on open');

  dark.onclick();
  assert.notStrictEqual(api.currentTheme(), before, 'the theme did not change');
  assert.strictEqual(dark.getAttribute('aria-checked'), String(api.currentTheme() === 'dark'),
    'aria-checked did not follow the theme');
  assert.strictEqual(menu(document).hidden, false, 'the menu closed on a checkbox toggle');

  dark.onclick();
  assert.strictEqual(api.currentTheme(), before, 'toggling twice did not return to the original theme');
}));

test('opening focuses the first item', () => withBoot(async ({ document, api }) => {
  /* Patched before the open, on the trigger only — the items do not exist yet.
     openAccountMenu() focuses items[0] as its last act. */
  api.toggleAccountMenu();
  const list = items(document);
  assertIs(list.find(b => b.getAttribute('tabindex') === '0'), list[0], 'opening did not put the tab stop on the first item');
}));

test('Escape closes and returns focus to the trigger', () => withBoot(async ({ document, api }) => {
  api.toggleAccountMenu();
  const watch = watchFocus(document);
  key(document, 'Escape');
  assert.strictEqual(menu(document).hidden, true, 'Escape did not close the menu');
  assertIs(watch.last(), trigger(document), 'focus was stranded after Escape');
}));

test('Tab closes the menu without pulling focus back, unlike the modal', () => withBoot(async ({ document, api }) => {
  api.toggleAccountMenu();
  const watch = watchFocus(document);
  key(document, 'Tab');
  assert.strictEqual(menu(document).hidden, true, 'Tab did not close the menu');
  assert.strictEqual(watch.seen.length, 0,
    'Tab moved focus itself instead of letting it move on to the next control');
}));

test('arrows and Home/End move focus, and wrap', () => withBoot(async ({ document, api }) => {
  api.toggleAccountMenu();
  const list = items(document);
  assert.ok(list.length >= 2, 'too few items to test movement');
  const watch = watchFocus(document);

  key(document, 'ArrowDown');
  assertIs(watch.last(), list[1], 'ArrowDown did not advance');
  key(document, 'ArrowUp');
  assertIs(watch.last(), list[0], 'ArrowUp did not go back');
  key(document, 'ArrowUp');
  assertIs(watch.last(), list[list.length - 1], 'ArrowUp did not wrap to the end');
  key(document, 'Home');
  assertIs(watch.last(), list[0], 'Home did not jump to the first item');
  key(document, 'End');
  assertIs(watch.last(), list[list.length - 1], 'End did not jump to the last item');
}));

test('the menu is one tab stop — a roving tabindex, not four', () => withBoot(async ({ document, api }) => {
  api.toggleAccountMenu();
  const tabbable = items(document).filter(b => b.getAttribute('tabindex') === '0');
  assert.strictEqual(tabbable.length, 1, 'every item is its own tab stop');
  key(document, 'ArrowDown');
  assert.strictEqual(items(document).filter(b => b.getAttribute('tabindex') === '0').length, 1);
}));

/* The button whose glyph the trigger inherits used to hide itself here. The
   trigger cannot: that would take the theme, settings and vehicle switcher
   down with it on a protocol where only sign-in is impossible. */
test('the trigger stays on file:// and account is never exposed', () => withBoot({ protocol: 'file:' }, async ({ document, api }) => {
  assert.strictEqual(trigger(document).hidden, false, 'the whole menu vanished on file://');
  api.toggleAccountMenu();
  assert.strictEqual(byLabel(document, /^Account$/), undefined, 'sign-in offered where it cannot work');
  assert.ok(byLabel(document, /Switch vehicle/), 'the vehicle switcher was lost on file://');
  assert.ok(byLabel(document, /Dark mode/), 'the theme toggle was lost on file://');
}));

test('the menu is translated, trigger included', () => withBoot(async ({ document, api, evalInApp }) => {
  evalInApp("lang = 'ar'");
  api.renderTopbar();
  assert.match(trigger(document).getAttribute('aria-label'), /[؀-ۿ]/, 'the trigger kept its English name');
  api.toggleAccountMenu();
  assert.match(menu(document).getAttribute('aria-label'), /[؀-ۿ]/, 'the menu kept its English name');
  for (const b of items(document)) {
    assert.match(b.textContent, /[؀-ۿ]/, `untranslated menu item: ${JSON.stringify(b.textContent)}`);
  }
}));
