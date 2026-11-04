'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const errorLog = require('../src/data/error-log.js');
const { bootApp } = require('./helpers/boot.js');

function fake(opts = {}) {
  const calls = { rows: [], tables: [], select: 0 };
  return {
    calls,
    from(t) {
      calls.tables.push(t);
      return {
        insert(row) {
          if (opts.throws) throw new Error('boom');
          calls.rows.push(row);
          const p = opts.rejects ? Promise.reject(new Error('x')) : Promise.resolve({ error: null });
          p.select = () => { calls.select++; return p; };
          return p;
        }
      };
    }
  };
}
const setup = (opts, extra) => { errorLog.reset(); const c = fake(opts); errorLog.configure(Object.assign({ client: c, appVersion: 'garage-0123456789ab' }, extra)); return c; };

test('errorLog sends one allowlisted row and never chains select', async () => {
  const c = setup();
  const r = await errorLog.report({ message: 'oops', stack: 's', route: '#/x', vehicle: { vin: 'secret' }, notes: 'n' });
  assert.equal(r.ok, true);
  assert.deepEqual(c.calls.tables, ['app_errors']);
  assert.deepEqual(Object.keys(c.calls.rows[0]).sort(), ['app_version', 'message', 'route', 'source', 'stack']);
  assert.equal(c.calls.select, 0);
  assert.equal(c.calls.rows[0].source, 'client');
});

test('errorLog drops when offline', async () => {
  const c = setup();
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true });
  try { assert.deepEqual(await errorLog.report({ message: 'a' }), { ok: false, error: 'offline' }); }
  finally { delete globalThis.navigator; }
  assert.equal(c.calls.rows.length, 0);
});

test('errorLog without client is unavailable and does not throw', async () => {
  errorLog.reset();
  assert.deepEqual(await errorLog.report({ message: 'a' }), { ok: false, error: 'unavailable' });
});

test('errorLog never rejects (sync throw and rejection)', async () => {
  setup({ throws: true });
  assert.deepEqual(await errorLog.report({ message: 'a' }), { ok: false, error: 'failed' });
  setup({ rejects: true });
  assert.deepEqual(await errorLog.report({ message: 'b' }), { ok: false, error: 'failed' });
});

test('errorLog caps session at 30 and dedupes messages', async () => {
  let t = 0;
  setup({}, { now: () => t });
  for (let i = 0; i < 30; i++) { if (i % 10 === 0) t += 3600001; assert.equal((await errorLog.report({ message: 'm' + i })).ok, true); }
  assert.equal((await errorLog.report({ message: 'm31' })).error, 'limit');
  setup();
  await errorLog.report({ message: 'same' });
  assert.equal((await errorLog.report({ message: 'same' })).error, 'limit');
});

test('errorLog throttles to 20 rows per hour', async () => {
  let t = 1000;
  const c = setup({}, { now: () => t });
  for (let i = 0; i < 20; i++) await errorLog.report({ message: 'h' + i });
  assert.equal((await errorLog.report({ message: 'h20' })).error, 'throttled');
  t += 3600001;
  assert.equal((await errorLog.report({ message: 'h21' })).ok, true);
  assert.equal(c.calls.rows.length, 21);
});

test('scrub redacts sk- tokens and JWTs; fields are truncated', () => {
  const s = errorLog.scrub('key sk-abcdefgh12345 jwt eyJhbGci.eyJzdWIi.sig_1');
  assert.equal(s, 'key [redacted] jwt [redacted]');
  const row = errorLog.buildRow({ message: 'm '.repeat(300), stack: 's '.repeat(1500) }, {});
  assert.equal(row.message.length, 500);
  assert.equal(row.stack.length, 2000);
});

test('scrub redaction table', () => {
  const cases = [
    ['mail bob@example.com now', 'mail [redacted] now'],
    ['GET https://x.co/a/b?token=1&u=2 failed', 'GET https://x.co/a/b failed'],
    ['at https://x.co/p#access_token=zz end', 'at https://x.co/p end'],
    ['refresh_token=abc123 seen', 'refresh_token=[redacted] seen'],
    ['provider_token=q&code=w', 'provider_token=[redacted]&code=[redacted]'],
    ['key sb_secret_abcdef123', 'key [redacted]'],
    ['blob ' + 'a'.repeat(40), 'blob [redacted]'],
    ['hex ' + 'ab12'.repeat(10), 'hex [redacted]']
  ];
  for (const [inp, out] of cases) assert.equal(errorLog.scrub(inp), out, inp);
});

test('route is trimmed to a safe page name', () => {
  assert.equal(errorLog.buildRow({ message: 'm', route: '#/admin?x=1' }, {}).route, '#/admin');
  assert.equal(errorLog.buildRow({ message: 'm', route: '#access_token=abc&refresh_token=def' }, {}).route, null);
  assert.equal(errorLog.buildRow({ message: 'm', route: '#/fuel' }, {}).route, '#/fuel');
});

test('errorLog buffers before configure (max 20) and flushes once on configure', async () => {
  errorLog.reset();
  for (let i = 0; i < 25; i++) assert.equal((await errorLog.report({ message: 'b' + i })).error, 'unavailable');
  const c = fake();
  errorLog.configure({ client: c, now: (() => { let t = 0; return () => t; })() });
  await new Promise(r => setTimeout(r, 10));
  // 20 buffered, all within the 20/hour device cap
  assert.equal(c.calls.rows.length, 20);
  assert.equal(c.calls.rows[0].message, 'b0');
  errorLog.configure({ appVersion: 'x' });
  assert.equal(c.calls.rows.length, 20);
});

test('bootApp loads error-log.js and exposes errorLog.report', async () => {
  const { api, cleanup } = await bootApp();
  try { assert.equal(typeof api.errorLog.report, 'function'); } finally { cleanup(); }
});
