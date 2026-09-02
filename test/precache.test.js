'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

/* sw.js precaches an explicit ASSETS list. Nothing kept that list in step with
   index.html, so src/ui/color.js shipped in cd65250 without being added: the
   network-first fetch handler caches it at runtime on any online load, which
   hid the gap, but a fresh install that goes offline before its first full
   load never gets the file at all. test/helpers/boot.js already guards
   index.html against ITS script list; this does the same for the precache.

   Only local, same-origin refs are checked. A CDN <script src="https://…">
   is deliberately not precached, and the sw's own fetch handler skips
   non-http(s) schemes anyway. */
const ROOT = path.join(__dirname, '..');

function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

/* Both forms sw.js uses: the literal `const ASSETS = [...]` and the
   `ASSETS.push(...)` batches appended after it. Matching the pushes as well
   is what keeps a future colour-photo batch from being read as missing. */
function swAssets() {
  const src = read('sw.js');
  const literal = src.match(/const ASSETS\s*=\s*\[([\s\S]*?)\]/);
  assert.ok(literal, 'sw.js: could not find the ASSETS array');
  const chunks = [literal[1]];
  for (const m of src.matchAll(/ASSETS\.push\(([\s\S]*?)\)\s*;/g)) chunks.push(m[1]);
  return new Set(
    chunks.join(',').split(',')
      .map(s => s.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean)
      .map(s => s.replace(/^\.\//, ''))
  );
}

/* Local <script src> and <link rel=stylesheet href>. A scheme (https:, //cdn)
   means someone else's origin — not ours to precache. */
function htmlLocalRefs() {
  const src = read('index.html');
  const refs = [];
  for (const m of src.matchAll(/<script\b[^>]*\bsrc=(["'])([^"']+)\1/g)) refs.push(m[2]);
  for (const m of src.matchAll(/<link\b[^>]*\bhref=(["'])([^"']+\.css)\1/g)) refs.push(m[2]);
  return refs.filter(r => !/^([a-z]+:)?\/\//i.test(r)).map(r => r.replace(/^\.\//, ''));
}

test('every local script and stylesheet in index.html is precached by sw.js', () => {
  const assets = swAssets();
  const missing = htmlLocalRefs().filter(r => !assets.has(r));
  assert.deepStrictEqual(missing, [],
    `index.html loads these but sw.js never precaches them — add to ASSETS and bump CACHE:\n  ${missing.join('\n  ')}`);
});

test('sw.js does not precache files that no longer exist', () => {
  const stale = [...swAssets()].filter(a => a && !a.endsWith('/') && !fs.existsSync(path.join(ROOT, a)));
  assert.deepStrictEqual(stale, [],
    `sw.js precaches missing files — install() calls cache.addAll(), which rejects atomically if any single entry 404s, leaving the app with no precache at all:\n  ${stale.join('\n  ')}`);
});

test('the sw cache version is bumped whenever the asset list changes', () => {
  /* Not a drift check — just a floor. A stale CACHE name means activate()
     never evicts the old cache, so returning visitors keep the previous
     ASSETS forever. Pinning the current value makes changing ASSETS without
     touching CACHE a visible, deliberate edit rather than an oversight. */
  const m = read('sw.js').match(/const CACHE\s*=\s*'garage-v(\d+)'/);
  assert.ok(m, 'sw.js: CACHE must stay in the garage-v<N> form the activate() cleanup keys on');
  assert.ok(Number(m[1]) >= 45, 'sw.js: CACHE version went backwards');
});
