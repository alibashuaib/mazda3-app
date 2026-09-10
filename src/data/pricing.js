/* ============================================================
   Pricing — crowdsourced price averages.

   Dual-mode, like account.js and storage.js.
   ============================================================ */
'use strict';
(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const account = isNode ? require('./account.js') : root.account;
  const api = factory(account);

  if (isNode) module.exports = api;
  else root.pricing = api;
})(typeof self !== 'undefined' ? self : globalThis, function (account) {

  let env = { client: null };

  function configure(next) { env = Object.assign({}, env, next || {}); }
  function reset() { env = { client: null }; }
  function available() { return !!env.client; }
  function searchItems(query) {
    if (!env.client) return Promise.resolve([]);
    return Promise.resolve(
      env.client.from('price_items').select('id,label,category').ilike('label', `%${query}%`).limit(20)
    ).then(res => (res && res.error) ? [] : (res.data || [])).catch(() => []);
  }

  // Exact-label lookup, used by findOrCreateItem() below instead of
  // searchItems()'s substring/limit(20) match — that match can silently
  // miss an existing item once more than 20 rows share a substring, which
  // would create a permanent duplicate (price_items has no update/delete
  // policy). Backed by the unique index on lower(label) in schema.sql.
  function findExactItem(label) {
    if (!env.client) return Promise.resolve(null);
    return Promise.resolve(
      env.client.from('price_items').select('id,label,category').eq('label', label).maybeSingle()
    ).then(res => (res && res.error) ? null : (res.data || null)).catch(() => null);
  }

  function createItem(label, category, sourcePartNo) {
    if (!env.client) return Promise.resolve(null);
    return Promise.resolve(
      env.client.from('price_items')
        .insert({ label, category, source_part_no: sourcePartNo || null })
        .select().single()
    ).then(res => {
      if (res && res.error) {
        // Unique-violation means a concurrent submitter won the race for
        // this exact label — resolve to their row rather than failing.
        if (res.error.code === '23505') return findExactItem(label);
        return null;
      }
      return (res && res.data) || null;
    }).catch(() => null);
  }

  // Picks an existing item by exact label or creates one — the single
  // entry point both UI surfaces should use instead of duplicating the
  // find-or-create sequence themselves.
  function findOrCreateItem(label, category, sourcePartNo) {
    if (!env.client) return Promise.resolve(null);
    return findExactItem(label).then(existing => existing || createItem(label, category, sourcePartNo));
  }

  function submitPrice(itemId, price) {
    if (!env.client || !account.user()) return Promise.resolve(false);
    return Promise.resolve(
      env.client.from('price_observations').insert({ item_id: itemId, price })
    ).then(res => !(res && res.error)).catch(() => false);
  }

  function getAverages(itemIds) {
    if (!env.client || !itemIds || !itemIds.length) return Promise.resolve(new Map());
    return Promise.resolve(
      env.client.from('price_item_averages').select('item_id,avg_price,sample_count').in('item_id', itemIds)
    ).then(res => {
      const map = new Map();
      if (res && !res.error) {
        (res.data || []).forEach(row => map.set(row.item_id, { avgPrice: row.avg_price, sampleCount: row.sample_count }));
      }
      return map;
    }).catch(() => new Map());
  }

  return { configure, reset, available, searchItems, findExactItem, createItem, findOrCreateItem, submitPrice, getAverages };
});
