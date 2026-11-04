'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const url = require('url');
const fnDir = path.join(__dirname, '..', 'supabase', 'functions');
const loadGuard = () => import(url.pathToFileURL(path.join(fnDir, '_shared', 'net-guard.mjs')).href);

test('net-guard isSafeUrl refuses unsafe URLs', async () => {
  const { isSafeUrl } = await loadGuard();
  for (const u of ['http://example.com/', 'ftp://example.com/', 'file:///etc/passwd', 'javascript:alert(1)',
    'https://user:pw@example.com/', 'https://example.com:8443/', 'https://2130706433/', 'https://0x7f.1/',
    'https://127.1/', 'https://localhost/', 'https://localhost./', 'https://db.internal/', 'https://x.local/',
    'https://intranet/', 'https://[::1]/', 'not a url']) assert.strictEqual(isSafeUrl(u), false, u);
  assert.strictEqual(isSafeUrl('https://www.mazda.com/path'), true);
  assert.strictEqual(isSafeUrl('https://example.com:443/'), true);
});

test('net-guard isPrivateIp: private ranges blocked', async () => {
  const { isPrivateIp } = await loadGuard();
  for (const ip of ['10.1.2.3', '127.0.0.1', '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.168.1.1',
    '100.64.0.1', '0.0.0.0', '224.0.0.1', '192.0.0.5', '192.0.2.5', '198.18.0.1', '198.19.1.1', '198.51.100.7',
    '203.0.113.9', '::1', '::', 'fc00::1', 'fd12::1', 'fe80::1', 'fec0::1', 'ff02::1', '::ffff:10.0.0.1',
    '::ffff:a00:1', '64:ff9b::a00:1', '2002:0a00:0001::', '2002:a00:1::1']) assert.strictEqual(isPrivateIp(ip), true, ip);
});

test('net-guard isPrivateIp: public addresses pass', async () => {
  const { isPrivateIp } = await loadGuard();
  for (const ip of ['8.8.8.8', '172.32.0.1', '198.20.0.1', '2606:4700::1111', '::ffff:8.8.8.8', '64:ff9b::808:808'])
    assert.strictEqual(isPrivateIp(ip), false, ip);
});

test('net-guard isPrivateIp: garbage fails closed', async () => {
  const { isPrivateIp } = await loadGuard();
  for (const ip of ['', 'nope', '1:2:3', null]) assert.strictEqual(isPrivateIp(ip), true, String(ip));
});

/* ---------- safeFetch matrix (fake fetch + fake resolve) ---------- */
const fs = require('fs');
const loadSF = () => import(url.pathToFileURL(path.join(fnDir, '_shared', 'safe-fetch.mjs')).href);
const PUB = ['93.184.216.34'];
const enc = (s) => new TextEncoder().encode(s);

// routes: url -> { status, headers, body (string|Uint8Array|chunks[]), stall }
function mk(routes, dns = {}) {
  const calls = [];
  const fetch = async (u, init) => {
    calls.push(u);
    const r = routes[u];
    if (!r) throw new Error('network ' + u);
    const { status = 200, headers = {}, body = '', stall = false } = r;
    const chunks = Array.isArray(body) ? body : [body];
    let i = 0;
    const stream = { getReader: () => ({
      read: () => {
        if (stall) return new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted'))));
        if (i >= chunks.length) return Promise.resolve({ done: true });
        const c = chunks[i++];
        return Promise.resolve({ done: false, value: typeof c === 'string' ? enc(c) : c });
      },
      cancel: async () => {},
    }), cancel: async () => {} };
    return { status, ok: status >= 200 && status < 300, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, body: stream };
  };
  const resolve = async (h) => (h in dns ? dns[h] : PUB);
  return { deps: { fetch, resolve }, calls };
}
const HTML = { 'content-type': 'text/html; charset=utf-8' };
const run = async (u, routes, dns, policy) => {
  const { safeFetch, DEFAULT_POLICY } = await loadSF();
  const m = mk(routes, dns);
  return { r: await safeFetch(u, { ...DEFAULT_POLICY, respectRobots: false, ...policy }, m.deps), calls: m.calls };
};
const A = 'https://a.example.com/';

test('safeFetch: happy path returns text with finalUrl', async () => {
  const { r } = await run(A, { [A]: { headers: HTML, body: '<p>hi</p>' } });
  assert.deepStrictEqual(r, { ok: true, kind: 'text', body: '<p>hi</p>', finalUrl: A });
});

test('safeFetch: scheme and host refusals', async () => {
  for (const u of ['http://a.example.com/', 'https://localhost/', 'https://a.example.com:8443/', 'https://u:p@a.example.com/']) {
    const { r, calls } = await run(u, {});
    assert.deepStrictEqual(r, { ok: false, error: 'blocked' }, u);
    assert.strictEqual(calls.length, 0);
  }
});

test('safeFetch: one private record among public ones is blocked', async () => {
  const { r } = await run(A, { [A]: { headers: HTML } }, { 'a.example.com': ['93.184.216.34', '10.0.0.5'] });
  assert.strictEqual(r.error, 'blocked');
});

test('safeFetch: empty or unavailable DNS fails closed', async () => {
  assert.strictEqual((await run(A, { [A]: { headers: HTML } }, { 'a.example.com': [] })).r.error, 'blocked');
  assert.strictEqual((await run(A, { [A]: { headers: HTML } }, { 'a.example.com': null })).r.error, 'blocked');
});

test('safeFetch: redirect to private host is blocked although first host is public', async () => {
  const B = 'https://b.example.com/';
  const { r } = await run(A, { [A]: { status: 302, headers: { location: B } }, [B]: { headers: HTML } }, { 'b.example.com': ['127.0.0.1'] });
  assert.strictEqual(r.error, 'blocked');
});

test('safeFetch: rebinding on second hop is blocked', async () => {
  const B = 'https://b.example.com/';
  const { r } = await run(A, { [A]: { status: 301, headers: { location: B } }, [B]: { headers: HTML } }, { 'b.example.com': ['169.254.169.254'] });
  assert.strictEqual(r.error, 'blocked');
});

test('safeFetch: redirect to http is blocked', async () => {
  const { r } = await run(A, { [A]: { status: 302, headers: { location: 'http://b.example.com/' } } });
  assert.strictEqual(r.error, 'blocked');
});

test('safeFetch: 3 hops ok, 4th hop refused', async () => {
  const u = (n) => `https://h${n}.example.com/`;
  const ok = await run(u(0), { [u(0)]: { status: 302, headers: { location: u(1) } }, [u(1)]: { status: 302, headers: { location: u(2) } },
    [u(2)]: { status: 302, headers: { location: u(3) } }, [u(3)]: { headers: HTML, body: 'x' } });
  assert.strictEqual(ok.r.ok, true);
  const bad = await run(u(0), { [u(0)]: { status: 302, headers: { location: u(1) } }, [u(1)]: { status: 302, headers: { location: u(2) } },
    [u(2)]: { status: 302, headers: { location: u(3) } }, [u(3)]: { status: 302, headers: { location: u(4) } }, [u(4)]: { headers: HTML } });
  assert.strictEqual(bad.r.error, 'redirect');
});

test('safeFetch: redirect loop and 3xx without Location are refused', async () => {
  const B = 'https://b.example.com/';
  assert.strictEqual((await run(A, { [A]: { status: 302, headers: { location: B } }, [B]: { status: 302, headers: { location: A } } })).r.error, 'redirect');
  assert.strictEqual((await run(A, { [A]: { status: 302 } })).r.error, 'redirect');
});

test('safeFetch: content-type allowlist', async () => {
  for (const headers of [{ 'content-type': 'application/json' }, { 'content-type': 'image/png' }, {}])
    assert.strictEqual((await run(A, { [A]: { headers, body: 'x' } })).r.error, 'type');
  assert.strictEqual((await run(A, { [A]: { headers: { 'content-type': 'application/pdf' }, body: 'x' } })).r.ok, true);
});

test('safeFetch: non-2xx status is refused', async () => {
  assert.strictEqual((await run(A, { [A]: { status: 404, headers: HTML } })).r.error, 'status');
});

test('safeFetch: streamed body over cap without content-length returns size', async () => {
  const { r } = await run(A, { [A]: { headers: HTML, body: ['aaaa', 'bbbb', 'cccc'] } }, {}, { maxTextBytes: 10 });
  assert.strictEqual(r.error, 'size');
});

test('safeFetch: content-length over cap returns size', async () => {
  const { r } = await run(A, { [A]: { headers: { ...HTML, 'content-length': '999' }, body: 'x' } }, {}, { maxTextBytes: 10 });
  assert.strictEqual(r.error, 'size');
});

test('safeFetch: stalled body hits the deadline', async () => {
  const { r } = await run(A, { [A]: { headers: HTML, stall: true } }, {}, { deadlineMs: 30 });
  assert.strictEqual(r.error, 'timeout');
});

test('safeFetch: robots matrix', async () => {
  const { safeFetch, DEFAULT_POLICY } = await loadSF();
  const R = 'https://a.example.com/robots.txt', P = 'https://a.example.com/private/x';
  const go = async (robots) => safeFetch(P, DEFAULT_POLICY, mk({ [P]: { headers: HTML, body: 'ok' }, ...(robots ? { [R]: robots } : {}) }).deps);
  const TXT = { 'content-type': 'text/plain' };
  assert.strictEqual((await go({ headers: TXT, body: 'User-agent: *\nDisallow: /private' })).error, 'robots');
  assert.strictEqual((await go({ headers: TXT, body: 'User-agent: *\nDisallow: /private\nAllow: /private/x' })).ok, true);
  assert.strictEqual((await go({ headers: TXT, body: 'User-agent: *\nDisallow:' })).ok, true);
  assert.strictEqual((await go({ status: 500 })).error, 'robots');
  assert.strictEqual((await go({ status: 404 })).ok, true);
  assert.strictEqual((await go(null)).error, 'robots');          // network error on robots.txt
});

test('robots: pathological wildcard pattern on a long path returns quickly', async () => {
  const { safeFetch, DEFAULT_POLICY } = await loadSF();
  const R = 'https://a.example.com/robots.txt', P = 'https://a.example.com/' + 'a'.repeat(900);
  const bad = 'Disallow: /' + '*a'.repeat(200) + 'b$';
  const t0 = Date.now();
  const r = await safeFetch(P, DEFAULT_POLICY, mk({ [P]: { headers: HTML, body: 'ok' }, [R]: { headers: { 'content-type': 'text/plain' }, body: 'User-agent: *\n' + bad } }).deps);
  assert.ok(Date.now() - t0 < 500, 'took ' + (Date.now() - t0));
  assert.strictEqual(r.ok, true);                                  // pattern cannot match, so allowed
});

test('robots: wildcard and anchor semantics, longest match wins', async () => {
  const { safeFetch, DEFAULT_POLICY } = await loadSF();
  const R = 'https://a.example.com/robots.txt';
  const go = async (path, body) => (await safeFetch('https://a.example.com' + path, DEFAULT_POLICY,
    mk({ ['https://a.example.com' + path]: { headers: HTML, body: 'ok' }, [R]: { headers: { 'content-type': 'text/plain' }, body } }).deps)).ok;
  assert.strictEqual(await go('/a/file.pdf', 'User-agent: *\nDisallow: /*.pdf$'), false);
  assert.strictEqual(await go('/a/file.pdf?x=1', 'User-agent: *\nDisallow: /*.pdf$'), true);
  assert.strictEqual(await go('/a/b', 'User-agent: *\nDisallow: /a/*/x'), true);
  assert.strictEqual(await go('/a/q/x/y', 'User-agent: *\nDisallow: /a/*/x'), false);
  assert.strictEqual(await go('/a/b', 'User-agent: *\nDisallow: /a\nAllow: /a/b'), true);
});

test('dns resolveAll: only NotFound is empty; other errors fail closed', async () => {
  const { resolveAll } = await import(url.pathToFileURL(path.join(fnDir, '_shared', 'dns-logic.mjs')).href);
  class NotFound extends Error {}
  const isNF = (e) => e instanceof NotFound;
  const fake = (m) => async (h, t) => { const v = m[t]; if (v instanceof Error) throw v; return v; };
  assert.deepStrictEqual(await resolveAll(fake({ A: ['1.2.3.4'], AAAA: new NotFound() }), isNF, 'h'), ['1.2.3.4']);
  assert.strictEqual(await resolveAll(fake({ A: new Error('SERVFAIL'), AAAA: ['2606:4700::1111'] }), isNF, 'h'), null);
  assert.deepStrictEqual(await resolveAll(fake({ A: new NotFound(), AAAA: new NotFound() }), isNF, 'h'), []);
  // and safeFetch blocks on both null and the empty answer
  const { safeFetch, DEFAULT_POLICY } = await loadSF();
  for (const ans of [null, []]) {
    const r = await safeFetch(A, { ...DEFAULT_POLICY, respectRobots: false }, { fetch: async () => { throw new Error('no'); }, resolve: async () => ans });
    assert.deepStrictEqual(r, { ok: false, error: 'blocked' });
  }
});

test('safeFetch: never throws on a throwing fetch', async () => {
  const { safeFetch, DEFAULT_POLICY } = await loadSF();
  const r = await safeFetch(A, { ...DEFAULT_POLICY, respectRobots: false }, { fetch: async () => { throw new Error('boom'); }, resolve: async () => PUB });
  assert.deepStrictEqual(r, { ok: false, error: 'failed' });
});

test('safeFetch body: text keeps UTF-8 Arabic and htmlToText converts in the caller', async () => {
  const html = '<html><body><p>زيت المحرك</p></body></html>';
  const { r } = await run(A, { [A]: { headers: HTML, body: [enc(html).subarray(0, 25), enc(html).subarray(25)] } });
  assert.strictEqual(r.kind, 'text');
  assert.strictEqual(r.body, html);
  const { htmlToText } = await import(url.pathToFileURL(path.join(fnDir, 'plan-intake', 'logic.mjs')).href);
  assert.strictEqual(htmlToText(r.body), 'زيت المحرك');
});

test('safeFetch body: pdf is base64 of exact bytes', async () => {
  const bytes = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0, 255, 128, 7]);
  const { r } = await run(A, { [A]: { headers: { 'content-type': 'application/pdf' }, body: bytes } });
  assert.strictEqual(r.kind, 'pdf');
  assert.strictEqual(r.body, Buffer.from(bytes).toString('base64'));
});

test('safeFetch body: json allowed under NHTSA_POLICY only', async () => {
  const { safeFetch, NHTSA_POLICY, DEFAULT_POLICY } = await loadSF();
  const u = 'https://api.nhtsa.gov/recalls/x', obj = { results: [{ a: 1 }] };
  const routes = { [u]: { headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj) } };
  const ok = await safeFetch(u, NHTSA_POLICY, mk(routes).deps);
  assert.strictEqual(ok.kind, 'json');
  assert.deepStrictEqual(JSON.parse(ok.body), obj);
  assert.strictEqual(NHTSA_POLICY.respectRobots, false);
  const no = await safeFetch(u, { ...DEFAULT_POLICY, respectRobots: false }, mk(routes).deps);
  assert.strictEqual(no.error, 'type');
});

test('FND-05: every raw fetch( in plan-intake and read-bill targets api.anthropic.com', () => {
  for (const f of ['plan-intake', 'read-bill']) {
    const lines = fs.readFileSync(path.join(fnDir, f, 'index.ts'), 'utf8').split(/\r?\n/);
    for (const l of lines) if (/(^|[^A-Za-z])fetch\(/.test(l)) assert.ok(l.includes('api.anthropic.com'), f + ': ' + l.trim());
  }
});
