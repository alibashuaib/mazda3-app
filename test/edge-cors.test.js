'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const url = require('url');
const fnDir = path.join(__dirname, '..', 'supabase', 'functions');
const load = () => import(url.pathToFileURL(path.join(fnDir, '_shared', 'cors.mjs')).href);
const PROD = 'https://alibashuaib.github.io';

test('CORS: missing Origin passes with no CORS headers (cron path)', async () => {
  const { corsDecision, allowedOrigins } = await load();
  for (const o of [undefined, null, '']) {
    const d = corsDecision(o, allowedOrigins());
    assert.strictEqual(d.ok, true);
    assert.strictEqual(d.headers['Access-Control-Allow-Origin'], undefined);
  }
});

test('CORS: production origin passes with exact ACAO', async () => {
  const { corsDecision, allowedOrigins } = await load();
  const d = corsDecision(PROD, allowedOrigins());
  assert.strictEqual(d.ok, true);
  assert.strictEqual(d.headers['Access-Control-Allow-Origin'], PROD);
  assert.strictEqual(d.headers['Vary'], 'Origin');
});

test('CORS: Origin "null" (file://) is refused', async () => {
  const { corsDecision, allowedOrigins } = await load();
  assert.strictEqual(corsDecision('null', allowedOrigins()).ok, false);
});

test('CORS: suffix attack and foreign origin are refused', async () => {
  const { corsDecision, allowedOrigins } = await load();
  assert.strictEqual(corsDecision(PROD + '.evil.example', allowedOrigins()).ok, false);
  assert.strictEqual(corsDecision('https://evil.example', allowedOrigins()).ok, false);
});

test('CORS: dev origin only via ALLOWED_ORIGINS', async () => {
  const { corsDecision, allowedOrigins } = await load();
  assert.strictEqual(corsDecision('http://localhost:5173', allowedOrigins()).ok, false);
  assert.strictEqual(corsDecision('http://localhost:5173', allowedOrigins('http://localhost:5173')).ok, true);
});

test('CORS: allowedOrigins trims and drops empties', async () => {
  const { allowedOrigins } = await load();
  assert.deepStrictEqual(allowedOrigins(' http://a.test , ,http://b.test'), [PROD, 'http://a.test', 'http://b.test']);
});

test('CORS: edge sources have no wildcard ACAO and gate before OPTIONS/auth', () => {
  for (const f of ['plan-intake', 'read-bill']) {
    const src = fs.readFileSync(path.join(fnDir, f, 'index.ts'), 'utf8');
    assert.ok(!/Access-Control-Allow-Origin['"]?\s*:\s*['"]\*/.test(src), f + ' has wildcard ACAO');
    const gate = src.indexOf('corsDecision(');
    assert.ok(gate > 0, f + ' missing corsDecision');
    assert.ok(gate < src.indexOf("=== 'OPTIONS'"), f + ' gate after OPTIONS');
    assert.ok(gate < src.indexOf('getUser'), f + ' gate after auth');
  }
});

test('CORS: the outer-catch 500 response carries the CORS headers (both functions)', () => {
  for (const f of ['read-bill', 'plan-intake']) {
    const src = fs.readFileSync(path.join(fnDir, f, 'index.ts'), 'utf8');
    assert.match(src, /status: 500, headers: \{ \.\.\.corsHeaders,/, f);
  }
});
