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
      note: before.note || '', parts: parseParts(formatParts(before.parts)) };
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
    if (!c.after) return name + ': removed';
    const keys = LOGGED.filter(k => JSON.stringify(b[k]) !== JSON.stringify(a[k]));
    if (!keys.length) return name + ': other fields';   // e.g. icon or sort only
    return name + ': ' + keys.map(k => `${k} ${JSON.stringify(b[k] ?? null)} → ${JSON.stringify(a[k] ?? null)}`).join(', ');
  }


  /* ---- Review queue: drafts the intake function wrote, awaiting a decision ---- */
  function draftDiff(live, proposed) {
    const fmt = (k, o) => !o ? '' : k === 'parts' ? formatParts(o.parts) : o[k] == null ? '' : String(o[k]);
    return ['interval_km', 'interval_months', 'note', 'parts']
      .map(k => ({ field: k, before: fmt(k, live), after: fmt(k, proposed) }))
      .filter(r => r.before !== r.after);
  }
  function addSource(carModelId, url) {
    const u = String(url || '').trim();
    if (!/^https:\/\//i.test(u)) return Promise.reject(new Error('https only'));
    return Promise.resolve(env.client.from('schedule_sources').insert({ car_model_id: carModelId, url: u })).then(data);
  }
  function decideDraft(id, approve, edit) {
    return Promise.resolve(env.client.rpc('decide_plan_draft', { p_id: id, p_approve: !!approve, p_edit: edit || null })).then(data);
  }
  function listDrafts() {
    return Promise.all([
      env.client.from('plan_drafts').select('id,car_model_id,service,proposed,reason,source_id').eq('status', 'pending').order('created_at'),
      env.client.from('dealer_plan_items').select('car_model_id,service,interval_km,interval_months,note,parts'),
      env.client.from('schedule_sources').select('id,url')
    ]).then(([d, items, srcs]) => (data(d) || []).map(x => ({
      ...x,
      live: (data(items) || []).find(i => i.car_model_id === x.car_model_id && i.service === x.service),
      source_url: ((data(srcs) || []).find(s => s.id === x.source_id) || {}).url || ''
    })));
  }
  function listPendingRecalls() {
    return Promise.resolve(env.client.from('recalls').select('campaign,car_model_id,component,summary,years').eq('status', 'pending')).then(data).then(r => r || []);
  }
  function decideRecall(campaign, carModelId, approve) {
    return Promise.resolve(env.client.from('recalls').update({ status: approve ? 'approved' : 'rejected' }).eq('campaign', campaign).eq('car_model_id', carModelId)).then(data);
  }
  function runIntake(carModelId) {
    return Promise.resolve(env.client.functions.invoke('plan-intake', { body: carModelId ? { car_model_id: carModelId } : {} })).then(data);
  }

  /* ---- Errors tab: app_errors rows grouped for the owner (D-06, D-07) ---- */
  const ERR_COLS = 'id,created_at,source,message,stack,route,app_version,user_id,group_key,resolved_at';
  const ERR_LIMIT = 500;   // DoS cap: grouping happens in memory
  // Same idea as the DB group_key: case and digits do not split a group.
  const errKey = r => r.group_key || (r.source + '|' + String(r.message || '').toLowerCase().replace(/[0-9]+/g, '#'));

  /* Pure. A group is open when it was never resolved, or a row arrived after
     the newest resolve (reopen on new occurrence). Newest-seen first. */
  function groupErrors(rows) {
    const by = new Map();
    (rows || []).forEach(r => {
      const k = errKey(r);
      let g = by.get(k);
      if (!g) { g = { key: k, message: r.message, source: r.source, count: 0, firstSeen: r.created_at, lastSeen: r.created_at, resolvedAt: null, stacks: [] }; by.set(k, g); }
      g.count++;
      if (r.created_at < g.firstSeen) g.firstSeen = r.created_at;
      if (r.created_at > g.lastSeen) { g.lastSeen = r.created_at; g.message = r.message; }
      if (r.resolved_at && (!g.resolvedAt || r.resolved_at > g.resolvedAt)) g.resolvedAt = r.resolved_at;
      if (r.stack) g.stacks.push({ at: r.created_at, stack: r.stack });
    });
    return [...by.values()].map(g => {
      g.stacks = g.stacks.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 5).map(s => s.stack);
      g.open = !g.resolvedAt || g.lastSeen > g.resolvedAt;
      return g;
    }).sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : -1));
  }

  /* Never rejects. */
  function listErrors() {
    return Promise.resolve().then(() => env.client.from('app_errors').select(ERR_COLS)
      .order('created_at', { ascending: false }).limit(ERR_LIMIT))
      .then(res => (res && !res.error ? { ok: true, groups: groupErrors(res.data || []) } : { ok: false, error: 'failed' }))
      .catch(() => ({ ok: false, error: 'failed' }));
  }
  function resolveGroup(groupKey) {
    return Promise.resolve().then(() => env.client.from('app_errors')
      // Placeholder value: the app_errors_before_update trigger replaces it with server now().
      .update({ resolved_at: new Date().toISOString() }).eq('group_key', groupKey))
      .then(res => (res && !res.error ? { ok: true } : { ok: false, error: 'failed' }))
      .catch(() => ({ ok: false, error: 'failed' }));
  }

  /* ---- Proposals tab: the approval gate (Phase 2). Writes go through the
     apply_proposal RPC only; the browser has no table write grants. ---- */
  const PROPOSAL_COLS = 'id,run_id,kind,maker_id,car_model_id,target_key,op,before,after,evidence,confidence_tier,confidence_factors,reason,created_at';
  const PROPOSAL_LIMIT = 500;   // DoS cap, same idea as ERR_LIMIT

  /* Never rejects. */
  function listProposals() {
    return Promise.resolve().then(() => env.client.from('proposals').select(PROPOSAL_COLS)
      .eq('status', 'pending').order('created_at', { ascending: false }).limit(PROPOSAL_LIMIT))
      .then(res => {
        if (!res || res.error) return { ok: false, error: 'failed' };
        const rows = res.data || [];
        return { ok: true, rows, capped: rows.length >= PROPOSAL_LIMIT };
      })
      .catch(() => ({ ok: false, error: 'failed' }));
  }

  /* Never rejects. A stale refusal ({ok:false,error:'stale',live,live_hash}) is a
     normal answer, passed through unchanged for the UI to show. */
  function applyProposal(id, edit, seenHash) {
    return Promise.resolve().then(() => env.client.rpc('apply_proposal',
      { p_id: id, p_edit: edit || null, p_seen_hash: seenHash || null }))
      .then(res => {
        if (!res || res.error || !res.data) return { ok: false, error: 'failed' };
        return res.data.ok === false ? res.data : Object.assign({ ok: true }, res.data);
      })
      .catch(() => ({ ok: false, error: 'failed' }));
  }

  /* Never rejects. results: one {id, ok, error?} per requested id. */
  function applyProposals(ids, tier) {
    return Promise.resolve().then(() => env.client.rpc('apply_proposals', { p_ids: ids, p_tier: tier }))
      .then(res => (!res || res.error || !Array.isArray(res.data)) ? { ok: false, error: 'failed' } : { ok: true, results: res.data })
      .catch(() => ({ ok: false, error: 'failed' }));
  }

  /* Pure: {approved, failed:[{id, error}]}. */
  function bulkSummary(results) {
    const rs = Array.isArray(results) ? results : [];
    return { approved: rs.filter(r => r && r.ok).length, failed: rs.filter(r => r && !r.ok).map(r => ({ id: r.id, error: r.error })) };
  }

  /* Never rejects. Empty reason is sent as null. */
  function rejectProposal(id, reason) {
    const r = String(reason || '').trim();
    return Promise.resolve().then(() => env.client.rpc('reject_proposal', { p_id: id, p_reason: r || null }))
      .then(res => (!res || res.error) ? { ok: false, error: 'failed' } : { ok: true })
      .catch(() => ({ ok: false, error: 'failed' }));
  }

  /* Pure, in-memory filters over the one bounded fetch. Empty criterion = no filter. */
  function filterProposals(rows, f) {
    f = f || {};
    return (rows || []).filter(r => (!f.car || r.car_model_id === f.car) && (!f.kind || r.kind === f.kind) &&
      (!f.tier || r.confidence_tier === f.tier) && (!f.run || String(r.run_id) === String(f.run)));
  }
  function proposalFilterOptions(rows) {
    const uniq = k => [...new Set((rows || []).map(r => r[k]).filter(v => v != null && v !== '').map(String))].sort();
    const tiers = uniq('confidence_tier');
    return { cars: uniq('car_model_id'), kinds: uniq('kind'), tiers: ['high', 'medium', 'low'].filter(x => tiers.includes(x)), runs: uniq('run_id') };
  }

  function confidenceLabel(tier) {
    return tier === 'high' ? { text: 'High', cls: 'ok' } : tier === 'medium' ? { text: 'Medium', cls: 'warn' } : { text: 'Low', cls: 'danger' };
  }

  return {
    listProposals, applyProposal, applyProposals, bulkSummary, rejectProposal, filterProposals, proposalFilterOptions, confidenceLabel, PROPOSAL_LIMIT,
    listErrors, resolveGroup, groupErrors,
    configure, reset, available, isAdmin, knownAdmin, draftCount,
    listModels, loadModel, saveWarranty, saveItem, approve,
    num, parseParts, formatParts, itemPatch, describeChange,
    draftDiff, addSource, decideDraft, listDrafts, listPendingRecalls, decideRecall, runIntake
  };
});
