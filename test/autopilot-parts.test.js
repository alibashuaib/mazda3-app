'use strict';
/* Parts gates: materiality, 2-host part numbers, fitment, citation prices, trim, slots, generic list parity. */
const test = require('node:test');
const assert = require('node:assert');

const load = () => import('../supabase/functions/autopilot/parts.mjs');
const cfg = { minPct: 0.1, minSar: 5 };
const car = { model: 'CX-5', generation: '2017-2024 (KF)', engine: '2.5L SkyActiv-G' };

test('isMaterial: needs both pct and SAR; no live value always material', async () => {
  const { isMaterial } = await load();
  assert.strictEqual(isMaterial(null, 30, cfg), true);
  assert.strictEqual(isMaterial(100, 110, cfg), true);
  assert.strictEqual(isMaterial(100, 109.99, cfg), false);
  assert.strictEqual(isMaterial(40, 44.99, cfg), false);
  assert.strictEqual(isMaterial(40, 45, cfg), true);
  assert.strictEqual(isMaterial(200, 204.99, cfg), false);
});

test('confirmParts: subdomains count once; two sites confirm; short numbers and official tier do not', async () => {
  const { confirmParts } = await load();
  const c = (part_no, host, tier) => ({ part_no, host, tier });
  assert.strictEqual(confirmParts([c('PE01-14-302B', 'partsouq.com'), c('pe0114302b', 'shop.partsouq.com')]).length, 0);
  const ok = confirmParts([c('PE01-14-302B', 'partsouq.com'), c('PE01 14 302B', 'mazdaparts.com')]);
  assert.strictEqual(ok.length, 1);
  assert.deepStrictEqual(ok[0].hosts, ['partsouq.com', 'mazdaparts.com']);
  assert.strictEqual(confirmParts([c('AB-12', 'a.com'), c('AB-12', 'b.com')]).length, 0);
  assert.strictEqual(confirmParts([c('PE01-14-302B', 'www.mazda.com.sa', 'official')]).length, 0);
});

test('PART_NO_RE matches Mazda-style numbers', async () => {
  const { PART_NO_RE } = await load();
  assert.ok(PART_NO_RE.test('Oil filter PE01-14-302B fits'));
  assert.ok(!PART_NO_RE.test('no number here'));
});

test('checkFitment: model, year and engine gates', async () => {
  const { checkFitment } = await load();
  assert.deepStrictEqual(checkFitment('Mazda CX-5 2.5L oil filter PE01-14-302B', car), { ok: true });
  assert.strictEqual(checkFitment('CX-5 2.0L oil filter', car).reason, 'engine_mismatch');
  assert.deepStrictEqual(checkFitment('CX-5 2.0L / 2.5L filter', car), { ok: true });
  assert.strictEqual(checkFitment('CX-5 2013 oil filter', car).reason, 'generation_mismatch');
  assert.strictEqual(checkFitment('CX-5 2019 oil filter', car).ok, true);
  assert.strictEqual(checkFitment('Mazda 3 oil filter', car).reason, 'model_missing');
  assert.strictEqual(checkFitment('CX-50 oil filter', car).reason, 'model_missing');
  // an aftermarket number like 150-2010 is not a model year
  assert.strictEqual(checkFitment('CX-5 Denso 150-2010 filter', car).ok, true);
});

test('priceFromCitation: number beside SAR unit only', async () => {
  const { priceFromCitation } = await load();
  assert.strictEqual(priceFromCitation('Oil filter PE01-14-302A SAR 26.50', 26.5), true);
  assert.strictEqual(priceFromCitation('٢٦ ر.س', 26), true);
  assert.strictEqual(priceFromCitation('Oil filter 26 ريال شامل', 26), true);
  assert.strictEqual(priceFromCitation('Oil filter 26 USD', 26), false);
  assert.strictEqual(priceFromCitation('SAR 40 for 26 filters', 26), false);
  assert.strictEqual(priceFromCitation('', 26), false);
});

test('trimmedMedian: drops +-30% outliers and reports users after trimming', async () => {
  const { trimmedMedian } = await load();
  assert.deepStrictEqual(trimmedMedian([40, 42, 41, 100]), { users: 3, median: 41 });
  assert.ok(trimmedMedian([10, 40]).users < 3);
  assert.deepStrictEqual(trimmedMedian([]), { users: 0, median: null });
});

test('altSlot: slug with prefix, max 40 chars', async () => {
  const { altSlot } = await load();
  assert.strictEqual(altSlot('Denso 150-2010'), 'alt:denso-150-2010');
  assert.ok(altSlot('x'.repeat(80)).length <= 'alt:'.length + 40);
});

test('GENERIC_PARTS equals the part names sharedParts returns for an unknown model', async () => {
  const { GENERIC_PARTS } = await load();
  const { sharedParts } = require('../src/data/catalog.js');
  assert.deepStrictEqual([...GENERIC_PARTS], sharedParts('no-such-model', '').map(p => p.name));
});

test('security: numeric model needs maker word; price dot is literal; shared-host subdomains are one source', async () => {
  const { checkFitment, priceFromCitation } = await load();
  const m3 = { model: '3', generation: null, engine: null };
  assert.strictEqual(checkFitment('CX-3 oil filter', m3).reason, 'model_missing');
  assert.strictEqual(checkFitment('2.5L oil filter', { model: '2' }).reason, 'model_missing');
  assert.strictEqual(checkFitment('Mazda3 oil filter', m3).ok, true);
  assert.strictEqual(checkFitment('Mazda 3 oil filter', m3).ok, true);
  assert.strictEqual(priceFromCitation('SAR 2615', 26.5), false);
  assert.strictEqual(priceFromCitation('SAR 26.50', 26.5), true);
  const { registrableHost } = await import('../supabase/functions/autopilot/logic.mjs');
  assert.strictEqual(registrableHost('a.blogspot.com'), registrableHost('b.blogspot.com'));
  const { confirmParts } = await load();
  assert.strictEqual(confirmParts([{ part_no: 'PE01-14-302B', host: 'a.blogspot.com' }, { part_no: 'PE01-14-302B', host: 'b.blogspot.com' }]).length, 0);
  assert.strictEqual(registrableHost('www.example.com.sa'), 'example.com.sa');
});

test('security: part number must match a whole token in the quote, not a substring', async () => {
  const { PART_NO_RE, normPart } = await load();
  const toks = q => (q.toUpperCase().match(new RegExp(PART_NO_RE.source, 'g')) || []).map(normPart);
  assert.ok(!toks('see ABC1234 here').includes(normPart('PE01-14-302')));
  assert.ok(toks('see PE01-14-302B here').includes(normPart('PE01-14-302B')));
});
