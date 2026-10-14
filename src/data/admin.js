/* ============================================================
   Garage — catalogue admin: the write side of the shared catalogue.
   RLS (supabase/schema.sql, Phase 5a) is what stops a non-admin; this
   module only shapes requests and admin input.

   Dual-mode, like pricing.js.
   ============================================================ */
'use strict';
(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const account = isNode ? require('./account.js') : root.account;
  const api = factory(account);
  if (isNode) module.exports = api;
  else root.catalogAdmin = api;
})(typeof self !== 'undefined' ? self : globalThis, function (account) {

  let env = { client: null };
  let _admin = false;
  let _drafts = 0;

  function configure(next) { env = Object.assign({}, env, next || {}); }
  function reset() { env = { client: null }; _admin = false; _drafts = 0; }
  function available() { return !!env.client; }
  function knownAdmin() { return _admin; }
  function draftCount() { return _drafts; }

  function data(res) { if (res && res.error) throw res.error; return res ? res.data : null; }

  /* Never rejects. Also refreshes the draft count the menu badge shows. */
  function isAdmin() {
    const u = account.user();
    if (!env.client || !u) { _admin = false; return Promise.resolve(false); }
    return Promise.resolve(env.client.from('profiles').select('role').eq('user_id', u.id).maybeSingle())
      .then(res => {
        _admin = !!(res && !res.error && res.data && res.data.role === 'admin');
        if (!_admin) return false;
        return Promise.resolve(env.client.from('car_models').select('id').eq('status', 'draft'))
          .then(r => { _drafts = (r && !r.error && r.data) ? r.data.length : 0; return true; });
      })
      .catch(() => { _admin = false; return false; });
  }

  function listModels() {
    return Promise.resolve(env.client.from('car_models').select('id,model,generation,engine,status')
      .order('model').order('generation')).then(data);
  }

  function loadModel(id) {
    return Promise.all([
      env.client.from('car_models').select('*').eq('id', id).maybeSingle(),
      env.client.from('dealer_plan_items').select('*').eq('car_model_id', id).order('sort'),
      env.client.from('dealer_plan_changes').select('item_id,before,after,changed_at')
        .eq('car_model_id', id).order('changed_at', { ascending: false }).limit(20)
    ]).then(([m, items, changes]) => ({ model: data(m), items: data(items) || [], changes: data(changes) || [] }));
  }

  function saveWarranty(id, years, km) {
    return Promise.resolve(env.client.from('car_models').update({ warranty_years: years, warranty_km: km }).eq('id', id)).then(data);
  }
  function saveItem(id, patch) {
    return Promise.resolve(env.client.from('dealer_plan_items').update(patch).eq('id', id)).then(data);
  }
  function approve(id) {
    return Promise.resolve(env.client.from('car_models').update({ status: 'approved' }).eq('id', id)).then(data);
  }

  /* Blank, negative or non-numeric input means "no value", not 0. */
  function num(v) {
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  /* One part per line: "name | part number | qty". Part number and qty are
     optional; a missing or bad qty means 1. Lines without a name are skipped. */
  function parseParts(text) {
    return String(text || '').split('\n')
      .map(line => line.split('|').map(x => x.trim()))
      .filter(f => f[0])
      .map(([name, partNo, qty]) => ({ name, part_no: partNo || '', qty: Math.max(1, parseInt(qty, 10) || 1) }));
  }
  function formatParts(parts) {
    return (parts || []).map(p => [p.name, p.part_no || '', p.qty || 1].join(' | ')).join('\n');
  }

  /* `fields` are raw form strings. Returns only what changed, so an
     untouched item writes nothing and logs nothing. */
  function itemPatch(before, fields) {
    const prev = { interval_km: before.interval_km ?? null, interval_months: before.interval_months ?? null,
      note: before.note || '', parts: before.parts || [] };
    const next = { interval_km: num(fields.interval_km), interval_months: num(fields.interval_months),
      note: String(fields.note || '').trim(), parts: parseParts(fields.parts) };
    const patch = {};
    Object.keys(next).forEach(k => { if (JSON.stringify(next[k]) !== JSON.stringify(prev[k])) patch[k] = next[k]; });
    return Object.keys(patch).length ? patch : null;
  }

  const LOGGED = ['interval_km', 'interval_months', 'note', 'parts', 'warranty_years', 'warranty_km', 'status'];
  function describeChange(c) {
    const b = c.before || {}, a = c.after || {};
    const name = a.service || b.service || (c.item_id == null ? 'Car details' : 'Item');
    const keys = LOGGED.filter(k => JSON.stringify(b[k]) !== JSON.stringify(a[k]));
    return name + ': ' + keys.map(k => `${k} ${JSON.stringify(b[k] ?? null)} → ${JSON.stringify(a[k] ?? null)}`).join(', ');
  }

  return {
    configure, reset, available, isAdmin, knownAdmin, draftCount,
    listModels, loadModel, saveWarranty, saveItem, approve,
    num, parseParts, formatParts, itemPatch, describeChange
  };
});
