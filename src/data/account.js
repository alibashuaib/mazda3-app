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
    /* normalize.js is here for adopt(): a pulled row may have been written by
       an older build, and it must be healed before it reaches the renderer.
       In the browser the same accessor resolves off the global, where
       normalize.js publishes with Object.assign(root, api). */
    ? Object.assign({}, require('../../storage.js'), require('../core/helpers.js'), require('./normalize.js'), { session: require('./session.js') })
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
  let _watching = false;      // one auth subscription per configured client, never two

  const DEFAULTS = {
    client: null,
    rerender: () => {},
    notify: () => {},
    choose: () => Promise.resolve('server'),
    protocol: null            // null means "read location.protocol"
  };
  let env = Object.assign({}, DEFAULTS);

  let deps = dep;

  function configure(next) {
    next = next || {};
    env = Object.assign({}, env, next);
    /* Injected the way session.js takes saveVehicle. Tests pass spies so the
       sign-out lifecycle ORDER can be asserted, which is the property that
       matters most in this module. */
    if (next.session || next.wipe) {
      deps = Object.assign({}, deps, {
        session: next.session || deps.session,
        wipe: next.wipe || deps.wipe
      });
    }
  }

  function reset() {
    _user = null;
    _watching = false;
    env = Object.assign({}, DEFAULTS);
    deps = dep;
  }

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

  /* Deleting a vehicle must leave a tombstone, not merely stop pushing it.
     pull() filters on `deleted_at is null`, so a row left untouched is pulled
     straight back by the next boot's adopt() and the vehicle resurrects — on
     the same device, on the next launch.

     The payload is dropped rather than preserved: a tombstone needs the id,
     not the contents, and not keeping a deleted vehicle's data on the server
     is the better default. */
  function pushTombstone(id) {
    if (!_user || !env.client) return Promise.resolve(false);
    const stamp = nowIso();
    return Promise.resolve(env.client.from('vehicles').upsert({
      id, data: {}, updated_at: stamp, deleted_at: stamp
    })).then(res => {
      if (res && res.error) throw res.error;
      clearDirty(id);        // a pending data push for a deleted vehicle is moot
      return true;
    }).catch(() => false);
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
  const SEED_ODOMETER = 316000;   // normalize.js's seed(): buildProfile(..., { odometer: 316000 })

  function isUntouchedSeed(garage) {
    if (!garage || !Array.isArray(garage.vehicles) || garage.vehicles.length !== 1) return false;
    const d = garage.vehicles[0].data || {};
    if (!['history', 'fuel', 'spending', 'docs'].every(k => !(Array.isArray(d[k]) && d[k].length))) return false;
    /* The record lists alone are not enough. The plan wizard rewrites `services`
       and `parts` — which are never empty, so their length says nothing — and a
       user who finished onboarding without logging anything yet would be
       classified as an untouched seed and have their setup silently replaced
       by the server's garage, with no prompt.

       The judgement here is deliberately lopsided. A false negative only costs
       a prompt the user can answer; a false positive destroys data. So a
       nickname the user typed, or an odometer they moved off the seed's own
       default, also disqualify. Cosmetic choices that a fresh install also
       makes — theme, colour, language — do not: treating those as "touched"
       would turn the untouched-seed path into dead code. */
    if (d.planSetupDone) return false;
    const car = d.car || {};
    if (car.nickname) return false;
    if (car.odometer != null && car.odometer !== SEED_ODOMETER) return false;
    return true;
  }

  /* Replace the local garage with the server's, in memory and on disk.
     Vehicles the server does not have must be DELETED, not merely left
     unwritten: loadAll() enumerates the whole vehicles store with no
     membership filter, so a leftover record reappears on the next boot,
     after the user was told their garage had been replaced.

     Pulled vehicles are written BEFORE stale ones are removed, so an
     interruption leaves a superset rather than an empty garage. */
  function adopt(pulled) {
    const previous = deps.session.garage();
    const priorIds = previous ? previous.vehicles.map(v => v.id) : [];
    /* setVehicles() is a plain assignment — unlike hydrate() it neither
       normalises nor resolves photos. Both have to happen here or every boot
       for a signed-in user paints the dashboard from local storage, then
       swaps in server records that carry photoId but no .photo, and the car
       photo disappears until the next reload does it again. normalizeData is
       idempotent, so running it on an already-current row costs nothing and
       heals one written by an older build. */
    if (deps.normalizeData) pulled.vehicles.forEach(v => { deps.normalizeData(v.data); });
    deps.session.setVehicles(pulled.vehicles, pulled.activeId);
    if (deps.session.refreshPhotoUrls) deps.session.refreshPhotoUrls();
    const activeId = deps.session.garage() ? deps.session.garage().activeId : null;
    const keep = pulled.vehicles.map(v => v.id);
    const stale = priorIds.filter(id => keep.indexOf(id) < 0);
    return pulled.vehicles.reduce(
      (p, v) => p.then(() => deps.saveVehicle(v.id, v.data, activeId, deps.uid)),
      Promise.resolve()
    ).then(() => stale.reduce(
      (p, id) => p.then(() => deps.removeVehicle(id, activeId)),
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

  /* The mirror of adopt(): make the SERVER match this device. uploadAll() alone
     is a merge, not a replace — a server-only vehicle it never touches is
     pulled straight back by the next boot's adopt(), after the user was told
     "the other is replaced". Tombstones are how a delete travels in this
     schema, so every pulled id the local garage does not have gets one. */
  function replaceServer(pulled, local) {
    const keep = (local && local.vehicles ? local.vehicles : []).map(v => v.id);
    const gone = pulled.vehicles.map(v => v.id).filter(id => keep.indexOf(id) < 0);
    return gone.reduce((p, id) => p.then(() => pushTombstone(id)), Promise.resolve())
      .then(() => uploadAll(local));
  }

  /* Sign-in only. Boot takes the adopt() path directly: at boot both sides are
     the same user, dirty vehicles have already been pushed, so the server is
     current by construction and there is nothing to ask about. */
  function reconcile(pulled) {
    const local = deps.session.garage();
    if (!pulled.vehicles.length) return uploadAll(local);
    if (isUntouchedSeed(local)) return adopt(pulled);
    return Promise.resolve(env.choose()).then(keep => keep === 'local' ? replaceServer(pulled, local) : adopt(pulled));
  }

  function drain() {
    const ids = dirty();
    if (!ids.length) return Promise.resolve(0);
    const g = deps.session.garage();
    return ids.reduce((p, id) => p.then(() => {
      const v = g && g.vehicles.find(x => x.id === id);
      if (!v) { clearDirty(id); return null; }      // deleted since; nothing to push
      return pushVehicle(id, v.data).then(() => clearDirty(id)).catch(() => {});
    }), Promise.resolve()).then(() => dirty().length);
  }

  /* supabase-js obfuscates a duplicate signup rather than confirming that an
     address exists: it resolves with a user carrying an EMPTY identities array
     and no session. Some project configurations return an explicit error
     instead, so both shapes are recognised. */
  function isAlreadyRegistered(res) {
    const u = res && res.data && res.data.user;
    return !!(u && Array.isArray(u.identities) && u.identities.length === 0);
  }

  function signIn(email, password, opts) {
    opts = opts || {};
    const call = opts.signUp
      ? env.client.auth.signUp({ email, password })
      : env.client.auth.signInWithPassword({ email, password });
    return Promise.resolve(call).then(res => {
      if (res && res.error) {
        if (/already registered|already exists/i.test(String(res.error.message || ''))) {
          throw new Error('EMAIL_ALREADY_REGISTERED');
        }
        throw res.error;
      }
      if (opts.signUp && isAlreadyRegistered(res)) throw new Error('EMAIL_ALREADY_REGISTERED');
      /* Gate on the SESSION, not the user. With e-mail confirmation pending
         supabase-js resolves { session: null, user: <user> } — a truthy user
         with no access token. Setting _user from that signs the app in as
         `anon`: RLS then returns an empty vehicle list with no error, the
         server-empty branch of reconcile() runs, and the upload is refused. */
      const s = res && res.data && res.data.session;
      if (!s || !s.user) throw new Error('EMAIL_NOT_CONFIRMED');
      _user = s.user;
      /* The merge decision cannot be made without knowing what the server
         holds, so an unreachable server fails the sign-in outright rather
         than leaving a half-signed-in state that would upload over it. */
      return pull().catch(() => { throw new Error('PULL_FAILED'); })
        .then(pulled => reconcile(pulled))
        .then(() => { env.rerender(); return true; })
        /* EVERY post-auth failure, not just the pull: the spec's rule is that
           sign-in refuses rather than leaving a half-signed-in state, and a
           rejected reconcile/upload used to escape with _user still set —
           the UI said "wrong password" while Settings said "signed in as". */
        .catch(err => { _user = null; throw err; });
    });
  }

  /* Deliberate sign-out. Wipes. Contrast expire(), which must not.
     The ONLY caller of session.clear() in the codebase, and it always ends
     with a re-render: revoking a blob URL does not blank a decoded <img>. */
  function signOut() {
    /* auth.signOut() RESOLVES with {error} rather than rejecting, so the catch
       below covers only a synchronous throw. Either way the local wipe runs:
       a remote sign-out that failed is exactly the case where the stored token
       may still be on disk, and stranding local state there is the bug. */
    let remoteFailed = false;
    return Promise.resolve()
      .then(() => env.client && env.client.auth.signOut())
      .then(res => { remoteFailed = !!(res && res.error); })
      .catch(() => { remoteFailed = true; })  // a failed remote sign-out must not strand local state
      .then(() => {
        _user = null;
        deps.session.clear();
        return deps.wipe();
      })
      .then(() => deps.session.load())
      .then(firstRun => (firstRun ? deps.session.save() : null))
      /* The local half always completed by the time this resolves; the boolean
         reports only whether the REMOTE sign-out succeeded. wipe() removes the
         stored sb-<ref>-auth-token either way, so a false here does not mean a
         session survived on this device. */
      .then(() => { env.rerender(); return !remoteFailed; });
  }

  /* Token expired or refresh failed. Drop to anonymous and KEEP EVERYTHING:
     wiping here would destroy a garage because a phone was offline for a
     fortnight, or because of a transient 401. The next successful sign-in
     goes through the normal merge, which will ask. */
  function expire() {
    _user = null;
    env.rerender();
  }

  /* expire()'s only caller. Without it expire() is dead code and a mid-session
     token expiry is invisible: Settings keeps saying "Signed in as", and every
     save quietly piles onto the dirty list until the next launch.

     The event names are read off vendor/supabase.js, which emits SIGNED_IN,
     SIGNED_OUT, TOKEN_REFRESHED, USER_UPDATED, PASSWORD_RECOVERY and
     INITIAL_SESSION. gotrue-js has no dedicated "refresh failed" event — it
     emits SIGNED_OUT once a refresh gives up. A TOKEN_REFRESHED carrying no
     session is the other shape that means the token is gone.

     expire() must never destroy local data, and signOut() stays the module's
     single storage-clearing call site. The `!_user` guard also means our
     own signOut(), which nulls _user before auth.signOut() echoes SIGNED_OUT
     back, cannot re-enter this path. */
  function watchAuth() {
    if (_watching) return;
    const auth = env.client && env.client.auth;
    // Every fake in the Node suite omits this; a missing subscription is not a failure.
    if (!auth || typeof auth.onAuthStateChange !== 'function') return;
    _watching = true;
    try {
      auth.onAuthStateChange((event, session) => {
        if (!_user) return;                  // already anonymous — nothing to drop
        if (event === 'SIGNED_OUT' || (event === 'TOKEN_REFRESHED' && !session)) expire();
      });
    } catch (e) { _watching = false; }
  }

  function start() {
    if (!available()) return Promise.resolve(false);
    return Promise.resolve(env.client.auth.getSession()).then(res => {
      if (res && res.error) throw res.error;
      const s = res && res.data && res.data.session;
      if (!s || !s.user) { _user = null; return false; }
      _user = s.user;
      watchAuth();
      /* Dirty first, then pull: the local writes that never made it up are
         newer than anything the server holds, and pulling first would adopt a
         garage that is missing them. */
      return drain()
        .then(() => pull())
        .then(pulled => adopt(pulled))
        .then(() => { env.rerender(); return true; })
        .catch(() => false);   // offline boot: stay signed in, keep rendering from local
    }).catch(() => { _user = null; return false; });
  }

  return {
    configure, reset, available, user, setUserForTest,
    dirty, markDirty, clearDirty,
    stripPhotos, pushVehicle, pushGarage, pushTombstone, onSaved,
    pull, isUntouchedSeed, adopt, uploadAll, reconcile,
    drain, signIn, signOut, expire, start,
    SUPABASE_URL, SUPABASE_ANON_KEY
  };
});
