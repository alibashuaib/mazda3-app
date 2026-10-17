'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const url = require('url');
const load = () => import(url.pathToFileURL(path.join(__dirname, '..', 'supabase', 'functions', 'plan-intake', 'logic.mjs')).href);

test('isSafeUrl accepts plain https and refuses everything risky', async () => {
  const { isSafeUrl } = await load();
  assert.ok(isSafeUrl('https://www.mazda.com/manual.pdf'));
  for (const bad of ['http://mazda.com/x', 'https://localhost/x', 'https://127.0.0.1/x', 'https://10.0.0.5/x',
    'https://169.254.169.254/x', 'https://[::1]/x', 'https://user:pw@mazda.com/x', 'https://mazda.com:8443/x',
    'https://printer.local/x', 'https://db.internal/x', 'ftp://mazda.com/x', 'not a url'])
    assert.strictEqual(isSafeUrl(bad), false, bad);
});

test('htmlToText strips scripts, styles and tags and caps length', async () => {
  const { htmlToText } = await load();
  const t = htmlToText('<style>a{}</style><script>evil()</script><h1>Oil&nbsp;change</h1><p>every 10,000 km</p>');
  assert.strictEqual(t, 'Oil change every 10,000 km');
  assert.strictEqual(htmlToText('x'.repeat(100), 10).length, 10);
});

test('parseSchedule reads fenced JSON, whitelists keys, clamps and drops bad rows', async () => {
  const { parseSchedule } = await load();
  const text = 'Here:\n```json\n' + JSON.stringify({ items: [
    { service: 'Engine Oil', interval_km: 10000, interval_months: 12, note: 'Use 0W-20', parts: [{ name: 'Oil filter', part_no: 'PE01', qty: 1, evil: 1 }], extra: 'x' },
    { service: 'Brake Fluid', interval_km: -5, interval_months: 'abc' },
    { service: 'Huge', interval_km: 99999999, interval_months: 9999 },
    { service: '', interval_km: 5000 },
    { service: 'Nothing' },
  ] }) + '\n```';
  const r = parseSchedule(text);
  assert.deepStrictEqual(r.map(x => x.service), ['Engine Oil', 'Brake Fluid', 'Huge']);
  assert.deepStrictEqual(r[0].parts, [{ name: 'Oil filter', part_no: 'PE01', qty: 1 }]);
  assert.strictEqual(r[1].interval_km, null); assert.strictEqual(r[1].interval_months, null);
  assert.strictEqual(r[2].interval_km, 1000000); assert.strictEqual(r[2].interval_months, 240);
  assert.ok(!('extra' in r[0]));
});

test('parseSchedule fails closed on garbage', async () => {
  const { parseSchedule } = await load();
  assert.strictEqual(parseSchedule('no json here'), null);
  assert.strictEqual(parseSchedule('{"items": "nope"}'), null);
  assert.strictEqual(parseSchedule('{"items": []}'), null);
});

test('parseRecalls maps NHTSA rows and merges years per campaign', async () => {
  const { parseRecalls } = await load();
  const a = { results: [{ NHTSACampaignNumber: '16V684000', Component: 'FUEL SYSTEM', Summary: 'Fuel leak', Remedy: 'Dealers will replace', Consequence: 'x' }] };
  const r = parseRecalls(a, [2016]);
  assert.deepStrictEqual(r, [{ campaign: '16V684000', component: 'FUEL SYSTEM', summary: 'Fuel leak', remedy: 'Dealers will replace', years: [2016] }]);
  assert.deepStrictEqual(parseRecalls({ results: [] }, [2016]), []);
  assert.deepStrictEqual(parseRecalls(null, [2016]), []);
});

test('diffDraft is false for identical content and true for any change', async () => {
  const { diffDraft } = await load();
  const live = { interval_km: 10000, interval_months: 12, note: 'n', parts: [] };
  assert.strictEqual(diffDraft(live, { ...live }), false);
  assert.strictEqual(diffDraft(live, { ...live, interval_km: 15000 }), true);
  assert.strictEqual(diffDraft(undefined, { ...live }), true);
});
