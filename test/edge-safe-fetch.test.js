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
