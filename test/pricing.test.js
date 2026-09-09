'use strict';
const test = require('node:test');
const assert = require('node:assert');
const pricing = require('../src/data/pricing.js');

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
