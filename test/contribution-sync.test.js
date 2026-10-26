'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { bootApp } = require('./helpers/boot.js');

const tick = () => new Promise(r => setImmediate(r));
const plain = v => JSON.parse(JSON.stringify(v));

test('vehicleContributions: a back-dated full tank changes the economy of the fill-up after it', async () => {
  const app = await bootApp();
  try {
    const data = { car: { modelId: 'mazda3bm', engine: '2.0L' }, history: [], fuel: [
      { id: 'a', date: '2026-07-01', odometer: 10000, litres: 40, cost: 90, full: true },
      { id: 'c', date: '2026-07-20', odometer: 11000, litres: 70, cost: 160, full: true }] };
    const before = plain(app.api.vehicleContributions('v1', data)).find(r => r.source_key === 'fuel:v1:c');
    data.fuel.push({ id: 'b', date: '2026-07-10', odometer: 10500, litres: 35, cost: 80, full: true });
    const rows = plain(app.api.vehicleContributions('v1', data));
    const after = rows.find(r => r.source_key === 'fuel:v1:c');
    assert.notStrictEqual(after.l100, before.l100, 'the later interval was not recomputed');
    assert.ok(rows.some(r => r.source_key === 'fuel:v1:b'));
  } finally { app.cleanup(); }
});

test('vehicleContributions: part rows cover the whole history and carry a persisted shop id', async () => {
  const app = await bootApp();
  try {
    const data = { car: { modelId: 'mazda3bm' }, fuel: [], history: [
      { id: 'h1', date: '2026-01-05', odometer: 10000, parts: [{ part: 'Pads', brand: 'A', price: 200 }], shop: { name: 'S', city: 'C' }, shopId: 's9' },
      { id: 'h2', date: '2026-06-05', odometer: 40000, parts: [{ part: 'Pads', brand: 'B', price: 260 }] },
      { id: 'h3', date: '2026-07-05', odometer: 45000, parts: [{ part: 'Wipers', brand: 'W', price: 40 }], shop: { name: 'T', city: 'C' } }] };
    const rows = plain(app.api.vehicleContributions('v1', data));
    assert.deepStrictEqual(rows.map(r => r.source_key).sort(), ['part:v1:h1:pads', 'part:v1:h2:pads', 'part:v1:h3:wipers']);
    assert.strictEqual(rows.find(r => r.source_key === 'part:v1:h1:pads').shop_id, 's9');
    assert.strictEqual(rows.find(r => r.source_key === 'part:v1:h2:pads').shop_id, null, 'no shop on the record must clear the server link');
    assert.ok(!('shop_id' in rows.find(r => r.source_key === 'part:v1:h3:wipers')), 'shop not yet resolved: the server keeps its stored link');
  } finally { app.cleanup(); }
});

test('afterPurchase persists the shop on the records and re-sends the snapshot with it', async () => {
  const app = await bootApp();
  try {
    const { api } = app;
    const snaps = [];
    api.insights.shareEnabled = () => Promise.resolve(true);
    api.shops.findOrCreate = () => Promise.resolve({ id: 's1', name: 'A', city: 'B' });
    api.openShopFeedback = () => {};
    api.account.enqueueContributionSync = (vid, rows) => { snaps.push(rows); return Promise.resolve(true); };
    const h = { id: 'hx', name: 'Pads', date: '2026-06-05', odometer: 40000, parts: [{ part: 'Pads', brand: 'B', price: 260 }], shop: { name: 'A', city: 'B' } };
    api.session.current().history.push(h);
    await api.afterPurchase([h], { name: 'A', city: 'B', area: '' }, api.session.garage().activeId);
    for (let i = 0; i < 6; i++) await tick();
    assert.strictEqual(api.session.current().history.find(x => x.id === 'hx').shopId, 's1');
    const row = plain(snaps[snaps.length - 1] || []).find(r => r.source_key.includes(':hx:'));
    assert.ok(row && row.shop_id === 's1', 'the snapshot after the link lacks shop_id');
  } finally { app.cleanup(); }
});

test('afterPurchase for a vehicle that is no longer active writes and queues nothing', async () => {
  const app = await bootApp();
  try {
    const { api } = app;
    let saves = 0, snaps = 0;
    api.insights.shareEnabled = () => Promise.resolve(true);
    api.shops.findOrCreate = () => Promise.resolve({ id: 's1', name: 'A', city: 'B' });
    api.openShopFeedback = () => {};
    api.account.enqueueContributionSync = () => { snaps++; return Promise.resolve(true); };
    const save = api.save; api.save = () => { saves++; return save(); };
    await api.afterPurchase([{ id: 'hx' }], { name: 'A', city: 'B', area: '' }, 'some-deleted-vehicle');
    for (let i = 0; i < 6; i++) await tick();
    assert.strictEqual(saves + snaps, 0);
  } finally { app.cleanup(); }
});

test('syncContributions skips a vehicle that is gone by the time consent resolves', async () => {
  const app = await bootApp();
  try {
    const { api } = app;
    let snaps = 0;
    api.insights.shareEnabled = () => Promise.resolve(true);
    api.account.enqueueContributionSync = () => { snaps++; return Promise.resolve(true); };
    api.syncContributions('not-in-garage', { car: {}, history: [], fuel: [] });
    for (let i = 0; i < 4; i++) await tick();
    assert.strictEqual(snaps, 0);
  } finally { app.cleanup(); }
});

test('afterPurchase stops when the account changed or sharing went off during the shop lookup', async () => {
  const app = await bootApp();
  try {
    const { api } = app;
    let prompts = 0, release;
    api.account.setUserForTest({ id: 'A', email: 'a@x' });
    api.insights.shareEnabled = () => Promise.resolve(true);
    api.shops.findOrCreate = () => new Promise(r => { release = () => r({ id: 's1', name: 'A', city: 'B' }); });
    api.openShopFeedback = () => { prompts++; };
    const h = { id: 'hy', name: 'x', date: '2026-01-01', odometer: 1, shop: { name: 'A', city: 'B' } };
    api.session.current().history.push(h);
    const run = api.afterPurchase([h], h.shop, api.session.garage().activeId);
    await tick();
    api.account.setUserForTest({ id: 'B', email: 'b@x' });
    release(); await run;
    assert.strictEqual(prompts, 0, 'A\'s shop prompt was shown to B');
    assert.strictEqual(h.shopId, undefined);

    api.account.setUserForTest({ id: 'A', email: 'a@x' });
    let share = true; api.insights.shareEnabled = () => Promise.resolve(share);
    const run2 = api.afterPurchase([h], h.shop, api.session.garage().activeId);
    await tick(); share = false;
    release(); await run2;
    assert.strictEqual(prompts, 0, 'prompted after opting out');
  } finally { app.cleanup(); }
});
