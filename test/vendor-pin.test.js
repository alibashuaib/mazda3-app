'use strict';
/* ==== Vendor pin — supabase.js must match vendor/pins.json ====
   Supply-chain check (T-01-12): any byte change to the vendored client fails
   here until pins.json and README.md are updated in the same change. Offline
   on purpose: the hash is over the committed bytes, no network. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const root = path.join(__dirname, '..');
const pin = JSON.parse(fs.readFileSync(path.join(root, 'vendor', 'pins.json'), 'utf8'))['supabase.js'];
const MSG = 'vendor/supabase.js changed without updating vendor/pins.json and vendor/README.md; update both in the same change';

test('vendor/supabase.js matches its sha256 and byte pin', () => {
  const buf = fs.readFileSync(path.join(root, 'vendor', 'supabase.js'));
  assert.strictEqual(createHash('sha256').update(buf).digest('hex'), pin.sha256, MSG);
  assert.strictEqual(buf.length, pin.bytes, MSG);
});
