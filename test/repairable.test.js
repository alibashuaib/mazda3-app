'use strict';
const test = require('node:test');
const assert = require('node:assert');
const repairable = require('../src/data/repairable.js');

test('every entry is bilingual, has keywords, and avoids diagnosis wording', () => {
  assert.ok(repairable.LIST.length >= 6);
  const ids = new Set();
  for (const e of repairable.LIST) {
    assert.ok(e.id && !ids.has(e.id), 'unique id ' + e.id); ids.add(e.id);
    assert.ok(Array.isArray(e.keywords) && e.keywords.length > 0, e.id + ' keywords');
    assert.ok(e.keywords.some(k => /[؀-ۿ]/.test(k)), e.id + ' needs an Arabic keyword');
    assert.ok(e.keywords.some(k => /[a-z]/.test(k)), e.id + ' needs an English keyword');
    assert.ok(e.tipEn.length > 20 && e.tipAr.length > 10, e.id + ' tips');
    assert.ok(/\b(often|can|may|sometimes)\b/i.test(e.tipEn), e.id + ' must hedge ("often/can/may")');
    assert.ok(!/\byour\b/i.test(e.tipEn), e.id + ' must not address the owner\'s specific part');
  }
});

test('tipFor matches English and Arabic names case-insensitively and ignores unrelated parts', () => {
  assert.strictEqual(repairable.tipFor('Front Headlight (left)').id, 'headlight');
  assert.strictEqual(repairable.tipFor('  HEADLIGHT restoration ').id, 'headlight');
  assert.strictEqual(repairable.tipFor('مصباح أمامي').id, 'headlight');
  assert.strictEqual(repairable.tipFor('Engine Oil 5W-30'), null);
  assert.strictEqual(repairable.tipFor(''), null);
  assert.strictEqual(repairable.tipFor(null), null);
});

test('tipFor returns a copy without keywords', () => {
  const t = repairable.tipFor('Windscreen');
  assert.deepStrictEqual(Object.keys(t).sort(), ['id', 'tipAr', 'tipEn']);
});

test('short keywords do not match inside unrelated words; cabin filter is not A/C compressor', () => {
  assert.strictEqual(repairable.tipFor('Cabin (A/C) Filter'), null);
  assert.strictEqual(repairable.tipFor('Primary relay'), null);
  assert.strictEqual(repairable.tipFor('Trim clip'), null);
  assert.strictEqual(repairable.tipFor('Accident report fee'), null);
  assert.strictEqual(repairable.tipFor('Alloy Rim refinish').id, 'alloy');
  assert.strictEqual(repairable.tipFor('Door dent repair').id, 'dent');
  assert.strictEqual(repairable.tipFor('A/C compressor').id, 'ac');
});

test('tip() returns the language asked for', () => {
  const t = repairable.tipFor('Windscreen');
  assert.strictEqual(repairable.tip('Windscreen', 'en'), t.tipEn);
  assert.strictEqual(repairable.tip('Windscreen', 'ar'), t.tipAr);
  assert.strictEqual(repairable.tip('Spark plugs', 'en'), null);
});
