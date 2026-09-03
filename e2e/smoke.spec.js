/* ============================================================
   Garage — browser smoke tests.

   These are the checks that were previously only ever done by hand, and
   they cover what the Node suite structurally cannot:

     · that the app loads at all from a file:// origin, with ten plain
       <script> tags resolving in dependency order;
     · that a real HTML parser — not linkedom — treats user text as text;
     · that the IndexedDB backend works, which only the http project
       reaches, because storage.js refuses IndexedDB on file://.

   Every test runs twice, once per project. Assertions that depend on the
   backend read testInfo.project.metadata.
   ============================================================ */
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { test, expect } = require('@playwright/test');

const ROUTES = ['dashboard', 'maintenance', 'parts', 'fuel', 'budget', 'reports'];

/* The app boots asynchronously — open storage, hydrate, then render. Waiting
   on the router's own signal rather than a timeout keeps this deterministic. */
async function open(page, testInfo) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(testInfo.project.metadata.appUrl);
  await page.waitForFunction(() => window.session && window.session.booted(), null, { timeout: 15000 });
  await expect(page.locator('#view')).not.toBeEmpty();
  return errors;
}

/* Settings used to be a standalone topbar button (#settingsBtn). It is a menu
   item now, so every route to it goes through the account menu — driven as a
   real user would, trigger then item, so these keep covering the menu itself
   rather than reaching past it into openSettings(). The item's label is
   translated, hence matching either language. */
async function openSettings(page) {
  await page.click('#accountBtn');
  await page.click('#accountMenu [role="menuitem"]:has-text("Settings"), #accountMenu [role="menuitem"]:has-text("الإعدادات")');
  await expect(page.locator('#modalHost')).toBeVisible();
}

/* Dialogs that only display something leave themselves open. The modal host
   sits above the whole shell, so anything left open swallows later clicks. */
async function closeModal(page) {
  // Driven through the app's own closeModal rather than a backdrop click: the
  // card overlaps the backdrop, so a click lands on whatever button is beneath
  // the pointer. This is test teardown between steps, not behaviour under test.
  await page.evaluate(() => window.closeModal());
  await expect(page.locator('#modalHost')).toBeHidden();
}

test('boots and renders the dashboard, with no uncaught errors', async ({ page }, testInfo) => {
  const errors = await open(page, testInfo);

  // The boot chain catches its own failures and writes an error card, so an
  // empty #view is not the only failure shape to guard against.
  await expect(page.locator('#view')).not.toContainText('Could not open your garage');
  await expect(page.locator('#carTitle')).not.toBeEmpty();
  expect(errors, `uncaught page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('every tab renders, with icons drawn rather than printed', async ({ page }, testInfo) => {
  await open(page, testInfo);

  for (const route of ROUTES) {
    await page.click(`.tab[data-route="${route}"]`);
    const view = page.locator('#view');
    await expect(view, `${route} rendered nothing`).not.toBeEmpty();

    // The conversion's failure mode is markup escaped when it should not be:
    // the page still renders, but icons appear as visible source text. Length
    // checks miss this because escaping makes the output longer, not shorter.
    const html = await view.innerHTML();
    expect(html.includes('&lt;'), `${route} shows escaped markup as text`).toBe(false);
    expect(html.includes('[object Object]'), `${route} stringified an object`).toBe(false);
    expect(await view.locator('svg').count(), `${route} drew no icons`).toBeGreaterThan(0);
  }
});

test('switches to Arabic and back, flipping direction both ways', async ({ page }, testInfo) => {
  await open(page, testInfo);

  await openSettings(page);
  await page.click('#modalCard .seg button:has-text("العربية")');
  await page.click('#modalCard button:has-text("Save profile")');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');

  await openSettings(page);
  await page.click('#modalCard .seg button:has-text("English")');
  await page.click('#modalCard button:has-text("حفظ الملف")').catch(async () => {
    // the button carries its Arabic label while Arabic is active
    await page.click('#modalCard .btn.primary.block');
  });
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
});

test('a hostile nickname renders as text and round-trips unchanged', async ({ page }, testInfo) => {
  await open(page, testInfo);

  const PAYLOAD = '<b>test</b><img src=x onerror="window.__xss=1">';

  await openSettings(page);
  await page.fill('#c_nick', PAYLOAD);
  await page.click('#modalCard button:has-text("Save profile")');

  // A real HTML parser is the only authority on this. linkedom agreeing is
  // necessary but not sufficient.
  // Document-wide, not scoped to #view: the nickname surfaces in the topbar too,
  // and scoping an injection assertion to where you assume the payload lands is
  // how a test ends up asserting nothing.
  await expect(page.locator('img[onerror]')).toHaveCount(0);
  // Proves the payload actually reached the DOM, so the assertion above had
  // something to be wrong about.
  await expect(page.locator('#carTitle')).toContainText('<b>test</b>');
  // The decisive check: had it ever parsed as markup, onerror would have run.
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();

  // and it must survive as data, not be mangled into entities
  await openSettings(page);
  await expect(page.locator('#c_nick')).toHaveValue(PAYLOAD);
});

test('export then import reproduces the garage', async ({ page }, testInfo) => {
  await open(page, testInfo);

  const marker = `E2E ${testInfo.project.name} ${Date.now()}`;
  await openSettings(page);
  await page.fill('#c_nick', marker);
  await page.click('#modalCard button:has-text("Save profile")');
  await expect(page.locator('#carTitle')).toHaveText(marker);

  await openSettings(page);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#modalCard button:has-text("Export backup")')
  ]);
  const backup = path.join(os.tmpdir(), `garage-e2e-${testInfo.project.name}.json`);
  await download.saveAs(backup);
  expect(fs.statSync(backup).size, 'the backup file is empty').toBeGreaterThan(100);

  // Export leaves the dialog open — unlike Save, it has no reason to close it.
  // The backdrop would swallow the next click on the settings button.
  await closeModal(page);

  // Change the data so a no-op import would be indistinguishable from success.
  await openSettings(page);
  await page.fill('#c_nick', 'overwritten');
  await page.click('#modalCard button:has-text("Save profile")');
  await expect(page.locator('#carTitle')).toHaveText('overwritten');

  page.once('dialog', d => d.accept());          // import warns before replacing
  await openSettings(page);
  await page.setInputFiles('#modalCard input[type="file"][accept="application/json"]', backup);

  await expect(page.locator('#carTitle')).toHaveText(marker, { timeout: 15000 });
});

test('the account row is absent from file://', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'file', 'checks the file:// origin only');
  await open(page, testInfo);

  await openSettings(page);
  await expect(page.locator('#modalCard')).toBeVisible();
  // account.available() is false on file:// by design (opaque origin, no auth
  // code active) — the whole account row must be omitted, not merely hidden.
  await expect(page.locator('#modalCard').getByText('Account', { exact: true })).toHaveCount(0);
});

test('the account row is present over http', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'http', 'checks the http origin only');
  await open(page, testInfo);

  await openSettings(page);
  await expect(page.locator('#modalCard')).toBeVisible();
  // Same locator as the file:// test above: proves the selector actually
  // matches something here, so that test's zero-count assertion means what
  // it claims rather than passing because the selector never matched anything.
  await expect(page.locator('#modalCard').getByText('Account', { exact: true }).first()).toBeVisible();
});

test('an online listener is registered after boot, over http', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'http', 'checks the http origin only');
  await open(page, testInfo);
  const hasListener = await page.evaluate(() => window.__hasOnlineSyncListener === true);
  expect(hasListener).toBe(true);
});

test('the vendored client loads and does not break boot', async ({ page }, testInfo) => {
  // vendor/supabase.js is an unconditional <script> tag, so the SDK global
  // exists on both origins even though only http constructs a client from it.
  const errors = await open(page, testInfo);

  expect(await page.evaluate(() => typeof window.supabase)).toBe('object');
  expect(errors, `uncaught page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('uses the backend this origin is supposed to use', async ({ page }, testInfo) => {
  await open(page, testInfo);

  const dbs = await page.evaluate(async () => {
    if (!window.indexedDB || !indexedDB.databases) return null;
    try { return (await indexedDB.databases()).map(d => d.name); } catch (e) { return null; }
  });

  if (testInfo.project.metadata.backend === 'indexeddb') {
    // This assertion is the reason the http project exists: storage.js refuses
    // IndexedDB on an opaque origin, so nothing else in the repo ever runs it.
    expect(dbs, 'indexedDB.databases() unavailable').not.toBeNull();
    expect(dbs).toContain('garage');
  } else {
    // file:// must fall back to localStorage and still hold the garage.
    const stored = await page.evaluate(() => {
      try { return Object.keys(localStorage).filter(k => k.startsWith('garage')); } catch (e) { return []; }
    });
    expect(stored.length, 'file:// kept nothing in localStorage').toBeGreaterThan(0);
  }
});
