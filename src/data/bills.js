/* ============================================================
   Bills — read a bill photo through the read-bill Edge Function.
   Dual-mode like shops.js. Never rejects; the manual form always works.
   ============================================================ */
'use strict';

(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const api = factory();
  if (isNode) module.exports = api;
  else root.bills = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  let env = { client: null };
  const configure = next => { env = Object.assign({}, env, next || {}); };
  const reset = () => { env = { client: null }; };
  const available = () => !!env.client;

  function readBill(dataUrl) {
    if (!env.client) return Promise.resolve({ ok: false, error: 'unavailable' });
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return Promise.resolve({ ok: false, error: 'offline' });
    return Promise.resolve().then(() => env.client.functions.invoke('read-bill', { body: { image: dataUrl } })).then(res => {
      if (res && res.error) {
        const st = res.error.context && res.error.context.status;
        // 503 (service off) and 413 (too large) fall through to 'failed'
        return { ok: false, error: st === 429 ? 'limit' : st === 422 ? 'unreadable' : 'failed' };
      }
      const d = res && res.data;
      if (!d || !d.bill) return { ok: false, error: 'unreadable' };
      return { ok: true, bill: d.bill, billReadId: d.billReadId || null };
    }).catch(() => ({ ok: false, error: 'failed' }));
  }

  function toPrefill(bill) {
    const parts = (bill.items || []).map(i => ({ part: i.name, brand: i.brand || '', partNo: i.part_no || '', price: i.price }));
    const sum = parts.reduce((a, p) => a + p.price, 0);
    return {
      name: parts.length ? parts[0].part : '',
      date: bill.date || '',
      odometer: bill.odometer == null ? null : bill.odometer,
      cost: bill.total > 0 ? bill.total : Math.round(sum * 100) / 100,
      shop: bill.store ? { name: bill.store.name, city: bill.store.city || '', area: bill.store.area || '' } : null,
      parts
    };
  }

  return { configure, reset, available, readBill, toPrefill };
});
