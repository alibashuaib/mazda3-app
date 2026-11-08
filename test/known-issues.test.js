'use strict';
const test = require('node:test');
const assert = require('node:assert');
const knownIssues = require('../src/data/known-issues.js');
const { bootApp } = require('./helpers/boot.js');

const client = (rows, err, counter, seen) => ({ from: t => {
  assert.strictEqual(t, 'known_issues'); counter.n++;
  const p = Promise.resolve({ data: err ? null : rows, error: err || null });
  const c = { then: p.then.bind(p), catch: p.catch.bind(p) };
  c.select = cols => { if (seen) seen.cols = cols; return c; };
  c.eq = (k, v) => { if (seen) seen.eq = [k, v]; return c; };
  return c;
} });

test('forCar filters by car_model_id, selects the issue columns, caches within the window', async () => {
  const n = { n: 0 }, seen = {};
  knownIssues.configure({ client: client([{ issue_key: 'k', title: 'T' }], null, n, seen) });
  const a = await knownIssues.forCar('cx5kf:2.5l'), b = await knownIssues.forCar('cx5kf:2.5l');
  assert.strictEqual(a.length, 1); assert.strictEqual(b.length, 1);
  assert.deepStrictEqual(seen.eq, ['car_model_id', 'cx5kf:2.5l']);
  assert.strictEqual(seen.cols, 'issue_key,title,summary,typical_km,mentions,sources');
  assert.strictEqual(n.n, 1);
  knownIssues.reset();
});
test('forCar resolves [] on error (not cached) and with no client', async () => {
  const n = { n: 0 };
  knownIssues.configure({ client: client(null, { message: 'x' }, n) });
  assert.deepStrictEqual(await knownIssues.forCar('m'), []);
  await knownIssues.forCar('m');
  assert.strictEqual(n.n, 2);
  knownIssues.reset();
  assert.deepStrictEqual(await knownIssues.forCar('m'), []);
});

const veh = (modelId, engine) => [{ id: 'v1', data: {
  car: { nickname: 'KI', modelId, engine, catalogId: modelId + ':' + engine.toLowerCase(), odometer: 1000 },
  budget: { annual: 6000 }, services: [], parts: [], history: [], spending: [], fuel: [], docs: [] } }];
const tick = () => new Promise(r => setTimeout(r, 20));

test('dashboard card: text only, https links only, hidden when empty', async () => {
  const app = await bootApp({ vehicles: veh('mazda3bp', '2.0L SkyActiv-G') });
  try {
    const { api, document } = app;
    const rows = [{ issue_key: 'a', title: '<img src=x onerror=alert(1)>', typical_km: 90000, mentions: 4,
      sources: [{ url: 'https://forum.example/t/1' }, { url: 'javascript:alert(1)' }] }];
    api.knownIssues.configure({ client: client(rows, null, { n: 0 }) });
    api.go('dashboard'); await tick();
    const box = document.querySelector('.known-issues');
    assert.ok(box && !box.hidden);
    assert.ok(box.textContent.includes('<img src=x onerror=alert(1)>'));
    assert.strictEqual(box.querySelector('img'), null);
    assert.ok(box.textContent.includes('90,000') || box.textContent.includes('90000'));
    assert.ok(box.textContent.includes('4 '));
    const links = box.querySelectorAll('a');
    assert.strictEqual(links.length, 1);
    assert.strictEqual(links[0].getAttribute('rel'), 'noopener noreferrer');
    assert.strictEqual(links[0].textContent, 'forum.example');
    api.knownIssues.configure({ client: client([], null, { n: 0 }) });
    api.go('dashboard'); await tick();
    assert.ok(document.querySelector('.known-issues').hidden);
  } finally { app.cleanup(); }
});

test('in-progress note: only server-registered models with a loaded, empty cache', async () => {
  const NOTE = 'Catalogue in progress';
  const app = await bootApp({ vehicles: veh('zz9', '2.0L Test') });
  try {
    const { api, document } = app;
    api.go('dashboard'); await tick();
    assert.ok(!document.body.textContent.includes(NOTE), 'not registered / not loaded');
    api.remoteCatalog.configure({ metaGet: () => ({ catalogue: { models: [{ id: 'zz9:2.0l-test', model: 'ZZ', generation: 'g', engine: '2.0L Test' }], items: [], parts: [] } }) });
    assert.strictEqual(await api.remoteCatalog.load(), true);
    // boot normalises an unknown modelId away before the server models register; set it as a registered-then-loaded garage would have it
    api.session.current().car.modelId = 'zz9';
    api.go('dashboard'); await tick();
    assert.ok(document.body.textContent.includes(NOTE));
  } finally { app.cleanup(); }
  const built = await bootApp({ vehicles: veh('mazda3bp', '2.0L SkyActiv-G') });
  try {
    built.api.remoteCatalog.configure({ metaGet: () => ({ catalogue: { models: [], items: [], parts: [] } }) });
    await built.api.remoteCatalog.load();
    built.api.go('dashboard'); await tick();
    assert.ok(!built.document.body.textContent.includes(NOTE), 'static car never shows it');
  } finally { built.cleanup(); }
});

test('dashboard recall banner queries recalls by the catalog id (car_models.id FK) and renders the row', async () => {
  const app = await bootApp({ vehicles: veh('mazda3bp', '2.0L SkyActiv-G') });
  try {
    const { api, document } = app, seen = {};
    const rc = { from: t => {
      assert.strictEqual(t, 'recalls');
      const p = Promise.resolve({ data: [{ campaign: '24V001', component: 'FUEL PUMP', summary: 's', years: [2020] }], error: null });
      const c = { then: p.then.bind(p), catch: p.catch.bind(p) };
      c.select = () => c; c.eq = (k, v) => { seen[k] = v; return c; };
      return c;
    } };
    api.recalls.configure({ client: rc });
    api.go('dashboard'); await tick();
    assert.strictEqual(seen.car_model_id, api.session.current().car.catalogId);
    assert.ok(document.querySelector('.recall-box').textContent.includes('24V001'));
  } finally { app.cleanup(); }
});
