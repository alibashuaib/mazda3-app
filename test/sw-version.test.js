'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { computeHash, checkCacheLine } = require('../tools/sw-version.js');

/* In-memory io: files is { rel: string }. Records every path asked for so the
   './' directory entry can be proven never to reach read (W-04). */
function memIo(files) {
  const asked = [];
  return { asked, files,
    read: rel => { asked.push(rel); return Buffer.from(files[rel]); },
    write: (rel, s) => { files[rel] = s; } };
}
const sw = (cache, assets) => `const CACHE = '${cache}';\nconst ASSETS = [\n  ${assets.map(a => `'${a}'`).join(',\n  ')}\n];\nself.x = 1;\n`;
function base() {
  return { 'sw.js': sw('garage-aaaaaaaaaaaa', ['./', './a.js', './b.css']), 'a.js': 'one\ntwo\n', 'b.css': 'x{}\n' };
}

test('computeHash has the garage-<12 hex> shape', () => {
  assert.match(computeHash(memIo(base())), /^garage-[0-9a-f]{12}$/);
});
test('computeHash ignores CRLF vs LF', () => {
  const f = base(); f['a.js'] = 'one\r\ntwo\r\n';
  assert.strictEqual(computeHash(memIo(f)), computeHash(memIo(base())));
});
test('computeHash skips directory entries and never reads them', () => {
  const io = memIo(base());
  computeHash(io);
  assert.deepStrictEqual(io.asked.filter(p => p !== 'sw.js'), ['a.js', 'b.css']);
});
test('computeHash ignores the CACHE line value', () => {
  const f = base(); f['sw.js'] = f['sw.js'].replace('aaaaaaaaaaaa', 'bbbbbbbbbbbb');
  assert.strictEqual(computeHash(memIo(f)), computeHash(memIo(base())));
});
test('computeHash changes when an asset changes', () => {
  const f = base(); f['b.css'] += ' ';
  assert.notStrictEqual(computeHash(memIo(f)), computeHash(memIo(base())));
});
test('computeHash changes when an ASSETS entry is added', () => {
  const f = base(); f['c.js'] = 'c'; f['sw.js'] = sw('garage-aaaaaaaaaaaa', ['./', './a.js', './b.css', './c.js']);
  assert.notStrictEqual(computeHash(memIo(f)), computeHash(memIo(base())));
});
test('checkCacheLine flags a stale value with the instruction', () => {
  const r = checkCacheLine(memIo(base()));
  assert.strictEqual(r.ok, false);
  assert.match(r.message, /npm run sw:version/);
});
test('checkCacheLine is ok once the computed value is written', () => {
  const f = base();
  f['sw.js'] = f['sw.js'].replace('garage-aaaaaaaaaaaa', computeHash(memIo(f)));
  assert.strictEqual(checkCacheLine(memIo(f)).ok, true);
});
test('real repo sw.js CACHE is current', () => {
  const r = checkCacheLine();
  assert.strictEqual(r.ok, true, r.message);
});
