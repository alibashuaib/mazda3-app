'use strict';
/* ==== sw-harness — load sw.js into node:vm with fake caches/fetch ====
   Real `new Response` has type 'default', so fakes set 'basic' explicitly. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ORIGIN = 'https://app.test/';
const keyOf = r => (typeof r === 'string' ? new URL(r, ORIGIN).href : r.url);

function res(status, type = 'basic', body = '') {
  return { ok: status >= 200 && status < 300, status, type, body, clone: () => res(status, type, body),
    text: async () => body, json: async () => JSON.parse(body) };
}
class FakeResponse { constructor(body) { Object.assign(this, res(200, 'default', body)); } }

function fakeCache() {
  const m = new Map(); // insertion-ordered like Chromium's keys()
  return {
    m,
    put: async (r, v) => { m.set(keyOf(r), v); },
    match: async (r, o) => {
      const k = keyOf(r);
      if (m.has(k)) return m.get(k);
      if (o && o.ignoreSearch) {
        for (const [k2, v] of m) if (new URL(k2).pathname === new URL(k).pathname) return v;
      }
      return undefined;
    },
    delete: async r => m.delete(keyOf(r)),
    keys: async () => [...m.keys()].map(url => ({ url }))
  };
}

function load(responder) {
  const stores = new Map(), handlers = {}, calls = { fetch: [], skipWaiting: 0, claim: 0, deleted: [] };
  const cacheFor = n => { if (!stores.has(n)) stores.set(n, fakeCache()); return stores.get(n); };
  const caches = {
    open: async n => cacheFor(n),
    keys: async () => [...stores.keys()],
    delete: async n => { calls.deleted.push(n); return stores.delete(n); },
    match: async (r, o) => { for (const c of stores.values()) { const h = await c.match(r, o); if (h) return h; } }
  };
  const sandbox = {
    URL, Promise, JSON, Set, Math, Response: FakeResponse, caches,
    self: {
      location: new URL(ORIGIN),
      addEventListener: (t, f) => { handlers[t] = f; },
      skipWaiting: () => { calls.skipWaiting++; },
      clients: { claim: () => { calls.claim++; } }
    },
    fetch: async (r, init) => {
      const url = keyOf(r);
      calls.fetch.push({ url, init });
      return responder(url, init);
    }
  };
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'sw.js'), 'utf8');
  const consts = vm.runInNewContext(src + '\n;({ CACHE, ASSETS, PHOTO_MAX, PHOTO_CACHE, META_CACHE })', sandbox);
  const tick = () => new Promise(r => setImmediate(r));
  async function fire(type, url) {
    const waits = [];
    const ev = { request: { url: new URL(url || '', ORIGIN).href, method: 'GET' }, responded: undefined,
      respondWith(p) { ev.responded = p; }, waitUntil(p) { waits.push(p); } };
    handlers[type](ev);
    const response = ev.responded && await ev.responded;
    await Promise.all(waits); await tick(); await tick();
    return { ev, response };
  }
  return { consts, stores, cacheFor, calls, fire };
}
module.exports = { load, res, ORIGIN };
