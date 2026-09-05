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
  await ensureVehicle(page);
  return errors;
}

/* Every test below assumes a car exists — it reads #carTitle, opens the
   profile dialog, exports the garage. That used to be free: the app seeded a
   default Mazda 3. 49dd626 removed the seed, so a fresh browser profile now
   lands on onboarding instead and every one of those tests failed against an
   empty topbar. Each Playwright test gets its own context, so the garage is
   empty every time and this has to run per test, not once per file.

   Driven through the real onboarding UI rather than by writing storage
   directly: the http and file projects use different backends (IndexedDB vs
   localStorage), and seeding either one by hand would encode the backend
   choice this suite exists to check. The add-vehicle dialog opens with a
   valid default selection, so submitting it unchanged is enough. */
async function ensureVehicle(page) {
  const empty = await page.evaluate(() => window.session.garage().vehicles.length === 0);
  if (!empty) return;
  await page.click('#view button:has-text("Add a vehicle")');
  await expect(page.locator('#modalHost')).toBeVisible();
  await page.click('#modalCard button:has-text("Add a vehicle")');
  await expect(page.locator('#modalHost')).toBeHidden();
  await expect(page.locator('#carTitle')).not.toBeEmpty();
}

/* The account menu no longer has a Settings/Car profile entry — it was
   redundant with the topbar's own car button (#openProfile), which has
   always opened this same dialog and is the one real users click. */
async function openSettings(page) {
  await page.click('#openProfile');
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
  // Language lives in the account menu, not the car profile — it applies on
  // tap, with no Save step to go through.
  await open(page, testInfo);

  await page.click('#accountBtn');
  await page.click('#accountMenu [role="menuitem"]:has-text("العربية")');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');

  // The item's own label is translated along with the rest of the menu, so
  // once Arabic is active it reads "الإنجليزية", not "English".
  await page.click('#accountBtn');
  await page.click('#accountMenu [role="menuitem"]:has-text("الإنجليزية")');
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

test('car profile updates render immediately and survive a reload', async ({ page }, testInfo) => {
  const errors = await open(page, testInfo);
  const beforeImage = await page.locator('.studio-car').getAttribute('src');

  await openSettings(page);
  await page.fill('#c_nick', 'Road Tester');
  await page.fill('#c_year', '2022');
  await page.selectOption('#c_trans', 'Manual');
  await page.fill('#c_vin', 'jm1bp123456789012');
  await page.click('#c_colorPick .color-trigger');
  await page.locator('#c_colorPick .color-opt').nth(1).click();
  const expectedColor = await page.locator('#c_color').inputValue();
  await page.click('#modalCard button:has-text("Save profile")');

  await expect(page.locator('#carTitle')).toHaveText('Road Tester');
  await expect(page.locator('#carSub')).toContainText('2022');
  await expect(page.locator('#carSub')).toContainText('Manual');
  await expect(page.locator('#carSub')).toContainText(expectedColor);
  await expect(page).toHaveTitle(/Car Care — Road Tester/);
  await expect(page.locator('.studio-car')).not.toHaveAttribute('src', beforeImage);

  await page.reload();
  await page.waitForFunction(() => window.session && window.session.booted(), null, { timeout: 15000 });
  await expect(page.locator('#carTitle')).toHaveText('Road Tester');
  await expect(page).toHaveTitle(/Car Care — Road Tester/);

  await openSettings(page);
  await expect(page.locator('#c_nick')).toHaveValue('Road Tester');
  await expect(page.locator('#c_year')).toHaveValue('2022');
  await expect(page.locator('#c_trans')).toHaveValue('Manual');
  await expect(page.locator('#c_vin')).toHaveValue('JM1BP123456789012');
  await expect(page.locator('#c_color')).toHaveValue(expectedColor);
  expect(errors, `uncaught page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('export then import reproduces the garage', async ({ page }, testInfo) => {
  await open(page, testInfo);

  const marker = `E2E ${testInfo.project.name} ${Date.now()}`;
  await openSettings(page);
  await page.fill('#c_nick', marker);
  await page.click('#modalCard button:has-text("Save profile")');
  await expect(page.locator('#carTitle')).toHaveText(marker);

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    (async () => {
      await page.click('#accountBtn');
      await page.click('#accountMenu [role="menuitem"]:has-text("Export backup")');
    })()
  ]);
  const backup = path.join(os.tmpdir(), `garage-e2e-${testInfo.project.name}.json`);
  await download.saveAs(backup);
  expect(fs.statSync(backup).size, 'the backup file is empty').toBeGreaterThan(100);

  // Change the data so a no-op import would be indistinguishable from success.
  await openSettings(page);
  await page.fill('#c_nick', 'overwritten');
  await page.click('#modalCard button:has-text("Save profile")');
  await expect(page.locator('#carTitle')).toHaveText('overwritten');

  page.once('dialog', d => d.accept());          // import warns before replacing
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    (async () => {
      await page.click('#accountBtn');
      await page.click('#accountMenu [role="menuitem"]:has-text("Import backup")');
    })()
  ]);
  await chooser.setFiles(backup);

  await expect(page.locator('#carTitle')).toHaveText(marker, { timeout: 15000 });
});

test('account and plan setup are absent from the car profile', async ({ page }, testInfo) => {
  await open(page, testInfo);

  await openSettings(page);
  await expect(page.locator('#modalCard')).toBeVisible();
  await expect(page.locator('#modalCard').getByText('Account', { exact: true })).toHaveCount(0);
  await expect(page.locator('#modalCard').getByText(/Set up your plan|Update your plan/)).toHaveCount(0);
  await expect(page.locator('#modalCard').getByText('Backup & restore', { exact: true })).toHaveCount(0);
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
