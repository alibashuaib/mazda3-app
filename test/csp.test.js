'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/* index.html's meta CSP allows its inline scripts by hash. Editing one without
   updating the hash makes the browser silently skip it (theme/accent flash). */
const ROOT = path.join(__dirname, '..');
const page = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const csp = (page.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/) || [])[1];

test('CSP meta comes before every script', () => {
  assert.ok(csp, 'index.html: no CSP meta');
  assert.ok(page.indexOf('Content-Security-Policy') < page.indexOf('<script'));
});

test('CSP lists the hash of every inline script', () => {
  for (const m of page.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
    const h = 'sha256-' + crypto.createHash('sha256').update(m[1]).digest('base64');
    assert.ok(csp.includes(`'${h}'`), `inline script missing from CSP: ${h}`);
  }
});

test('CSP connect-src allows the Supabase backend', () => {
  const url = fs.readFileSync(path.join(ROOT, 'src/data/account.js'), 'utf8').match(/SUPABASE_URL = '([^']+)'/)[1];
  assert.ok(csp.includes(url), `connect-src missing ${url}`);
  assert.ok(csp.includes(url.replace('https://', 'wss://')), 'connect-src missing realtime wss');
});
