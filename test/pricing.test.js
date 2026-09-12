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

test('createItem() resolves the exact-match row on a unique-violation race', async () => {
  const winner = { id: 'won1', label: 'Paint — bumper only', category: 'Paint' };
  pricing.configure({
    client: {
      from: table => {
        assert.strictEqual(table, 'price_items');
        return {
          insert: () => ({
            select: () => ({
              single: () => Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key' } })
            })
          }),
          select: () => ({ ilike: () => ({ maybeSingle: () => Promise.resolve({ data: winner, error: null }) }) })
        };
      }
    }
  });
  const item = await pricing.createItem('Paint — bumper only', 'Paint', null);
  assert.deepStrictEqual(item, winner);
});

test('findExactItem() resolves the matching row', async () => {
  const row = { id: 'a1', label: 'Paint — full respray', category: 'Paint' };
  pricing.configure({
    client: {
      from: table => {
        assert.strictEqual(table, 'price_items');
        return { select: () => ({ ilike: (col, val) => {
          assert.strictEqual(col, 'label');
          assert.strictEqual(val, 'Paint — full respray');
          return { maybeSingle: () => Promise.resolve({ data: row, error: null }) };
        } }) };
      }
    }
  });
  const item = await pricing.findExactItem('Paint — full respray');
  assert.deepStrictEqual(item, row);
});

test('findExactItem() uses ilike (case-insensitive), not eq, matching the schema\'s unique index on lower(label)', async () => {
  const row = { id: 'a1', label: 'Car Paint Job', category: 'Paint' };
  pricing.configure({
    client: {
      // No eq() on this fake client at all — if findExactItem regressed
      // back to .eq(), this throws instead of silently missing a
      // case-differing row the way the real API would.
      from: () => ({ select: () => ({ ilike: (col, val) => {
        assert.strictEqual(col, 'label');
        assert.strictEqual(val, 'car paint job');
        return { maybeSingle: () => Promise.resolve({ data: row, error: null }) };
      } }) })
    }
  });
  const item = await pricing.findExactItem('car paint job');
  assert.deepStrictEqual(item, row);
});

test('findExactItem() escapes ilike wildcard characters so a typed % or _ is literal', async () => {
  pricing.configure({
    client: {
      from: () => ({ select: () => ({ ilike: (col, val) => {
        assert.strictEqual(val, 'brake pads (front\\_left)');
        return { maybeSingle: () => Promise.resolve({ data: null, error: null }) };
      } }) })
    }
  });
  await pricing.findExactItem('brake pads (front_left)');
});

test('findExactItem() resolves null when nothing matches', async () => {
  pricing.configure({
    client: { from: () => ({ select: () => ({ ilike: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }) }
  });
  const item = await pricing.findExactItem('nope');
  assert.strictEqual(item, null);
});

test('findOrCreateItem() reuses an existing item without creating one', async () => {
  const existing = { id: 'e1', label: 'Paint', category: 'Paint' };
  pricing.configure({
    client: {
      from: () => ({
        select: () => ({ ilike: () => ({ maybeSingle: () => Promise.resolve({ data: existing, error: null }) }) }),
        insert: () => { throw new Error('must not create when one already exists'); }
      })
    }
  });
  const item = await pricing.findOrCreateItem('Paint', 'Paint', null);
  assert.deepStrictEqual(item, existing);
});

test('findOrCreateItem() creates a new item when none exists', async () => {
  pricing.configure({
    client: {
      from: () => ({
        select: () => ({ ilike: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
        insert: row => ({ select: () => ({ single: () => Promise.resolve({ data: Object.assign({ id: 'new1' }, row), error: null }) }) })
      })
    }
  });
  const item = await pricing.findOrCreateItem('Paint', 'Paint', null);
  assert.strictEqual(item.id, 'new1');
  assert.strictEqual(item.label, 'Paint');
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

test('getAverages() maps rows from the view by item_id', async () => {
  pricing.configure({ client: {
    from: table => {
      assert.strictEqual(table, 'price_item_averages');
      return { select: () => ({ in: (_col, ids) => {
        assert.deepStrictEqual(ids, ['item1', 'item2']);
        return Promise.resolve({ data: [{ item_id: 'item1', avg_price: 250.5, sample_count: 3 }], error: null });
      } }) };
    }
  } });
  const averages = await pricing.getAverages(['item1', 'item2']);
  assert.deepStrictEqual(averages.get('item1'), { avgPrice: 250.5, sampleCount: 3 });
  assert.strictEqual(averages.has('item2'), false);
});

test('getAverages() resolves an empty Map for an empty list without calling the client', async () => {
  pricing.configure({ client: { from: () => { throw new Error('must not be called'); } } });
  const averages = await pricing.getAverages([]);
  assert.strictEqual(averages.size, 0);
});
