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
    assert.strictEqual(JSON.stringify(calls[0]), JSON.stringify(['s1', false, ['honest'], null]));
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

/* ---- Task 4: Read bill in the "Log a past service" form ---- */
const evilPart = '<img src=x onerror=alert(1)>';
const BILL = { store: { name: 'Al Salam Auto', city: 'Jeddah', area: null }, date: '2026-10-10', odometer: 52300, total: 250,
  items: [{ name: evilPart, brand: 'Bosch', part_no: 'B1', price: 100 }, { name: 'Oil filter', brand: 'Mann', part_no: '', price: 150 }] };

async function billForm(fn, { ack = true, result } = {}) {
  const app = await bootApp();
  try {
    const { api } = app, d = app.window.document, calls = [];
    api.account.user = () => ({ id: 'u1' });
    api.bills.available = () => true;
    api.bills.readBill = img => { calls.push(img); return Promise.resolve(result || { ok: true, bill: BILL, billReadId: 'r1' }); };
    const meta = { billNoticeAck: ack }, sets = [];
    api.metaGet = () => Promise.resolve(meta);
    api.metaSet = p => { sets.push(p); Object.assign(meta, p); return Promise.resolve(true); };
    api.openAddHistory(null);
    await fn({ app, api, d, calls, sets, meta });
  } finally { app.cleanup(); }
}
const q = (d, s) => d.querySelector(s);
const readBtn = d => [...d.querySelectorAll('#modalCard button')].find(b => b.textContent === 'Read bill');
const toastTexts = d => [...d.querySelectorAll('#toastHost .toast')].map(n => n.textContent);
const rows = d => [...d.querySelectorAll('#modalCard .field-row')].filter(r => r.querySelector('button'));
async function attachPhoto(app, d, url) {
  const cb = [];
  app.api.readImageResized = (f, fn, max) => { cb.push(max); fn(max === 1600 ? url + 'BIG' : url); };
  const file = q(d, '#modalCard [data-file]');
  file.onchange({ target: { files: [{}] } });
  return cb;
}
const click = async b => { b.onclick(); await tick(); await tick(); };

test('Read bill: hidden for edits and signed-out, disabled until a photo exists', async () => {
  const app = await bootApp();
  try {
    const { api } = app, d = app.window.document;
    api.bills.available = () => true;
    api.openAddHistory(null); assert.strictEqual(readBtn(d), undefined, 'signed out');
    api.account.user = () => ({ id: 'u' });
    api.openAddHistory({ id: 'e1', name: 'x', date: '2026-01-01' }); assert.strictEqual(readBtn(d), undefined, 'editing');
    api.openAddHistory(null);
    assert.strictEqual(readBtn(d).disabled, true);
    const sizes = await attachPhoto(app, d, 'data:image/jpeg;base64,AA');
    assert.strictEqual(readBtn(d).disabled, false);
    assert.deepStrictEqual([...sizes], [undefined, 1600].map(x => x), 'hi-res copy requested after the normal one');
  } finally { app.cleanup(); }
});

test('disclosure: first use asks, Cancel sends nothing, Continue reads and remembers', async () => {
  await billForm(async ({ app, d, calls, sets }) => {
    await attachPhoto(app, d, 'data:image/jpeg;base64,AA');
    await click(readBtn(d));
    assert.strictEqual(calls.length, 0);
    const btn = name => [...d.querySelectorAll('#modalCard button')].find(b => b.textContent === name);
    await click(btn('Cancel'));
    assert.strictEqual(calls.length, 0); assert.strictEqual(sets.length, 0);
    await click(readBtn(d)); await click(btn('Continue')); await tick();
    assert.strictEqual(calls.length, 1); assert.strictEqual(calls[0], 'data:image/jpeg;base64,AABIG', 'hi-res copy is what is sent');
    assert.strictEqual(sets[0].billNoticeAck, true);
    await click(readBtn(d));
    assert.strictEqual(calls.length, 2, 'second use skips the notice');
  }, { ack: false });
});

test('success fills fields, keeps untouched ones, renders parts as text, edits and removal change the rows', async () => {
  await billForm(async ({ app, d, calls }) => {
    await attachPhoto(app, d, 'data:image/jpeg;base64,AA');
    q(d, '#h_name').value = 'My service';
    await click(readBtn(d)); await tick();
    assert.strictEqual(q(d, '#h_name').value, 'My service', 'non-empty name kept');
    assert.strictEqual(q(d, '#h_date').value, '2026-10-10'); assert.strictEqual(+q(d, '#h_odo').value, 52300); assert.strictEqual(+q(d, '#h_cost').value, 250);
    const [shop, city] = [...d.querySelectorAll('#modalCard input')].filter(i => i.value === 'Al Salam Auto' || i.value === 'Jeddah');
    assert.ok(shop && city);
    assert.strictEqual(d.querySelector('#modalCard img[src="x"]'), null);
    let rs = rows(d); assert.strictEqual(rs.length, 2);
    assert.strictEqual(rs[0].querySelector('input').value, evilPart);
    assert.strictEqual(rs[0].querySelector('img'), null);
    const price = rs[1].querySelectorAll('input')[2]; price.value = '175'; price.oninput();
    rs[0].querySelector('button').onclick();
    rs = rows(d); assert.strictEqual(rs.length, 1);
    assert.strictEqual(rs[0].querySelectorAll('input')[0].value, 'Oil filter'); assert.strictEqual(rs[0].querySelectorAll('input')[2].value, '175');
    assert.ok(toastTexts(d).some(x => x.includes('Bill read')));
  });
});

for (const [error, msg] of [['limit', 'Daily bill limit reached. Enter it by hand.'], ['unreadable', 'Could not read that bill. Enter it by hand.'], ['offline', 'You are offline.'], ['failed', 'Could not read the bill.']]) {
  test(`error ${error} shows its toast and leaves the form unchanged`, () => billForm(async ({ app, d }) => {
    await attachPhoto(app, d, 'data:image/jpeg;base64,AA');
    await click(readBtn(d)); await tick();
    assert.ok(toastTexts(d).includes(msg), toastTexts(d).join('|'));
    assert.strictEqual(+q(d, '#h_cost').value, 0); assert.strictEqual(rows(d).length, 0);
    assert.strictEqual(readBtn(d).textContent, 'Read bill'); assert.strictEqual(readBtn(d).disabled, false);
  }, { result: { ok: false, error } }));
}

/* ---- Task 4 fix round 1 ---- */
const deferredResize = app => {
  const q2 = [];
  app.api.readImageResized = (f, fn, max) => q2.push({ max: max || 900, fn });
  return q2;
};
const pickFile = d => q(d, '#modalCard [data-file]').onchange({ target: { files: [{}] } });
const finish = (q2, i, url) => q2[i].fn(url);
const deferRead = api => { let res; const p = new Promise(r => res = r); api.bills.readBill = () => p; return res; };

test('stale read: closing the form and opening a new one leaves the new form untouched', () => billForm(async ({ app, api, d }) => {
  await attachPhoto(app, d, 'data:image/jpeg;base64,AA');
  const resolve = deferRead(api);
  readBtn(d).onclick(); await tick();
  api.closeModal(); api.openAddHistory(null);
  q(d, '#h_cost').value = '77';
  resolve({ ok: true, bill: BILL, billReadId: 'r1' }); await tick(); await tick();
  assert.strictEqual(+q(d, '#h_cost').value, 77); assert.strictEqual(q(d, '#h_date').value !== '2026-10-10', true);
  assert.strictEqual(q(d, '#h_name').value, ''); assert.strictEqual(rows(d).length, 0);
  assert.strictEqual(toastTexts(d).length, 0);
}));

test('photo swap: the old hi-res copy is never sent, late decodes are ignored', () => billForm(async ({ app, api, d, calls }) => {
  const q2 = deferredResize(app);
  pickFile(d); finish(q2, 0, 'A'); finish(q2, 1, 'ABIG');
  pickFile(d); finish(q2, 2, 'B');                      // B's 900px arrived, B's 1600px not yet
  await click(readBtn(d)); await tick();
  assert.strictEqual(calls[0], 'B', 'falls back to the current 900px photo');
  finish(q2, 3, 'BBIG');                                  // late hi-res of B is current, accepted
  await click(readBtn(d)); await tick();
  assert.strictEqual(calls[1], 'BBIG');
  pickFile(d); finish(q2, 5, 'CBIG'); finish(q2, 4, 'C'); // C's 1600 finished first; then a newer pick supersedes late A-style results
  pickFile(d); finish(q2, 6, 'D');
  q2[5].fn('STALE'); await click(readBtn(d)); await tick();
  assert.strictEqual(calls[2], 'D');
}));

test('photo replace and remove clear billParts and the in-flight read is ignored', () => billForm(async ({ app, api, d }) => {
  const q2 = deferredResize(app);
  pickFile(d); finish(q2, 0, 'A'); finish(q2, 1, 'ABIG');
  await click(readBtn(d)); await tick();
  assert.strictEqual(rows(d).length, 2);
  pickFile(d); finish(q2, 2, 'B');
  assert.strictEqual(rows(d).length, 0, 'replace clears parts');
  await click(readBtn(d)); await tick();
  assert.strictEqual(rows(d).length, 2);
  q(d, '#modalCard [data-rm]').onclick();
  assert.strictEqual(rows(d).length, 0, 'remove clears parts'); assert.strictEqual(readBtn(d).disabled, true);
  // in flight while the photo changes
  pickFile(d); finish(q2, 4, 'C'); finish(q2, 5, 'CBIG');
  q(d, '#h_cost').value = '5';
  const resolve = deferRead(api);
  readBtn(d).onclick(); await tick();
  pickFile(d); finish(q2, 6, 'D');
  resolve({ ok: true, bill: BILL, billReadId: 'r9' }); await tick(); await tick();
  assert.strictEqual(+q(d, '#h_cost').value, 5); assert.strictEqual(rows(d).length, 0);
}));

test('a bill with no total and no items leaves the entered cost alone', () => billForm(async ({ app, d }) => {
  await attachPhoto(app, d, 'data:image/jpeg;base64,AA');
  q(d, '#h_cost').value = '77';
  await click(readBtn(d)); await tick();
  assert.strictEqual(+q(d, '#h_cost').value, 77);
}, { result: { ok: true, bill: { store: null, date: '2026-10-10', odometer: null, total: null, items: [] }, billReadId: 'r2' } }));

test('part rows: price is clamped at 0 with min, text inputs capped at 80', () => billForm(async ({ app, d }) => {
  await attachPhoto(app, d, 'data:image/jpeg;base64,AA');
  await click(readBtn(d)); await tick();
  const ins = rows(d)[0].querySelectorAll('input');
  assert.strictEqual(+ins[0].maxLength, 80); assert.strictEqual(+ins[1].maxLength, 80); assert.strictEqual(String(ins[2].min), '0');
}));

test('shopField.set clears suggestions and re-arms the did-you-mean check', () => withField(null, async (app, f) => {
  app.api.shops.search = () => Promise.resolve([{ name: 'X', city: 'Jeddah' }]);
  const [name] = inputs(f);
  typeName(app, name, 'x'); await settle();
  assert.strictEqual(sugg(f).length, 1);
  f.set({ name: 'Bill Shop', city: 'Taif', area: '' });
  assert.strictEqual(sugg(f).length, 0); assert.strictEqual(f.nodes[1].hidden, true);
  assert.strictEqual(name.value, 'Bill Shop');
}));

/* ---- Task 5: save path stores bill parts, contributes them, votes through the RPC ---- */
const saveBtn = d => [...d.querySelectorAll('#modalCard button')].find(b => b.textContent === 'Add to history');
async function saveWith(api, d, { share = true } = {}) {
  const contributed = [], votes = [], rpcs = [];
  api.insights.shareEnabled = () => Promise.resolve(share);
  api.shops.findOrCreate = () => Promise.resolve({ id: 's1', name: 'Al Salam Auto', city: 'Jeddah' });
  api.contribute = rows => { contributed.push(...rows); };
  api.shops.vote = (...a) => { votes.push(a); return Promise.resolve(true); };
  api.openShopFeedback = (shop, id) => { api.shops.vote(shop.id, true, [], id); };
  api.shops.configure({ client: { rpc: (...a) => { rpcs.push(a); return Promise.resolve({ error: null }); }, from: () => { rpcs.push('from'); throw new Error('no table write'); } } });
  await saveBtn(d).onclick(); await tick(); await tick(); await tick();
  return { contributed, votes, rpcs };
}
const lastHist = api => api.session.current().history.slice(-1)[0];

test('save: edited and removed bill parts are what is stored; entry photo is the 900px copy; contribution and vote carry them', () => billForm(async ({ app, api, d }) => {
  await attachPhoto(app, d, 'data:image/jpeg;base64,AA');
  await click(readBtn(d)); await tick();
  const [r0, r1] = rows(d);
  const price = r1.querySelectorAll('input')[2]; price.value = '175'; price.oninput();
  r0.querySelector('button').onclick();
  const hist = api.session.current().history, push = hist.push.bind(hist); let pushed;
  hist.push = o => { pushed = JSON.parse(JSON.stringify(o)); return push(o); };   // the entry as built, before persistence rewrites photos
  const out = await saveWith(api, d);
  const h = lastHist(api);
  assert.strictEqual(pushed.photo, 'data:image/jpeg;base64,AA', 'never the 1600px copy');
  assert.strictEqual(JSON.stringify(h.parts), JSON.stringify([{ part: 'Oil filter', brand: 'Mann', partNo: '', price: 175 }]));
  assert.ok(h.shop && h.shop.name === 'Al Salam Auto');
  assert.strictEqual(out.contributed.length, 1);
  assert.strictEqual(out.contributed[0].shop_id, 's1'); assert.strictEqual(out.contributed[0].brand, 'Mann'); assert.strictEqual(out.contributed[0].price, 175);
  assert.deepStrictEqual(out.votes, [['s1', true, [], 'r1']]);
}));

test('save: empty-name and zero-price rows skipped, NaN coerced, capped at 15', () => billForm(async ({ app, api, d }) => {
  const items = [{ name: '', brand: 'x', part_no: '', price: 10 }, { name: 'Zero', brand: '', part_no: '', price: 5 }];
  for (let i = 0; i < 20; i++) items.push({ name: 'P' + i, brand: '', part_no: '', price: 1 + i });
  api.bills.readBill = () => Promise.resolve({ ok: true, bill: { ...BILL, items }, billReadId: 'r3' });
  await attachPhoto(app, d, 'data:image/jpeg;base64,AA');
  await click(readBtn(d)); await tick();
  q(d, '#h_name').value = 'Svc';
  const rs = rows(d);
  const zero = rs.find(r => r.querySelector('input').value === 'Zero').querySelectorAll('input')[2]; zero.value = '0'; zero.oninput();
  await saveWith(api, d);
  const parts = lastHist(api).parts;
  assert.ok(parts.length <= 15 && parts.every(p => p.part && Number.isFinite(p.price) && p.price > 0));
  assert.ok(!parts.some(p => p.part === 'Zero'));
}));

test('save: replacing or clearing the photo saves no stale bill parts and passes a null bill id', () => billForm(async ({ app, api, d }) => {
  await attachPhoto(app, d, 'data:image/jpeg;base64,AA');
  await click(readBtn(d)); await tick();
  await attachPhoto(app, d, 'data:image/jpeg;base64,BB');   // replace
  q(d, '#h_name').value = 'Manual';
  const out = await saveWith(api, d);
  assert.strictEqual(lastHist(api).parts, undefined);
  assert.strictEqual(out.contributed.length, 0);
  assert.ok(out.votes.length === 0 || out.votes[0][3] === null);
}));

test('save: sharing off sends nothing (no contribution, no rpc, no vote)', () => billForm(async ({ app, api, d }) => {
  await attachPhoto(app, d, 'data:image/jpeg;base64,AA');
  await click(readBtn(d)); await tick();
  const out = await saveWith(api, d, { share: false });
  assert.strictEqual(lastHist(api).parts.length, 2, 'still saved locally');
  assert.deepStrictEqual([out.contributed.length, out.votes.length, out.rpcs.filter(Array.isArray).length], [0, 0, 0]);
}));

test('save: a new shop with no bill and no parts votes with a null bill id exactly as before', async () => {
  const app = await bootApp();
  try {
    const { api } = app, d = app.window.document;
    api.openAddHistory(null);
    q(d, '#h_name').value = 'Plain';
    const out = await saveWith(api, d);
    assert.strictEqual(lastHist(api).parts, undefined);
    assert.strictEqual(out.contributed.length, 0);
  } finally { app.cleanup(); }
});

/* ---- Task 4 (repair-vs-replace): parts on the entry, action per row ---- */
const addBtn = d => [...d.querySelectorAll('#modalCard button')].find(b => b.textContent === '+ Add part');
const selOf = (r, i) => r.querySelectorAll('select')[i];
const setSel = (s, v) => { s.value = v; s.onchange(); };
const typeRow = (r, v) => { const i = r.querySelector('input'); i.value = v; i.oninput(); };

test('parts box is always there for new entries (no bill), capped at 15; absent when editing', async () => {
  const app = await bootApp();
  try {
    const { api } = app, d = app.window.document;
    api.openAddHistory(null);
    assert.ok(addBtn(d), 'add button without a bill');
    for (let i = 0; i < 16; i++) addBtn(d).onclick();
    assert.strictEqual(rows(d).length, 15);
    api.openAddHistory({ id: 'e1', name: 'x', date: '2026-01-01' });
    assert.strictEqual(addBtn(d), undefined);
  } finally { app.cleanup(); }
});

test('action select: three options, default replaced; finding only while inspected', async () => {
  const app = await bootApp();
  try {
    const { api } = app, d = app.window.document;
    api.openAddHistory(null); addBtn(d).onclick();
    let r = rows(d)[0];
    assert.deepStrictEqual([...selOf(r, 0).options].map(o => o.value), ['replaced', 'repaired', 'inspected']);
    assert.strictEqual(selOf(r, 0).value, 'replaced'); assert.strictEqual(r.querySelectorAll('select').length, 1);
    setSel(selOf(r, 0), 'inspected'); r = rows(d)[0];
    assert.strictEqual(r.querySelectorAll('select').length, 2);
    assert.deepStrictEqual([...selOf(r, 1).options].map(o => o.value), ['', 'ok', 'attention']);
    setSel(selOf(r, 1), 'attention');
    setSel(selOf(r, 0), 'repaired'); r = rows(d)[0];
    assert.strictEqual(r.querySelectorAll('select').length, 1);
    setSel(selOf(r, 0), 'inspected'); assert.strictEqual(selOf(rows(d)[0], 1).value, '', 'finding cleared');
  } finally { app.cleanup(); }
});

test('guidance line follows the typed name as text without redrawing', async () => {
  const app = await bootApp();
  try {
    const { api } = app, d = app.window.document;
    api.openAddHistory(null); addBtn(d).onclick();
    const r = rows(d)[0], tip = () => r.nextElementSibling;
    assert.strictEqual(tip().textContent, '');
    typeRow(r, 'Headlight');
    assert.ok(tip().textContent.includes('General guidance'));
    assert.strictEqual(rows(d)[0], r, 'row not redrawn');
    typeRow(r, 'Oil'); assert.strictEqual(tip().textContent, '');
    typeRow(r, evilPart); assert.strictEqual(tip().textContent, ''); assert.strictEqual(q(d, '#modalCard img'), null);
  } finally { app.cleanup(); }
});

async function manualSave(rowsSpec, { share = true } = {}) {
  let out, h;
  await billForm(async ({ api, d }) => {
    q(d, '#h_name').value = 'Svc';
    rowsSpec.forEach(s => {
      addBtn(d).click ? addBtn(d).click() : addBtn(d).onclick();
      const r = rows(d).slice(-1)[0], ins = r.querySelectorAll('input');
      typeRow(r, s.name); if (s.price != null) { ins[2].value = String(s.price); ins[2].oninput(); }
      if (s.action) setSel(selOf(rows(d).slice(-1)[0], 0), s.action);
      if (s.finding) setSel(selOf(rows(d).slice(-1)[0], 1), s.finding);
    });
    out = await saveWith(api, d, { share }); h = lastHist(api);
  });
  return { out, h };
}

test('save: repaired keeps action, inspected without price keeps finding, replaced stores no action, unpriced replaced dropped', async () => {
  const { h, out } = await manualSave([
    { name: 'Mirror', price: 80, action: 'repaired' }, { name: 'Pads', action: 'inspected', finding: 'attention' },
    { name: 'Bulb', price: 9 }, { name: 'Wiper' }]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(h.parts)), [
    { part: 'Mirror', brand: '', partNo: '', price: 80, action: 'repaired' },
    { part: 'Pads', brand: '', partNo: '', action: 'inspected', finding: 'attention' },
    { part: 'Bulb', brand: '', partNo: '', price: 9 }]);
  assert.deepStrictEqual(out.contributed.map(r => [r.item_key, r.action, r.finding]).sort(),
    [['bulb', 'replaced', undefined], ['mirror', 'repaired', undefined], ['pads', 'inspected', 'attention']]);
});

test('save: sharing off still stores the parts, contributes nothing', async () => {
  const { h, out } = await manualSave([{ name: 'Mirror', price: 80, action: 'repaired' }], { share: false });
  assert.strictEqual(h.parts.length, 1); assert.strictEqual(out.contributed.length, 0);
});

test('photo change drops only bill-read rows; manual rows survive', () => billForm(async ({ app, d }) => {
  addBtn(d).onclick(); typeRow(rows(d)[0], 'Manual');
  await attachPhoto(app, d, 'data:image/jpeg;base64,AA');
  await click(readBtn(d)); await tick();
  assert.strictEqual(rows(d).length, 3);
  await attachPhoto(app, d, 'data:image/jpeg;base64,BB');
  assert.strictEqual(rows(d).length, 1); assert.strictEqual(rows(d)[0].querySelector('input').value, 'Manual');
}));

test('bill reader: a repaired item prefills the row select and saves action repaired', () => billForm(async ({ app, api, d }) => {
  api.bills.readBill = () => Promise.resolve({ ok: true, bill: { ...BILL, items: [{ name: 'Headlight', brand: '', part_no: '', price: 120, action: 'repaired' }, { name: 'Filter', brand: '', part_no: '', price: 30, action: null }] }, billReadId: 'r9' });
  await attachPhoto(app, d, 'data:image/jpeg;base64,AA');
  await click(readBtn(d)); await tick();
  const rs = rows(d);
  assert.deepStrictEqual(rs.map(r => selOf(r, 0).value), ['repaired', 'replaced']);
  q(d, '#h_name').value = 'Svc';
  await saveWith(api, d);
  const parts = JSON.parse(JSON.stringify(lastHist(api).parts));
  assert.strictEqual(parts.find(p => p.part === 'Headlight').action, 'repaired');
}));

test('bill reader: priceless inspected row has an empty price input, saves without price, contributes null', () => billForm(async ({ app, api, d }) => {
  api.bills.readBill = () => Promise.resolve({ ok: true, bill: { ...BILL, items: [{ name: 'Brake check', brand: null, part_no: null, price: null, action: 'inspected' }] }, billReadId: 'r8' });
  await attachPhoto(app, d, 'data:image/jpeg;base64,AA');
  await click(readBtn(d)); await tick();
  const r = rows(d)[0], price = r.querySelectorAll('input')[2];
  assert.strictEqual(price.value, ''); assert.strictEqual(selOf(r, 0).value, 'inspected');
  q(d, '#h_name').value = 'Svc';
  const out = await saveWith(api, d);
  const part = JSON.parse(JSON.stringify(lastHist(api).parts))[0];
  assert.strictEqual(part.action, 'inspected'); assert.ok(!('price' in part));
  assert.strictEqual(out.contributed.length, 1); assert.strictEqual(out.contributed[0].price, null);
}));

/* ---- Task 6 (repair-vs-replace): repair hint, community numbers, timeline labels ---- */
const stat = (rep, repl, extra) => [Object.assign({ n_repaired: rep, n_replaced: repl, n_inspected: 0, median_price_repaired: 120, median_price_replaced: 540, median_km_after_repair: null, attention_share: null }, extra)];
async function partsPage(partName, rowsFor, fn) {
  const app = await bootApp();
  try {
    const { api } = app;
    api.insights.available = () => true;
    api.insights.getBrandLife = () => Promise.resolve([]);
    api.insights.getRepairStats = () => Promise.resolve(rowsFor);
    api.shops.getStorePrices = () => Promise.resolve([]);
    api.session.current().parts.push({ id: 'zz', name: partName, icon: '🔩', cat: 'General', options: [{ tag: 'OEM', brand: 'X', price: 1, store: 's', note: '' }], fitment: { shareable: true, modelIds: [] } });
    api.go('parts');
    await tick(); await tick(); await tick();
    await fn(app, app.window.document.getElementById('repair_zz'));
  } finally { app.cleanup(); }
}

test('Parts page: community repair numbers once enough samples', () => partsPage('Headlight', stat(4, 6), (app, slot) => {
  assert.ok(slot.textContent.includes('40%') && slot.textContent.includes('120') && slot.textContent.includes('540'), slot.textContent);
  assert.ok(!slot.textContent.includes('General guidance'));
}));
test('Parts page: too few samples falls back to the curated tip', () => partsPage('Headlight', stat(1, 2), (app, slot) => {
  assert.ok(slot.textContent.startsWith('General guidance'), slot.textContent);
  assert.ok(!slot.textContent.includes('%'));
}));
test('Parts page: no stats and unrelated part shows nothing', () => partsPage('Oil Filter', [], (app, slot) => assert.strictEqual(slot.textContent, '')));
test('Parts page: markup in a part name stays text', () => partsPage('<b>Headlight</b>', stat(4, 6), (app, slot) => {
  assert.strictEqual(slot.children.length, 0);
}));
test('Parts page: inspections alone never print a share', () => partsPage('Oil Filter', stat(0, 0, { n_inspected: 5, attention_share: 0.4 }), (app, slot) => {
  assert.ok(slot.textContent.includes('40%') && slot.textContent.includes('problem'));
  assert.ok(!slot.textContent.includes('repaired this'));
}));

test('form hint: community line beats the tip; a stale response is ignored', async () => {
  const app = await bootApp();
  try {
    const { api } = app, d = app.window.document, pending = [];
    api.insights.available = () => true;
    api.insights.getRepairStats = (m, k) => new Promise(res => pending.push({ k, res }));
    api.openAddHistory(null); addBtn(d).onclick();
    const r = rows(d)[0], tip = () => r.nextElementSibling, nm = r.querySelector('input');
    const change = v => { nm.value = v; nm.oninput(); nm.dispatchEvent(new app.window.Event('change')); };
    change('Headlight'); change('Headlight lamp');
    assert.strictEqual(pending.length, 2, 'one call per change, none per keystroke');
    pending[1].res(stat(4, 6)); await tick();
    assert.ok(tip().textContent.includes('40%'));
    pending[0].res(stat(0, 10)); await tick();
    assert.ok(tip().textContent.includes('40%'), 'stale response ignored');
    nm.value = 'Headlight'; nm.oninput();
    assert.ok(tip().textContent.startsWith('General guidance'), 'stats do not follow a different name');
  } finally { app.cleanup(); }
});

test('timeline: repaired/inspected parts get labels as text; replaced and legacy show none', async () => {
  const app = await bootApp();
  try {
    const { api } = app, d = app.window.document, evil = '<i>x</i>';
    api.session.current().history.push(
      { id: 'a', name: 'Fix', date: '2026-01-01', odometer: 1, parts: [{ part: evil, price: 5, action: 'repaired' }, { part: 'Brakes', action: 'inspected', finding: 'attention' }, { part: 'Pad', price: 3 }, { part: 'Oil', price: 3, action: 'replaced' }] },
      { id: 'b', name: 'Old', date: '2026-02-01', odometer: 2, parts: [{ part: 'Pad', price: 3 }] });
    api.go('maintenance'); api.evalInApp ? 0 : 0;
    const btns = [...d.querySelectorAll('.seg button')].find(b => /History/.test(b.textContent));
    if (btns) btns.onclick();
    const cards = [...d.querySelectorAll('.tl-card')];
    const a = cards.find(c => c.textContent.includes('Fix')), b = cards.find(c => c.textContent.includes('Old'));
    assert.ok(a.textContent.includes('Repaired') && a.textContent.includes('Inspected · Needs attention'), a.textContent);
    assert.ok(a.textContent.includes(evil) && !a.querySelector('i'));
    assert.ok(!a.textContent.includes('Pad') && !a.textContent.includes('Oil'));
    assert.ok(!b.textContent.includes('Pad') && !b.querySelector('.tl-note'));
  } finally { app.cleanup(); }
});
