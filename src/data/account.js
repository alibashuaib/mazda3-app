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

  function pull() {
    return Promise.all([
      Promise.resolve(env.client.from('vehicles').select('id,data,updated_at').is('deleted_at', null)),
      Promise.resolve(env.client.from('garage').select('active_id').maybeSingle())
    ]).then(([v, g]) => {
      if (v && v.error) throw v.error;
      if (g && g.error) throw g.error;
      return {
        vehicles: (v.data || []).map(r => ({ id: r.id, data: r.data })),
        activeId: (g && g.data && g.data.active_id) || null
      };
    });
  }

  /* The default vehicle hydrate() invents on a fresh device: one car, nothing
     logged against it. Derived from data already in memory rather than tracked
     with a flag — there is no state to keep in sync and nothing to migrate. */
  function isUntouchedSeed(garage) {
    if (!garage || !Array.isArray(garage.vehicles) || garage.vehicles.length !== 1) return false;
    const d = garage.vehicles[0].data || {};
    return ['history', 'fuel', 'spending', 'docs'].every(k => !(Array.isArray(d[k]) && d[k].length));
  }

  /* Replace the local garage with the server's, in memory and on disk.
     Vehicles the server does not have must be DELETED, not merely left
     unwritten: loadAll() enumerates the whole vehicles store with no
     membership filter, so a leftover record reappears on the next boot,
     after the user was told their garage had been replaced.

     Pulled vehicles are written BEFORE stale ones are removed, so an
     interruption leaves a superset rather than an empty garage. */
  function adopt(pulled) {
    const previous = dep.session.garage();
    const priorIds = previous ? previous.vehicles.map(v => v.id) : [];
    dep.session.setVehicles(pulled.vehicles, pulled.activeId);
    const activeId = dep.session.garage() ? dep.session.garage().activeId : null;
    const keep = pulled.vehicles.map(v => v.id);
    const stale = priorIds.filter(id => keep.indexOf(id) < 0);
    return pulled.vehicles.reduce(
      (p, v) => p.then(() => dep.saveVehicle(v.id, v.data, activeId, dep.uid)),
      Promise.resolve()
    ).then(() => stale.reduce(
      (p, id) => p.then(() => dep.removeVehicle(id, activeId)),
      Promise.resolve()
    )).then(() => {});
  }

  function uploadAll(garage) {
    if (!garage || !garage.vehicles) return Promise.resolve();
    return garage.vehicles.reduce(
      (p, v) => p.then(() => pushVehicle(v.id, v.data)),
      Promise.resolve()
    ).then(() => pushGarage(garage.activeId)).then(() => {});
  }

  /* Sign-in only. Boot takes the adopt() path directly: at boot both sides are
     the same user, dirty vehicles have already been pushed, so the server is
     current by construction and there is nothing to ask about. */
  function reconcile(pulled) {
    const local = dep.session.garage();
    if (!pulled.vehicles.length) return uploadAll(local);
    if (isUntouchedSeed(local)) return adopt(pulled);
    return Promise.resolve(env.choose()).then(keep => keep === 'local' ? uploadAll(local) : adopt(pulled));
  }

  return {
    configure, reset, available, user, setUserForTest,
    dirty, markDirty, clearDirty,
    stripPhotos, pushVehicle, pushGarage, onSaved,
    pull, isUntouchedSeed, adopt, uploadAll, reconcile,
    SUPABASE_URL, SUPABASE_ANON_KEY
  };
});
