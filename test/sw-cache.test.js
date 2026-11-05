'use strict';
/* ==== sw fetch — SWR modules, bounded LRU photo cache (FND-08, D-19) ==== */
const test = require('node:test');
const assert = require('node:assert');
const { load, res } = require('./helpers/sw-harness');

const photo = n => `/assets/car${n}.webp`;
const keys = async (sw, name) => (await sw.cacheFor(name).keys()).map(k => new URL(k.url).pathname);

test('SWR module: cached copy served at once, one background refresh updates cache', async () => {
  const sw = load(() => res(200, 'basic', 'new'));
  await sw.cacheFor(sw.consts.CACHE).put('/src/ui/chrome.js', res(200, 'basic', 'old'));
  const { response } = await sw.fire('fetch', '/src/ui/chrome.js');
  assert.strictEqual(response.body, 'old');
  assert.strictEqual(sw.calls.fetch.length, 1);
  assert.strictEqual((await sw.cacheFor(sw.consts.CACHE).match('/src/ui/chrome.js')).body, 'new');
});

test('vendor file is served from cache with NO background fetch', async () => {
  const sw = load(() => res(200));
  await sw.cacheFor(sw.consts.CACHE).put('/vendor/supabase.js', res(200, 'basic', 'pinned'));
  const { response } = await sw.fire('fetch', '/vendor/supabase.js');
  assert.strictEqual(response.body, 'pinned');
  assert.strictEqual(sw.calls.fetch.length, 0);
});

test('same-origin .js outside ASSETS is network-first and not written to CACHE', async () => {
  const sw = load(() => res(200));
  await sw.fire('fetch', '/src/evil/other.js');
  assert.strictEqual(sw.cacheFor(sw.consts.CACHE).m.size, 0);
});

test('photo SWR: hit answers from cache, background refresh runs once', async () => {
  const sw = load(() => res(200, 'basic', 'fresh'));
  await sw.cacheFor(sw.consts.PHOTO_CACHE).put(photo(1), res(200, 'basic', 'stale'));
  const { response } = await sw.fire('fetch', photo(1));
  assert.strictEqual(response.body, 'stale');
  assert.strictEqual(sw.calls.fetch.length, 1);
  assert.strictEqual((await sw.cacheFor(sw.consts.PHOTO_CACHE).match(photo(1))).body, 'fresh');
});

test('photo miss goes to network and is stored under the full URL with ?v=', async () => {
  const sw = load(() => res(200));
  await sw.fire('fetch', photo(1) + '?v=3');
  assert.deepStrictEqual([...sw.cacheFor(sw.consts.PHOTO_CACHE).m.keys()], ['https://app.test' + photo(1) + '?v=3']);
});

test('non-200 or opaque refresh leaves the cached photo untouched; such responses are not cached', async () => {
  for (const bad of [res(500), res(200, 'cors'), res(206)]) {
    const sw = load(() => bad);
    await sw.cacheFor(sw.consts.PHOTO_CACHE).put(photo(1), res(200, 'basic', 'keep'));
    await sw.fire('fetch', photo(1));
    assert.strictEqual((await sw.cacheFor(sw.consts.PHOTO_CACHE).match(photo(1))).body, 'keep');
    await sw.fire('fetch', photo(2));
    assert.strictEqual(await sw.cacheFor(sw.consts.PHOTO_CACHE).match(photo(2)), undefined);
  }
});

test('LRU: 7 photos leave PHOTO_MAX entries, oldest evicted, newest kept', async () => {
  const sw = load(() => res(200));
  for (let i = 1; i <= 7; i++) await sw.fire('fetch', photo(i));
  const ks = await keys(sw, sw.consts.PHOTO_CACHE);
  assert.strictEqual(ks.length, sw.consts.PHOTO_MAX);
  assert.ok(!ks.includes(photo(1)));
  assert.ok(ks.includes(photo(7)));
});

test('a hit on the oldest photo makes it newest, so another entry is evicted next', async () => {
  const sw = load(() => res(200));
  for (let i = 1; i <= 6; i++) await sw.fire('fetch', photo(i));
  await sw.fire('fetch', photo(1));
  await sw.fire('fetch', photo(7));
  const ks = await keys(sw, sw.consts.PHOTO_CACHE);
  assert.ok(ks.includes(photo(1)));
  assert.ok(!ks.includes(photo(2)));
});

test('photo network failure with no cached copy falls back to caches.match ignoreSearch', async () => {
  const sw = load(() => { throw new Error('offline'); });
  await sw.cacheFor(sw.consts.CACHE).put('/assets/car1.webp', res(200, 'basic', 'precached'));
  const { response } = await sw.fire('fetch', photo(1) + '?v=9');
  assert.strictEqual(response.body, 'precached');
});
