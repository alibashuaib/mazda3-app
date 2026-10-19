'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { bootApp } = require('./helpers/boot.js');

const tick = () => new Promise(r => setImmediate(r));
const EVIL = '<img src=x onerror=1>';
const stat = (rep, repl, extra, key) => [Object.assign({ item_key: key || 'cabin filter', n_repaired: rep, n_replaced: repl, n_inspected: 0, median_price_repaired: 120, median_price_replaced: 540, median_km_after_repair: null, attention_share: null }, extra)];
const st = (level) => ({ level, kmLeft: level === 'ok' ? 500 : -100, dueDate: new Date('2026-10-01') });

async function line(name, level, { available = true, life = [], repair = [] } = {}) {
  const app = await bootApp();
  try {
    const { api } = app;
    api.insights.available = () => available;
    api.insights.getModelBrandLife = () => Promise.resolve(life);
    api.insights.getModelRepairStats = () => Promise.resolve(repair);
    const item = api.scheduleTimelineItem({ name, icon: '🔧', lastKm: 0 }, st(level), true);
    app.document.body.appendChild(item);   // the async paint only runs while the item is on the page
    await tick(); await tick();
    return item.querySelector('.tl-guide').textContent;
  } finally { app.cleanup(); }
}

test('guidance line: overdue plain item says Replace and that only the Mazda schedule was used', async () => {
  const txt = await line('Cabin Filter', 'danger', { available: false });
  assert.ok(txt.startsWith('Replace'), txt);
  assert.ok(txt.includes('Mazda schedule only'), txt);
});
test('guidance line: community inspection rate makes a not-due item Inspect', async () => {
  const txt = await line('Cabin Filter', 'ok', { repair: stat(0, 0, { n_inspected: 6, attention_share: 0.4 }) });
  assert.ok(txt.startsWith('Inspect'), txt); assert.ok(txt.includes('40%'), txt);
  assert.ok(!txt.includes('Mazda schedule only'), txt);
});
test('guidance line: overdue Brake Pads is Inspect, never Repair first', async () => {
  const txt = await line('Brake Pads', 'danger', { repair: stat(9, 1, {}, 'brake pads') });
  assert.ok(txt.startsWith('Inspect'), txt); assert.ok(!txt.includes('Repair first'), txt);
});
test('guidance line: markup in a service name stays text', async () => {
  const app = await bootApp();
  try {
    app.api.insights.available = () => false;
    const item = app.api.scheduleTimelineItem({ name: EVIL, icon: '🔧', lastKm: 0 }, st('danger'), true);
    assert.strictEqual(item.querySelector('.tl-guide img'), null);
  } finally { app.cleanup(); }
});

async function banner(rows, seen) {
  const app = await bootApp();
  try {
    app.api.recalls.forModel = id => { if (seen) seen.push(id); return Promise.resolve(rows); };
    app.api.go('dashboard'); await tick(); await tick();
    const el0 = app.document.querySelector('.recall-banner'), b = el0 && !el0.hidden ? el0 : null;   // present but hidden counts as none
    return { b, text: b ? b.textContent : '', img: b ? b.querySelector('img') : null };
  } finally { app.cleanup(); }
}
test('recall banner: count, dealer wording, component as text', async () => {
  const r = await banner([{ campaign: 'A', component: EVIL, summary: 's', years: [2016] }, { campaign: 'B', component: 'FUEL', summary: 's', years: [2016] }]);
  assert.ok(r.b, 'banner shown');
  assert.ok(r.text.includes('2 recalls'), r.text);
  assert.ok(r.text.includes('confirm with your Mazda dealer'), r.text);
  assert.ok(r.text.includes('US'), r.text);
  assert.strictEqual(r.img, null);
});
test('recall banner: none when there are no approved recalls', async () => {
  assert.ok(!(await banner([])).b);
});
test('recall banner: looks up the catalogue id (model + engine), not the bare model id', async () => {
  const seen = [];
  await banner([], seen);
  assert.ok(seen.length && seen[0].includes(':'), `queried ${seen[0]}`);
});
test('recall banner: rows for other model years are not shown', async () => {
  assert.ok(!(await banner([{ campaign: 'A', component: 'x', summary: 's', years: [2021] }])).b);
});

test('guidance line: community rows for a longer item key still match the service name', async () => {
  const txt = await line('Engine Oil', 'ok', { repair: stat(0, 0, { n_inspected: 6, attention_share: 0.4 }, 'engine oil 0w-20') });
  assert.ok(txt.startsWith('Inspect'), txt);
});
test('guidance line: rows for a different item are ignored', async () => {
  const txt = await line('Engine Oil', 'ok', { repair: stat(0, 0, { n_inspected: 6, attention_share: 0.4 }, 'oil filter') });
  assert.ok(txt.startsWith('OK'), txt);
});
