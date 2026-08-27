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
    ? Object.assign({}, require('./storage.js'), require('../core/helpers.js'), require('./normalize.js'), { session: require('./session.js') })
    : root;
  const api = factory(dep);
  if (isNode) module.exports = api;
  else root.account = api;      // a namespace, not loose globals — `user` would collide
})(typeof self !== 'undefined' ? self : globalThis, function (dep) {

  /* Public by design. RLS is the boundary; secrecy is not. Replace both
     before the first deploy — see supabase/schema.sql. */
  const SUPABASE_URL = 'https://REPLACE_ME.supabase.co';
  const SUPABASE_ANON_KEY = 'REPLACE_ME';

  let _user = null;
  let _watching = false;      // one auth subscription per configured client, never two

  const DEFAULTS = {
    client: null,
    rerender: () => {},
    /* No `notify`. Every failure this module can produce is either silent by
       design (a failed push leaves its outbox entry queued; Settings carries
       the status) or surfaced inline by the caller (the auth form's error line).
       An unread hook on the configure surface only invites a future caller to
       assume it does something. */
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
    if (next.session || next.wipe || next.getPhotoBlob || next.putPhotoBlob ||
        next.saveVehicle || next.removeVehicle || next.metaGet || next.metaSet) {
      deps = Object.assign({}, deps, {
        session: next.session || deps.session,
        wipe: next.wipe || deps.wipe,
        getPhotoBlob: next.getPhotoBlob || deps.getPhotoBlob,
        putPhotoBlob: next.putPhotoBlob || deps.putPhotoBlob,
        saveVehicle: next.saveVehicle || deps.saveVehicle,
        removeVehicle: next.removeVehicle || deps.removeVehicle,
        metaGet: next.metaGet || deps.metaGet,
        metaSet: next.metaSet || deps.metaSet
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
     primary key, (user_id, id).

     `updated_at` below is this device's clock, sent because the column is
     `not null` — but it is advisory only: `set_updated_at()` in
     supabase/schema.sql overwrites it with the database's own `now()` on
     every insert/update, regardless of what the client sent. pullIncremental's
     cursor compares `updated_at` across devices, so a value any one device's
     clock produced would let a fast or slow clock skip rows or hide them from
     other devices; the trigger removes that dependency on client clocks
     entirely. */
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
     is the better default.

     This is the drain-time push for a tombstone entry. No dirty-list side
     effect — the outbox entry IS the record of "this still needs pushing";
     drain() removes it on success, same as a vehicle entry. */
  function pushTombstoneRow(id) {
    if (!_user || !env.client) return Promise.resolve(false);
    const stamp = nowIso();
    return Promise.resolve().then(() => env.client.from('vehicles').upsert({
      id, data: {}, updated_at: stamp, deleted_at: stamp
    })).then(res => {
      if (res && res.error) throw res.error;
      return true;
    }).catch(() => false);
  }

  /* {user_id}/{photoId} — mirrors the RLS path convention for the vehicles
     table, enforced by the storage policy in supabase/schema.sql instead of
     application code. */
  function photoPath(id) { return `${_user.id}/${id}`; }

  function uploadPhoto(id, blob) {
    if (!_user || !env.client || !env.client.storage) return Promise.resolve(false);
    return Promise.resolve(env.client.storage.from('photos').upload(photoPath(id), blob, { upsert: true }))
      .then(res => { if (res && res.error) throw res.error; return true; })
      .catch(() => false);
  }

  /* The mirror of uploadPhoto(), for a 'photo-delete' outbox entry. Same
     silent-failure/leave-queued convention as every other drain path — an
     object that fails to delete (offline, a transient Storage error) is
     retried on the next drain, not abandoned. */
  function deletePhotoRemote(id) {
    if (!_user || !env.client || !env.client.storage) return Promise.resolve(false);
    return Promise.resolve(env.client.storage.from('photos').remove([photoPath(id)]))
      .then(res => { if (res && res.error) throw res.error; return true; })
      .catch(() => false);
  }

  /* One outbox entry. `id` is the entry's own id, distinct from vehicleId —
     a vehicle and its photo can both be queued under the same vehicleId. */
  function enqueue(entry) {
    if (!_user || !env.client) return Promise.resolve(false);
    return deps.outboxAdd(Object.assign({ id: deps.uid(), createdAt: nowIso() }, entry));
  }

  /* session.js's afterSave hook calls this after a successful LOCAL write.
     Snapshots the stripped data now, not at drain time — the live record may
     have changed again, or the vehicle may have been deleted, before the
     outbox is next drained. */
  function enqueueVehicle(id, data) {
    return enqueue({ kind: 'vehicle', vehicleId: id, data: stripPhotos(data) });
  }

  /* A pending 'vehicle' push for THIS id is moot once a tombstone is queued
     for it — Phase 4a's old pushTombstone had the equivalent guard
     (clearDirty(id), "a pending data push for a deleted vehicle is moot")
     against the dirty list; the outbox replaced that list without carrying
     the protection forward. Without this, an older still-queued 'vehicle'
     entry (e.g. one whose earlier drain attempt failed and stayed queued)
     can drain AFTER the tombstone and set deleted_at back to null on the
     server, resurrecting a vehicle the user just deleted. This is a plain
     filter, not an assumption the entry still exists — a vehicle entry
     already drained/removed by the time this runs is simply not found and
     nothing happens.

     `photoIds`, if given, are queued as 'photo-delete' entries alongside the
     tombstone — the caller must capture them from the vehicle's data BEFORE
     deleting it locally (removeVehicle() deletes the local blobs, and by the
     time drain() runs the vehicle is gone from every local structure that
     could tell it which photos it once had). Without this a deleted
     vehicle's photos stay in Storage forever — the vehicles row is
     tombstoned and stops being pulled, but nothing ever asks Storage to
     forget the objects it pointed at. */
  function enqueueTombstone(id, photoIds) {
    if (!_user || !env.client) return Promise.resolve(false);
    return deps.outboxAll().then(entries => {
      const stale = entries.filter(e => e.kind === 'vehicle' && e.vehicleId === id);
      return stale.reduce((p, e) => p.then(() => deps.outboxRemove(e.id)), Promise.resolve());
    }).then(() => enqueue({ kind: 'tombstone', vehicleId: id })).then(result =>
      /* Resolve with the tombstone enqueue's own result (its established
         contract, asserted by callers), not whatever this reduce happens to
         produce — an empty photoIds list resolves the reduce's own
         Promise.resolve() to `undefined`, which would silently replace a
         `true` here. */
      (photoIds || []).reduce((p, pid) => p.then(() => enqueue({ kind: 'photo-delete', photoId: pid })), Promise.resolve())
        .then(() => result)
    );
  }

  function enqueuePhoto(id) {
    return enqueue({ kind: 'photo', photoId: id });
  }

  function outboxSize() {
    return deps.outboxAll().then(entries => entries.length);
  }

  /* photo < vehicle < tombstone < photo-delete — a photo a vehicle row
     references must exist on the server before the row does; a tombstone
     drains last among the push kinds so an edit enqueued just before a
     delete of the same vehicle cannot resurrect it; a photo's own deletion
     from Storage drains after that, once the row that referenced it is
     already gone server-side. */
  const KIND_ORDER = { photo: 0, vehicle: 1, tombstone: 2, 'photo-delete': 3 };

  function drainOne(entry) {
    if (entry.kind === 'photo') {
      return deps.getPhotoBlob(entry.photoId).then(blob => {
        const run = blob ? uploadPhoto(entry.photoId, blob) : Promise.resolve(true);
        return run.then(ok => ok && deps.outboxRemove(entry.id));
      }).catch(() => {});
    }
    if (entry.kind === 'photo-delete') {
      return deletePhotoRemote(entry.photoId).then(ok => ok && deps.outboxRemove(entry.id)).catch(() => {});
    }
    const run = entry.kind === 'tombstone' ? pushTombstoneRow(entry.vehicleId)
      : pushVehicle(entry.vehicleId, entry.data);
    return run.then(ok => ok && deps.outboxRemove(entry.id)).catch(() => {});
  }

  function drain() {
    if (!_user || !env.client) return Promise.resolve(0);
    return deps.outboxAll().then(entries => {
      const sorted = entries.slice().sort((a, b) =>
        (KIND_ORDER[a.kind] - KIND_ORDER[b.kind]) ||
        (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
      return sorted.reduce((p, e) => p.then(() => drainOne(e)), Promise.resolve());
    }).then(() => deps.outboxAll()).then(remaining => remaining.length);
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
  const SEED_ODOMETER = 0;   // normalize.js's seed(): buildProfile(..., { odometer: 0 })

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
    return gone.reduce((p, id) => p.then(() => pushTombstoneRow(id)), Promise.resolve())
      .then(() => uploadAll(local));
  }

  function downloadPhoto(id) {
    if (!_user || !env.client || !env.client.storage) return Promise.resolve(null);
    return Promise.resolve(env.client.storage.from('photos').download(photoPath(id)))
      .then(res => (res && !res.error && res.data) ? res.data : null)
      .catch(() => null);
  }

  /* Fetches every id in `ids` that is not already local, writing each
     successful download into the photo store. Returns the ids that are
     STILL missing afterwards — a transient failure (offline mid-sync, a
     Storage hiccup) does not throw and does not block the caller; it comes
     back in this list instead, so the caller can persist it for a retry
     that does not depend on the row ever being re-pulled (see
     `pullIncremental`'s use of `meta.pendingPhotoDownloads`). Without that
     persistence a photo that failed to download once would only ever be
     retried if the vehicle's `updated_at` moved past the cursor again —
     which a photo-only failure never causes — so the gap would otherwise be
     permanent, not merely transient. */
  function downloadMissingPhotos(ids) {
    const stillMissing = [];
    return (ids || []).reduce((p, id) => p.then(() => deps.getPhotoBlob(id)).then(existing => {
      if (existing) return null;
      return downloadPhoto(id).then(blob => {
        if (blob) return deps.putPhotoBlob(id, blob);
        stillMissing.push(id);
        return null;
      });
    }), Promise.resolve()).then(() => stillMissing);
  }

  /* Every photoId a pulled row references that this device does not already
     have gets fetched once and written into the local photo store, before
     the row is saved — otherwise resolvePhotos() finds nothing and the
     image silently stays blank (4a's own documented gap, closed here). */
  function ensurePhotosLocal(data) {
    return downloadMissingPhotos(deps.photoIdsIn ? deps.photoIdsIn(data) : []);
  }

  /* saveVehicle/removeVehicle never REJECT on a storage failure — they
     resolve { ok: false } / false, the same convention session.js's own
     writers use. A pull that treated "the promise resolved" as success would
     advance the cursor past a row that was never actually written, which is
     silent, permanent data loss on this device. So every write here is
     checked for that resolved-but-failed shape and turned into a rejection,
     which stops pullIncremental's reduce chain before metaSet runs.

     `expectedUser` is the sign-out-race guard: the user captured by
     pullIncremental() when the sync attempt started. session.js's own
     save() has the analogous protection on the push side (a `_generation`
     token, tested by "a save in flight when sign-out happens cannot land in
     the next session"); this is the same class of bug on the pull side. A
     network round-trip can outlive a signOut() that runs mid-flight —
     signOut() sets _user = null and then wipes storage — so without this
     check a pulled row from the PREVIOUS user can still be written into the
     just-wiped store. undefined skips the check (direct callers/tests that
     do not pass one keep today's behavior). */
  /* `pendingOut`, if given, collects any photoId that ensurePhotosLocal could
     not resolve for this row — pullIncremental persists it to
     `meta.pendingPhotoDownloads` so the failure is retried on every future
     sync rather than only when this vehicle happens to be pulled again. */
  function applyPulledRow(row, activeId, expectedUser, pendingOut) {
    if (expectedUser !== undefined && _user !== expectedUser) {
      return Promise.reject(new Error('SIGNED_OUT_MID_SYNC'));
    }
    if (row.deleted_at) {
      return deps.removeVehicle(row.id, activeId).then(res => {
        if (res === false) throw new Error('removeVehicle failed for ' + row.id);
        return res;
      });
    }
    const data = row.data;
    if (deps.normalizeData) deps.normalizeData(data);
    return ensurePhotosLocal(data).then(missing => {
      if (pendingOut) missing.forEach(id => { if (pendingOut.indexOf(id) < 0) pendingOut.push(id); });
      return deps.saveVehicle(row.id, data, activeId, deps.uid);
    }).then(res => {
      if (res && res.ok === false) throw (res.error || new Error('saveVehicle failed for ' + row.id));
      return res;
    });
  }

  /* Additive to pull()/adopt() (4a, sign-in only, unchanged). This answers
     "what changed since I last checked" for a device that already has this
     user's garage — never runs before that first resolution. */
  function pullIncremental() {
    const expectedUser = _user;
    return deps.metaGet().then(m => {
      /* adopt() (sign-in path, above) never calls ensurePhotosLocal — a new
         device gets its photos only as a side effect of THIS default: with no
         lastPulledAt yet, the epoch cursor makes the first post-sign-in
         pullIncremental() re-pull and re-apply every row from scratch, and
         applyPulledRow()'s ensurePhotosLocal call is what actually downloads
         them. Seeding lastPulledAt at sign-in time (e.g. to skip a redundant
         first sync) would silently break photo sync on new devices — this
         coupling has to move with any such change, not be assumed away. */
      const cursor = m.lastPulledAt || '1970-01-01T00:00:00.000Z';
      /* Photo ids that a PREVIOUS sync failed to download and could not
         retire — retried here on every sync regardless of whether this
         batch pulls any rows at all, because nothing about a stuck download
         is fixed by the vehicle row changing again. */
      const pendingBefore = m.pendingPhotoDownloads || [];
      return downloadMissingPhotos(pendingBefore).then(pendingOut =>
        Promise.resolve(env.client.from('vehicles').select('id,data,updated_at,deleted_at').gt('updated_at', cursor))
          .then(res => {
            if (res && res.error) throw res.error;
            const rows = res.data || [];
            const resolvedSome = pendingOut.length < pendingBefore.length;
            if (!rows.length) {
              return deps.metaSet({ pendingPhotoDownloads: pendingOut }).then(() => resolvedSome);
            }
            const g = deps.session.garage();
            const activeId = g ? g.activeId : null;
            /* The cursor must be server-authored, not this device's wall clock:
               nowIso() would either skip a row written between the .gt() query
               and this line (clock behind the server) or miss every later
               change until the server's clock caught back up (clock ahead).
               The max updated_at actually applied in THIS batch is monotone
               with the .gt() filter and has no clock-skew exposure. ISO 8601
               strings sort lexically the same as chronologically. */
            let maxUpdatedAt = cursor;
            return rows.reduce((p, row) => p.then(() => applyPulledRow(row, activeId, expectedUser, pendingOut)).then(() => {
              if (row.updated_at > maxUpdatedAt) maxUpdatedAt = row.updated_at;
            }), Promise.resolve())
              .then(() => deps.metaSet({ lastPulledAt: maxUpdatedAt, pendingPhotoDownloads: pendingOut }))
              .then(() => true);
          })
      );
    });
  }

  /* Returns false only for "could not run at all" (signed out, no client, or
     a failure anywhere in drain/pull — mirrors start()'s own catch-to-false
     convention so an offline blip from Task 7's online-event handler never
     surfaces as an unhandled rejection). true covers BOTH "ran clean with
     nothing new" and "ran clean and applied changes" — callers that need to
     tell those apart cannot do so from this return value alone. */
  function sync() {
    if (!_user || !env.client) return Promise.resolve(false);
    return drain().then(() => pullIncremental()).then(changed => {
      if (!changed) return true;
      return deps.session.load().then(() => { env.rerender(); return true; });
    }).catch(() => false);
  }

  /* Sign-in only. Boot takes the adopt() path directly: at boot both sides are
     the same user, the outbox has already been drained, so the server is
     current by construction and there is nothing to ask about. */
  function reconcile(pulled) {
    const local = deps.session.garage();
    if (!pulled.vehicles.length) return uploadAll(local);
    if (isUntouchedSeed(local)) return adopt(pulled);
    return Promise.resolve(env.choose()).then(keep => keep === 'local' ? replaceServer(pulled, local) : adopt(pulled));
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
      /* start() is not the only path into a signed-in state: a fresh sign-in
         needs the same subscription or its token's later expiry is invisible.
         watchAuth() is idempotent, so a prior start() is not followed by a
         second listener. */
      watchAuth();
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
     token expiry is invisible: Settings keeps saying "Signed in as", while
     enqueue() actually guards on `_user` being set — so once _user is nulled
     here, nothing queues at all. Post-expiry edits are local-only until the
     next successful sign-in.

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
      /* Drain first, then pull: the local writes queued in the outbox are
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
    stripPhotos, pushVehicle, pushGarage,
    enqueueVehicle, enqueueTombstone, enqueuePhoto, drain, outboxSize,
    pull, isUntouchedSeed, adopt, uploadAll, reconcile,
    signIn, signOut, expire, start, sync,
    SUPABASE_URL, SUPABASE_ANON_KEY
  };
});
