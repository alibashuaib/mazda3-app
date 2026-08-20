/* ============================================================
   Garage — accounts: who the garage belongs to.
   session.js owns the garage in memory and stays local-only; this
   module is the only thing that knows a server exists. It drives the
   session through configure/clear/load/setVehicles and never reaches
   past that surface.

   The invariant worth protecting: signOut() is the ONLY caller of
   session.clear() in the codebase, and it always follows it with a
   re-render. Revoking a blob URL does not blank an already-decoded
   <img>, so a clear() without a re-render leaves the previous user's
   car photo on screen.

   Dual-mode, like storage.js.
   ============================================================ */
'use strict';
(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const dep = isNode
    ? Object.assign({}, require('../../storage.js'), require('../core/helpers.js'), { session: require('./session.js') })
    : root;
  const api = factory(dep);
  if (isNode) module.exports = api;
  else root.account = api;      // a namespace, not loose globals — `user` would collide
})(typeof self !== 'undefined' ? self : globalThis, function (dep) {

  /* Public by design. RLS is the boundary; secrecy is not. Replace both
     before the first deploy — see supabase/schema.sql. */
  const SUPABASE_URL = 'https://REPLACE_ME.supabase.co';
  const SUPABASE_ANON_KEY = 'REPLACE_ME';

  const DIRTY_KEY = 'garage.sync.dirty';

  let _user = null;

  const DEFAULTS = {
    client: null,
    rerender: () => {},
    notify: () => {},
    choose: () => Promise.resolve('server'),
    protocol: null            // null means "read location.protocol"
  };
  let env = Object.assign({}, DEFAULTS);

  function configure(next) { env = Object.assign({}, env, next || {}); }
  function reset() { _user = null; env = Object.assign({}, DEFAULTS); }

  function protocol() {
    if (env.protocol) return env.protocol;
    return (typeof location !== 'undefined' && location.protocol) || '';
  }

  /* Sign-in needs a real origin: the vendored client is a same-origin script,
     but Supabase's own requests are cross-origin fetches that an opaque
     file:// origin cannot make. Opening index.html from disk is a documented
     feature, so it stays anonymous rather than showing a control that fails. */
  function available() { return protocol() !== 'file:' && !!env.client; }

  function user() { return _user; }

  function dirty() {
    try {
      const v = JSON.parse(localStorage.getItem(DIRTY_KEY));
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  }
  function setDirty(ids) {
    try { localStorage.setItem(DIRTY_KEY, JSON.stringify(ids)); } catch (e) {}
  }
  function markDirty(id) {
    const d = dirty();
    if (d.indexOf(id) < 0) { d.push(id); setDirty(d); }
  }
  function clearDirty(id) { setDirty(dirty().filter(x => x !== id)); }

  /* Photos stay local in Phase 4a: the Blobs live in IndexedDB and only their
     ids cross the wire. Deep-copied so the live record keeps its object URL —
     the dashboard is still rendering from it. */
  function stripPhotos(data) {
    const copy = JSON.parse(JSON.stringify(data || {}));
    [copy.car].concat(copy.history || [], copy.spending || [])
      .filter(Boolean)
      .forEach(o => { delete o.photo; });
    return copy;
  }

  function nowIso() { return new Date().toISOString(); }

  /* user_id is filled by the column default (auth.uid()), so it is never sent
     and never trusted from the client. The upsert conflicts on the table's
     primary key, (user_id, id). */
  function pushVehicle(id, data) {
    return Promise.resolve(env.client.from('vehicles').upsert({
      id, data: stripPhotos(data), updated_at: nowIso(), deleted_at: null
    })).then(res => {
      if (res && res.error) throw res.error;
      return true;
    });
  }

  function pushGarage(activeId) {
    return Promise.resolve(env.client.from('garage').upsert({
      active_id: activeId, updated_at: nowIso()
    })).then(res => {
      if (res && res.error) throw res.error;
      return true;
    });
  }

  /* session.js calls this through env.afterSave, after a successful LOCAL
     write. Never rejects and never notifies: logging fuel at a petrol station
     with no signal is normal operation, not an error worth interrupting for.
     The dirty list is what makes it recoverable. */
  function onSaved(id, data) {
    if (!_user || !env.client) return Promise.resolve(false);
    return pushVehicle(id, data)
      .then(() => { clearDirty(id); return true; })
      .catch(() => { markDirty(id); return false; });
  }

  /* Test seam only. Production code reaches _user through signIn/start. */
  function setUserForTest(u) { _user = u; }

  return {
    configure, reset, available, user, setUserForTest,
    dirty, markDirty, clearDirty,
    stripPhotos, pushVehicle, pushGarage, onSaved,
    SUPABASE_URL, SUPABASE_ANON_KEY
  };
});
