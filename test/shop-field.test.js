'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { bootApp } = require('./helpers/boot.js');

/* shopField is a plain script global, so it is driven through the boot harness. */
async function withField(initial, fn) {
  const app = await bootApp();
  try { await fn(app, app.api.shopField(initial)); } finally { app.cleanup(); }
}
const inputs = f => f.nodes.flatMap(n => [...n.querySelectorAll('input')]);
const typeName = (app, input, v) => { input.value = v; input.dispatchEvent(new app.window.Event('input')); };
const tick = () => new Promise(r => setImmediate(r));
const settle = () => new Promise(r => setTimeout(r, 320));   // past the 250ms search debounce

test('value() is null for a blank name, a trimmed triple otherwise', () => withField(null, (app, f) => {
  const [name, city, area] = inputs(f);
  assert.strictEqual(f.value(), null);
  name.value = '  Al Amal  '; city.value = ' Jeddah '; area.value = ' Balad ';
  assert.strictEqual(JSON.stringify(f.value()), JSON.stringify({ name: 'Al Amal', city: 'Jeddah', area: 'Balad' })); // vm realm: no deepStrictEqual
  name.value = '   ';
  assert.strictEqual(f.value(), null);
}));

test('City defaults to the latest history entry shop city', async () => {
  const app = await bootApp();
  try {
    app.api.session.current().history.push({ id: 'x', date: '2030-01-01', shop: { name: 'A', city: 'Dammam' } });
    assert.strictEqual(inputs(app.api.shopField())[1].value, 'Dammam');
    assert.strictEqual(inputs(app.api.shopField({ city: 'Makkah' }))[1].value, 'Makkah');
  } finally { app.cleanup(); }
});

const sugg = f => [...f.nodes[1].querySelectorAll('button')];

test('a stale search response never overwrites newer suggestions', () => withField(null, async (app, f) => {
  const pending = [];
  app.api.shops.search = () => new Promise(res => pending.push(res));
  const [name] = inputs(f);
  typeName(app, name, 'al');
  await settle();
  typeName(app, name, 'ala');
  await settle();
  assert.strictEqual(pending.length, 2);
  pending[1]([{ name: 'New', city: 'Jeddah' }]);
  await tick();
  pending[0]([{ name: 'Old', city: 'Jeddah' }]);
  await tick();
  assert.deepStrictEqual(sugg(f).map(b => b.firstChild.textContent), ['New']);
}));

test('search is debounced: a burst of keystrokes sends one request for the last value', () => withField(null, async (app, f) => {
  const calls = [];
  app.api.shops.search = q => { calls.push(q); return Promise.resolve([]); };
  const [name] = inputs(f);
  ['s', 'sa', 'sal'].forEach(v => typeName(app, name, v));
  await tick();
  assert.strictEqual(calls.length, 0, 'nothing sent before the debounce window ends');
  await settle();
  assert.deepStrictEqual([...calls], ['sal']);
}));

test('suggestions render names as text, tapping one fills shop, city and area', () => withField(null, async (app, f) => {
  const evil = '<img src=x onerror=alert(1)>';
  app.api.shops.search = () => Promise.resolve([{ name: evil, city: 'Taif', area: 'Shubra' }]);
  const [name, city, area] = inputs(f);
  city.value = 'Jeddah'; area.value = 'Old';
  typeName(app, name, 'im');
  await settle();
  const bs = sugg(f);
  assert.strictEqual(bs.length, 1);
  assert.strictEqual(bs[0].querySelector('img'), null, 'no markup parsed out of the name');
  assert.ok(bs[0].textContent.includes(evil) && bs[0].textContent.includes('Shubra, Taif'));
  assert.strictEqual(f.nodes[1].hidden, false);
  bs[0].onclick();
  assert.strictEqual(name.value, evil); assert.strictEqual(city.value, 'Taif'); assert.strictEqual(area.value, 'Shubra');
  assert.strictEqual(f.nodes[1].hidden, true);
  assert.strictEqual(sugg(f).length, 0);
}));

test('empty search result hides the list', () => withField(null, async (app, f) => {
  app.api.shops.search = () => Promise.resolve([]);
  typeName(app, inputs(f)[0], 'zz');
  await settle();
  assert.strictEqual(f.nodes[1].hidden, true);
}));

const prompt = f => f.nodes[3];
const hit = { id: 'h', name: 'Al Salam Auto', city: 'Jeddah', area: 'Safa' };

test('resolve(): blank -> null; no hits -> typed value without prompting', () => withField(null, async (app, f) => {
  app.api.shops.similar = () => Promise.resolve([]);
  assert.strictEqual(await f.resolve(), null);
  const [name, city] = inputs(f);
  name.value = 'Toyota Service'; city.value = 'Jeddah';
  assert.strictEqual((await f.resolve()).name, 'Toyota Service');
  assert.strictEqual(prompt(f).hidden, true);
}));

test('resolve(): prompts, picking a hit returns it; asks only once', () => withField(null, async (app, f) => {
  let calls = 0;
  app.api.shops.similar = () => { calls++; return Promise.resolve([hit]); };
  const [name, city] = inputs(f);
  name.value = 'Alsalam Auto'; city.value = 'Jeddah';
  const p = f.resolve();
  await tick();
  assert.strictEqual(prompt(f).hidden, false);
  assert.ok(prompt(f).textContent.includes('Did you mean:'));
  const bs = [...prompt(f).querySelectorAll('button')];
  assert.strictEqual(bs.length, 2);
  assert.ok(bs[0].textContent.includes('Al Salam Auto') && bs[0].textContent.includes('Safa'));
  bs[0].onclick();
  const v = await p;
  assert.strictEqual(v.name, 'Al Salam Auto'); assert.strictEqual(v.area, 'Safa');
  assert.strictEqual(prompt(f).hidden, true);
  name.value = 'Alsalam Autoo';
  await f.resolve();
  assert.strictEqual(calls, 1, 'no repeat prompt after answering');
}));

test('resolve(): "new shop" keeps what was typed; a tapped suggestion skips the prompt', () => withField(null, async (app, f) => {
  app.api.shops.similar = () => Promise.resolve([hit]);
  const [name, city] = inputs(f);
  name.value = 'Alsalam Auto'; city.value = 'Jeddah';
  const p = f.resolve();
  await tick();
  [...prompt(f).querySelectorAll('button')][1].onclick();
  assert.strictEqual((await p).name, 'Alsalam Auto');
}));

test('resolve(): a tapped suggestion is returned as is, no similar() call', () => withField(null, async (app, f) => {
  let calls = 0;
  app.api.shops.similar = () => { calls++; return Promise.resolve([hit]); };
  app.api.shops.search = () => Promise.resolve([hit]);
  typeName(app, inputs(f)[0], 'al');
  await settle();
  sugg(f)[0].onclick();
  assert.strictEqual((await f.resolve()).name, 'Al Salam Auto');
  assert.strictEqual(calls, 0);
}));

test('resolve(): offline (no client) returns the typed value without prompting', () => withField(null, async (app, f) => {
  app.api.shops.reset();
  const [name, city] = inputs(f);
  name.value = 'Alsalam Auto'; city.value = 'Jeddah';
  assert.strictEqual((await f.resolve()).name, 'Alsalam Auto');
  assert.strictEqual(prompt(f).hidden, true);
}));

test('resolve(): "new shop" returns the value at click time; list stays hidden while prompting', () => withField(null, async (app, f) => {
  app.api.shops.similar = () => Promise.resolve([hit]);
  app.api.shops.search = () => Promise.resolve([hit]);
  const [name, city] = inputs(f);
  name.value = 'Alsalam Auto'; city.value = 'Jeddah';
  const p = f.resolve();
  await tick();
  city.value = 'Taif';
  typeName(app, name, 'Alsalam Autos');
  await settle();
  assert.strictEqual(f.nodes[1].hidden, true, 'suggestions not shown over the prompt');
  [...prompt(f).querySelectorAll('button')][1].onclick();
  const v = await p;
  assert.strictEqual(v.city, 'Taif'); assert.strictEqual(v.name, 'Alsalam Autos');
}));

/* ---- feedback modal + afterPurchase ---- */
const btn = (app, label) => [...app.document.querySelectorAll('#modalCard button')].find(b => b.textContent.includes(label));

test('feedback: Send is disabled until a thumb is chosen, then sends thumb and reasons', async () => {
  const app = await bootApp();
  try {
    const calls = [];
    app.api.shops.vote = (...a) => { calls.push(a); return Promise.resolve(true); };
    app.api.openShopFeedback({ id: 's1', name: 'Al Amal', city: 'Jeddah' });
    const send = btn(app, 'Send');
    assert.strictEqual(send.disabled, true);
    btn(app, 'Fast').onclick(); btn(app, 'Honest').onclick(); btn(app, 'Fast').onclick(); // Fast toggled off again
    assert.strictEqual(send.disabled, true, 'reasons alone do not enable Send');
    btn(app, '👎').onclick();
    assert.strictEqual(btn(app, '👎').getAttribute('aria-pressed'), 'true');
    assert.strictEqual(btn(app, '👍').getAttribute('aria-pressed'), 'false');
    assert.strictEqual(send.disabled, false);
    await send.onclick();
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(JSON.stringify(calls[0]), JSON.stringify(['s1', false, ['honest']]));
    assert.strictEqual(app.document.querySelector('#modalHost').hidden, true);
  } finally { app.cleanup(); }
});

test('feedback: Not now sends nothing and closes', async () => {
  const app = await bootApp();
  try {
    let n = 0;
    app.api.shops.vote = () => { n++; return Promise.resolve(true); };
    app.api.openShopFeedback({ id: 's1', name: 'A', city: 'B' });
    btn(app, 'Not now').onclick();
    assert.strictEqual(n, 0);
    assert.strictEqual(app.document.querySelector('#modalHost').hidden, true);
  } finally { app.cleanup(); }
});

async function purchase(share, shopIn) {
  const app = await bootApp();
  const seen = { create: 0, prompt: 0 };
  app.api.insights.shareEnabled = () => Promise.resolve(share);
  app.api.shops.findOrCreate = () => { seen.create++; return Promise.resolve({ id: 's1', name: 'A', city: 'B' }); };
  app.api.openShopFeedback = () => { seen.prompt++; };
  const cur = app.api.session.current();
  await app.api.afterPurchase([], shopIn, cur, 'v1');
  app.cleanup();
  return seen;
}

test('afterPurchase: sharing off creates no shop and shows no prompt', async () => {
  const s = await purchase(false, { name: 'A', city: 'B', area: '' });
  assert.strictEqual(s.create + s.prompt, 0);
});

test('afterPurchase: sharing on creates the shop and prompts; no shop means no prompt', async () => {
  let s = await purchase(true, { name: 'A', city: 'B', area: '' });
  assert.strictEqual(s.create + '/' + s.prompt, '1/1');
  s = await purchase(true, null);
  assert.strictEqual(s.create + s.prompt, 0);
});

test('afterPurchase: no feedback prompt over an already-open modal', async () => {
  const app = await bootApp();
  try {
    let prompts = 0;
    app.api.insights.shareEnabled = () => Promise.resolve(true);
    app.api.shops.findOrCreate = () => Promise.resolve({ id: 's1', name: 'A', city: 'B' });
    app.api.openShopFeedback = () => { prompts++; };
    app.document.querySelector('#modalHost').hidden = false;
    await app.api.afterPurchase([], { name: 'A', city: 'B', area: '' }, app.api.session.current(), 'v1');
    assert.strictEqual(prompts, 0);
    app.document.querySelector('#modalHost').hidden = true;
    await app.api.afterPurchase([], { name: 'A', city: 'B', area: '' }, app.api.session.current(), 'v1');
    assert.strictEqual(prompts, 1);
  } finally { app.cleanup(); }
});

test('Parts page shows the cheapest shop as text, never markup', async () => {
  const app = await bootApp();
  try {
    const { api } = app, evil = '<img src=x onerror=alert(1)>';
    api.insights.available = () => true;
    api.insights.getBrandLife = () => Promise.resolve([]);
    api.shops.getStorePrices = () => Promise.resolve([{ shop_id: 's1', shop_name: evil, city: 'Jeddah', area: '', median_price: 40, n: 3 }]);
    api.shops.getTrust = () => Promise.resolve([{ shop_id: 's1', score_share: 0.9 }]);
    api.go('parts');
    await tick(); await tick(); await tick();
    const slot = app.window.document.querySelector('[id^="shop_"]');
    assert.ok(slot.textContent.includes(evil) && slot.textContent.includes('SAR 40'));
    assert.strictEqual(slot.children.length, 0);
    assert.ok(slot.textContent.includes('90%'));
  } finally { app.cleanup(); }
});
