'use strict';
/* ==== sw install/activate — tolerant precache, no takeover (FND-07, D-17, D-20) ==== */
const test = require('node:test');
const assert = require('node:assert');
const { load, res } = require('./helpers/sw-harness');

const BAD = './src/data/bills.js';
const setup = () => load(url => (url.endsWith('/src/data/bills.js') ? res(404) : res(200)));

test('install resolves when one precache URL is 404 and caches the rest', async () => {
  const sw = setup();
  await sw.fire('install');
  const c = sw.cacheFor(sw.consts.CACHE);
  assert.strictEqual(c.m.size, sw.consts.ASSETS.length - 1);
  assert.ok(![...c.m.keys()].some(k => k.endsWith('/src/data/bills.js')));
});

test('install parks the failed URL list in garage-meta /__precache-report', async () => {
  const sw = setup();
  await sw.fire('install');
  const hit = await sw.cacheFor(sw.consts.META_CACHE).match('/__precache-report');
  assert.deepStrictEqual(await hit.json(), [BAD]);
});

test('a rejected fetch is also reported, install still resolves', async () => {
  const sw = load(url => { if (url.endsWith('/main.js')) throw new Error('net'); return res(200); });
  await sw.fire('install');
  const hit = await sw.cacheFor(sw.consts.META_CACHE).match('/__precache-report');
  assert.deepStrictEqual(await hit.json(), ['./main.js']);
});

test('install fetches with cache: reload and never calls skipWaiting', async () => {
  const sw = setup();
  await sw.fire('install');
  assert.ok(sw.calls.fetch.length > 0 && sw.calls.fetch.every(f => f.init && f.init.cache === 'reload'));
  assert.strictEqual(sw.calls.skipWaiting, 0);
});

test('activate deletes only caches outside KEEP and never claims clients', async () => {
  const sw = setup();
  const { CACHE, PHOTO_CACHE, META_CACHE } = sw.consts;
  for (const n of [CACHE, PHOTO_CACHE, META_CACHE, 'garage-old', 'garage-v1']) sw.cacheFor(n);
  await sw.fire('activate');
  assert.deepStrictEqual(sw.calls.deleted.sort(), ['garage-old', 'garage-v1']);
  assert.strictEqual(sw.calls.claim, 0);
});
