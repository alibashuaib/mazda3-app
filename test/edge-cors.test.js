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
