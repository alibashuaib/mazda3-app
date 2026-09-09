'use strict';
const test = require('node:test');
const assert = require('node:assert');
const pricing = require('../src/data/pricing.js');
const account = require('../src/data/account.js');

function fakeClient() {
  return { from: () => ({}) };
}

test.beforeEach(() => { pricing.reset(); });

test('available() is false with no client configured', () => {
  assert.strictEqual(pricing.available(), false);
});

test('available() is true once a client is configured', () => {
  pricing.configure({ client: fakeClient() });
  assert.strictEqual(pricing.available(), true);
});

test('searchItems() resolves rows client returns', async () => {
  const rows = [{ id: 'a1', label: 'Paint — full respray', category: 'Paint' }];
  pricing.configure({
    client: {
      from: table => {
        assert.strictEqual(table, 'price_items');
        return {
          select: () => ({
            ilike: () => ({
              limit: () => Promise.resolve({ data: rows, error: null })
            })
          })
        };
      }
    }
  });
  const result = await pricing.searchItems('paint');
  assert.deepStrictEqual(result, rows);
});

test('searchItems() resolves [] on query error rather throwing', async () => {
  pricing.configure({
    client: {
      from: () => ({
        select: () => ({
          ilike: () => ({
            limit: () => Promise.resolve({ data: null, error: new Error('offline') })
          })
        })
      })
    }
  });
  const result = await pricing.searchItems('paint');
  assert.deepStrictEqual(result, []);
});

test('createItem() inserts resolves created row', async () => {
  let inserted;
  pricing.configure({
    client: {
      from: table => {
        assert.strictEqual(table, 'price_items');
        return {
          insert: row => {
            inserted = row;
            return {
              select: () => ({
                single: () => Promise.resolve({ data: Object.assign({ id: 'new1' }, row), error: null })
              })
            };
          }
        };
      }
    }
  });
  const item = await pricing.createItem('Paint — bumper only', 'Paint', null);
  assert.strictEqual(item.id, 'new1');
  assert.strictEqual(inserted.label, 'Paint — bumper only');
  assert.strictEqual(inserted.category, 'Paint');
  assert.strictEqual(inserted.source_part_no, null);
});

test('createItem() resolves null on an insert error', async () => {
  pricing.configure({
    client: {
      from: () => ({
        insert: () => ({
          select: () => ({
            single: () => Promise.resolve({ data: null, error: new Error('offline') })
          })
        })
      })
    }
  });
  const item = await pricing.createItem('Paint — bumper only', 'Paint', null);
  assert.strictEqual(item, null);
});

test('createItem() resolves null with no client configured', async () => {
  const item = await pricing.createItem('x', 'y', null);
  assert.strictEqual(item, null);
});

test('submitPrice() inserts an observation when signed in', async () => {
  let inserted;
  account.setUserForTest({ id: 'u1' });
  pricing.configure({ client: {
    from: table => {
      assert.strictEqual(table, 'price_observations');
      return { insert: row => { inserted = row; return Promise.resolve({ error: null }); } };
    }
  } });
  const ok = await pricing.submitPrice('item1', 250);
  assert.strictEqual(ok, true);
  assert.strictEqual(inserted.item_id, 'item1');
  assert.strictEqual(inserted.price, 250);
  account.setUserForTest(null);
});

test('submitPrice() resolves false when signed out, without touching the client', async () => {
  account.setUserForTest(null);
  pricing.configure({ client: { from: () => { throw new Error('must not be called'); } } });
  const ok = await pricing.submitPrice('item1', 250);
  assert.strictEqual(ok, false);
});

test('submitPrice() resolves false on an insert error', async () => {
  account.setUserForTest({ id: 'u1' });
  pricing.configure({ client: { from: () => ({ insert: () => Promise.resolve({ error: new Error('offline') }) }) } });
  const ok = await pricing.submitPrice('item1', 250);
  assert.strictEqual(ok, false);
  account.setUserForTest(null);
});
