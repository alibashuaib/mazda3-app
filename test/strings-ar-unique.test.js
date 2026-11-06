'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

/* In an object literal the LAST duplicate key silently wins, so a stray second
   copy changes what users see without any error. Keep every key once. */
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'i18n', 'strings.ar.js'), 'utf8');
const keys = [...src.matchAll(/'((?:[^'\\\n]|\\.)+)'\s*:/g)].map(m => m[1]);

test('strings.ar.js key scan finds the dictionary', () => {
  assert.ok(keys.length > 200, 'only ' + keys.length + ' keys found; regex broken?');
});

test('strings.ar.js has no duplicate keys', () => {
  const seen = new Set(), dup = new Set();
  keys.forEach(k => { if (seen.has(k)) dup.add(k); seen.add(k); });
  assert.deepStrictEqual([...dup], [], 'duplicate keys: ' + [...dup].join(' | '));
});
