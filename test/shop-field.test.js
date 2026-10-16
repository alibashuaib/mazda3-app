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

test('a stale search response never overwrites newer suggestions', () => withField(null, async (app, f) => {
  const pending = [];
  app.api.shops.search = () => new Promise(res => pending.push(res));
  const [name] = inputs(f);
  typeName(app, name, 'al');
  typeName(app, name, 'ala');
  pending[1]([{ name: 'New', city: 'Jeddah' }]);
  await tick();
  pending[0]([{ name: 'Old', city: 'Jeddah' }]);
  await tick();
  const dl = f.nodes.find(n => n.tagName === 'DATALIST');
  assert.strictEqual([...dl.children].map(o => o.value).join('|'), 'New');
}));

test('suggestions are real option elements carrying the exact name', () => withField(null, async (app, f) => {
  const evil = '<b>"&Shop';
  app.api.shops.search = () => Promise.resolve([{ name: evil, city: 'Jeddah', area: 'Balad' }]);
  typeName(app, inputs(f)[0], 'sh');
  await tick();
  const opts = [...f.nodes.find(n => n.tagName === 'DATALIST').children];
  assert.strictEqual(opts.length, 1);
  assert.strictEqual(opts[0].tagName, 'OPTION');
  assert.strictEqual(opts[0].value, evil);
  assert.strictEqual(opts[0].children.length, 0, 'no markup was parsed out of the name');
}));
