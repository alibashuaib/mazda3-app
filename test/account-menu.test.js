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
const items = d => Array.from(menu(d).querySelectorAll('[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]'));
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
  assert.ok(byLabel(document, /Dark theme/), 'the theme control was lost in the move');
  assert.ok(byLabel(document, /العربية/), 'the language switch was not added');
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

test('theme radios switch live, close the menu, and System is reachable again after an explicit pick', () => withBoot(async ({ document, api, window }) => {
  api.toggleAccountMenu();
  const radios = items(document).filter(b => b.getAttribute('role') === 'menuitemradio');
  assert.deepStrictEqual(radios.map(b => /System/.test(b.textContent) ? 's' : /Light/.test(b.textContent) ? 'l' : 'd'), ['s', 'l', 'd']);
  assert.strictEqual(radios.filter(b => b.getAttribute('aria-checked') === 'true').length, 1, 'exactly one theme checked');

  byLabel(document, /Dark theme/).onclick();
  assert.strictEqual(api.currentTheme(), 'dark');
  assert.strictEqual(menu(document).hidden, true, 'the menu did not close');
  assert.strictEqual(window.localStorage.getItem('garage.theme'), 'dark');

  api.toggleAccountMenu();
  assert.strictEqual(byLabel(document, /Dark theme/).getAttribute('aria-checked'), 'true');
  byLabel(document, /System theme/).onclick();
  assert.strictEqual(window.localStorage.getItem('garage.theme'), null, 'System must clear the stored choice');
  api.toggleAccountMenu();
  assert.strictEqual(byLabel(document, /System theme/).getAttribute('aria-checked'), 'true');
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
  assert.ok(byLabel(document, /Dark theme/), 'the theme control was lost on file://');
}));

test('the menu is translated, trigger included', () => withBoot(async ({ document, api, evalInApp }) => {
  evalInApp("lang = 'ar'");
  api.renderTopbar();
  assert.match(trigger(document).getAttribute('aria-label'), /[؀-ۿ]/, 'the trigger kept its English name');
  api.toggleAccountMenu();
  assert.match(menu(document).getAttribute('aria-label'), /[؀-ۿ]/, 'the menu kept its English name');
  for (const b of items(document)) {
    // The language item names the language it switches TO, in that
    // language's own script — it never gets run through t(), on either
    // side, so it stays 'English' even while the rest of the menu is Arabic.
    if (/English/.test(b.textContent)) continue;
    assert.match(b.textContent, /[؀-ۿ]/, `untranslated menu item: ${JSON.stringify(b.textContent)}`);
  }
}));

test('Share anonymous data checkbox shows only when signed in', () => withBoot(async ({ document: d, api }) => {
  trigger(d).click();
  assert.ok(!byLabel(d, /Share anonymous data/), 'signed-out users must not see a sharing control');
  trigger(d).click();
  api.account.setUserForTest({ id: 'u1', email: 'a@b.c' });
  trigger(d).click();
  const item = byLabel(d, /Share anonymous data/);
  assert.ok(item, 'sharing toggle was not added');
  assert.strictEqual(item.getAttribute('role'), 'menuitemcheckbox');
  assert.ok(['true', 'false'].includes(item.getAttribute('aria-checked')));
}));

/* ---- restored account dialog (sign up / sign in / sign out) ---- */
test('the menu offers Sign in when signed out and Account when signed in, only where sign-in works', () => withBoot(async ({ document, api }) => {
  api.account.available = () => true;
  api.toggleAccountMenu();
  assert.ok(byLabel(document, /^\S*\s*Sign in$/), 'no Sign in item while signed out');
  api.toggleAccountMenu();
  api.account.setUserForTest({ id: 'u1', email: 'a@b.c' });
  api.toggleAccountMenu();
  assert.ok(byLabel(document, /Account$/), 'no Account item while signed in');
  assert.ok(!byLabel(document, /Sign in$/));
}));

async function submitAccount(api, document, { mode, error, pw = 'secret1' } = {}) {
  const calls = [];
  api.account.signIn = (email, password, opts) => { calls.push([email, password, !!(opts && opts.signUp)]); return error ? Promise.reject(new Error(error)) : Promise.resolve(true); };
  api.openAccount();
  document.querySelector('#ac_email').value = ' a@b.c ';
  document.querySelector('#ac_pw').value = pw;
  const btn = [...document.querySelectorAll('#modalCard button')].find(b => b.textContent === (mode === 'up' ? 'Sign up' : 'Sign in'));
  await btn.onclick();
  return { calls, err: document.querySelector('#ac_err') };
}

test('Sign up and Sign in call account.signIn with the right flag and close the dialog', () => withBoot(async ({ document, api }) => {
  let r = await submitAccount(api, document, { mode: 'up' });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(r.calls)), [['a@b.c', 'secret1', true]]);
  assert.strictEqual(document.querySelector('#modalHost').hidden, true);
  r = await submitAccount(api, document, { mode: 'in' });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(r.calls)), [['a@b.c', 'secret1', false]]);
}));

test('sign-in errors map to plain messages and keep the dialog open', () => withBoot(async ({ document, api }) => {
  const cases = [['EMAIL_NOT_CONFIRMED', /confirm your account/], ['EMAIL_ALREADY_REGISTERED', /already registered/],
    ['PULL_FAILED', /Check your connection/], ['whatever', /Wrong email or password/]];
  for (const [code, re] of cases) {
    const { err } = await submitAccount(api, document, { error: code });
    assert.match(err.textContent, re, code);
    assert.strictEqual(err.hidden, false);
    assert.strictEqual(document.querySelector('#modalHost').hidden, false);
  }
  const short = await submitAccount(api, document, { pw: '123' });
  assert.strictEqual(short.calls.length, 0, 'a short password must not reach the server');
}));

test('an opted-out account is opted out locally before the dialog closes', () => withBoot(async ({ document, api }) => {
  let sharedAtClose = null;
  api.account.signIn = () => { api.account.setUserForTest({ id: 'u1', email: 'a@b.c' }); return Promise.resolve(true); };
  const meta = {};
  api.insights.configure({
    signedIn: () => true, metaGet: () => Promise.resolve(Object.assign({}, meta)), metaSet: p => { Object.assign(meta, p); return Promise.resolve(true); },
    client: { rpc: () => Promise.resolve({ data: 0, error: null }), from: () => ({
      select: () => ({ maybeSingle: () => Promise.resolve({ data: { share: false, notice_seen: true }, error: null }) }),
      upsert: () => Promise.resolve({ error: null }) }) }
  });
  const close = api.closeModal;
  api.closeModal = () => { sharedAtClose = meta.insightsShare; return close(); };
  api.openAccount();
  document.querySelector('#ac_email').value = 'a@b.c';
  document.querySelector('#ac_pw').value = 'secret1';
  await [...document.querySelectorAll('#modalCard button')].find(b => b.textContent === 'Sign in').onclick();
  assert.strictEqual(sharedAtClose, false, 'consent was not settled before the dialog closed');
}));

test('signed in, the dialog shows the email and Sign out wipes through account.signOut', () => withBoot(async ({ document, api }) => {
  api.account.setUserForTest({ id: 'u1', email: 'a@b.c' });
  let out = 0;
  api.account.signOut = () => { out++; return Promise.resolve(true); };
  api.openAccount();
  assert.match(document.querySelector('#modalHost').textContent, /a@b\.c/);
  [...document.querySelectorAll('#modalCard button')].find(b => b.textContent === 'Sign out').onclick();
  assert.strictEqual(out, 1);
}));

test('if the account\'s sharing choice cannot be read, sign-in does not mark the notice (no push of the default)', () => withBoot(async ({ api }) => {
  api.account.setUserForTest({ id: 'u1', email: 'a@b.c' });
  let marked = 0;
  api.insights.syncPrefs = () => Promise.resolve(false);
  api.insights.markNoticeSeen = () => { marked++; return Promise.resolve(); };
  api.insights.noticeSeen = () => Promise.resolve(false);
  await api.afterSignIn();
  assert.strictEqual(marked, 0);
}));
