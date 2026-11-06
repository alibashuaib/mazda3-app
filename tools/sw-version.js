#!/usr/bin/env node
/* Content-hash cache version for sw.js (D-18). CACHE = 'garage-' + 12 hex of
   SHA-256 over every precached file plus sw.js itself, so a release needs no
   hand bump. Run after editing any file listed in ASSETS:
     npm run sw:version
   test/precache.test.js fails while sw.js holds a stale value. CRLF is folded
   to LF so a Windows checkout hashes the same as CI; the CACHE line is
   replaced by a placeholder first so the hash never depends on itself. */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const CACHE_RE = /^const CACHE\s*=\s*'[^']*';/m;
const defaultIo = {
  read: rel => fs.readFileSync(path.join(ROOT, rel)),
  write: (rel, s) => fs.writeFileSync(path.join(ROOT, rel), s)
};

/* Same parsing as test/precache.test.js: the literal array plus ASSETS.push
   batches. Order is kept (it feeds the hash); directory entries ('./') are
   skipped so they are never read as files. */
function assetList(src) {
  const literal = src.match(/const ASSETS\s*=\s*\[([\s\S]*?)\]/);
  if (!literal) throw new Error('sw.js: could not find the ASSETS array');
  const chunks = [literal[1]];
  for (const m of src.matchAll(/ASSETS\.push\(([\s\S]*?)\)\s*;/g)) chunks.push(m[1]);
  return chunks.join(',').split(',')
    .map(s => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean)
    .map(s => s.replace(/^\.\//, ''))
    .filter(a => a && !a.endsWith('/'));
}
const lf = buf => Buffer.from(buf.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');

function computeHash(io = defaultIo) {
  const src = io.read('sw.js').toString('utf8').replace(/\r\n/g, '\n');
  const h = crypto.createHash('sha256');
  for (const a of assetList(src)) { h.update(a + '\0'); h.update(lf(io.read(a))); h.update('\0'); }
  h.update(src.replace(CACHE_RE, "const CACHE = '__HASH__';"));
  return 'garage-' + h.digest('hex').slice(0, 12);
}

function writeCacheLine(io = defaultIo) {
  const next = computeHash(io);
  const src = io.read('sw.js').toString('utf8');
  io.write('sw.js', src.replace(CACHE_RE, `const CACHE = '${next}';`));
  return next;
}

function checkCacheLine(io = defaultIo) {
  const expected = computeHash(io);
  const m = io.read('sw.js').toString('utf8').match(CACHE_RE);
  const actual = m && m[0].match(/'([^']*)'/)[1];
  const ok = actual === expected;
  return { ok, expected, actual, message: ok ? '' :
    `sw.js CACHE is stale (have ${actual}, want ${expected}). Run npm run sw:version and commit the result.` };
}

module.exports = { computeHash, writeCacheLine, checkCacheLine };

if (require.main === module) {
  if (process.argv.includes('--check')) {
    const r = checkCacheLine();
    if (!r.ok) { console.error(r.message); process.exit(1); }
  } else console.log(writeCacheLine());
}
