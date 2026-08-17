/* ============================================================
   Garage — the session: who owns the garage in memory.
   Everything that reads vehicle data goes through current(); nothing
   else holds a reference. That is what makes sign-out possible —
   clear() is the whole of it, and no page module has to know.
   Dual-mode, like storage.js.
   ============================================================ */
'use strict';
(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const dep = isNode
    ? Object.assign({},
        require('../../schedule.js'),
        require('../../storage.js'),
        require('../core/helpers.js'),
        require('./normalize.js'))
    : root;
  const api = factory(dep);
  if (isNode) module.exports = api;
  else root.session = api;      // a namespace, not loose globals — `save` would collide
})(typeof self !== 'undefined' ? self : globalThis, function (dep) {

  let _garage = null;
  let _state = null;
  let _booted = false;
  let _photos = {};          // photo id -> Blob, for the active session
  let _liveUrls = [];

  /* Browser bits are injected so the whole module is testable under Node,
     and so a future sign-in flow can swap the notifier. */
  let env = {
    notify: () => {},
    makeObjectUrl: b => URL.createObjectURL(b),
    revokeObjectUrl: u => URL.revokeObjectURL(u),
    saveVehicle: null        // null means "use dep.saveVehicle"
  };
  function configure(next) { env = Object.assign({}, env, next || {}); }

  function current() { return _state; }
  function garage() { return _garage; }
  function booted() { return _booted; }
  function photos() { return _photos; }

  function objectUrl(blob) {
    const url = env.makeObjectUrl(blob);
    _liveUrls.push(url);
    return url;
  }

  function revokeObjectUrls() {
    _liveUrls.forEach(u => { try { env.revokeObjectUrl(u); } catch (e) {} });
    _liveUrls = [];
  }

  function hydrate(garage, photos) {
    if (!garage || !Array.isArray(garage.vehicles) || !garage.vehicles.length) {
      // Pre-garage single-car data still living under STORE_KEY is this user's
      // only copy — seed from it before falling back to a blank car.
      const legacy = dep.readLegacyV1();
      garage = { vehicles: [{ id: dep.uid(), data: dep.normalizeData(legacy || dep.seed()) }], activeId: null };
      garage.activeId = garage.vehicles[0].id;
    }
    garage.vehicles.forEach(v => {
      dep.normalizeData(v.data);
      resolvePhotos(v.data, photos);
    });
    const active = garage.vehicles.find(v => v.id === garage.activeId) || garage.vehicles[0];
    garage.activeId = active.id;
    return { garage, state: active.data };
  }

  /* Turn stored photo ids into object URLs so `.photo` keeps working in every
     render path. Registered for revocation on the next navigation. */
  function resolvePhotos(data, photos) {
    const slots = [data.car].concat(data.history || [], data.spending || []).filter(Boolean);
    slots.forEach(o => {
      if (o.photoId && photos[o.photoId]) o.photo = objectUrl(photos[o.photoId]);
    });
  }

  /* Re-create object URLs after a revocation sweep. Must cover EVERY vehicle:
     revokeObjectUrls() is indiscriminate, and the garage switcher renders photos
     for vehicles that are not active. */
  function refreshPhotoUrls() {
    if (!_garage) return;
    _garage.vehicles.forEach(v => resolvePhotos(v.data, _photos));
  }

  /* Drop session Blobs no vehicle points at any more. storage.js deletes the
     stored copy on save and on vehicle removal; without this the in-memory
     cache still holds them, and exportGarage base64s every one into the backup.
     Cheap: it walks the garage's photo ids, not the images. */
  function prunePhotoBlobs() {
    if (!_garage || !_photos) return;
    dep.unreferencedPhotoIds(Object.keys(_photos), _garage.vehicles)
      .forEach(id => { delete _photos[id]; });
  }

  /* Keep just-saved images in the session cache so later navigations render
     them from a Blob like every other photo, instead of a lingering data URL. */
  function cacheNewPhotos(live, photoIds) {
    if (!photoIds || !photoIds.length) return;
    const slots = [live.car].concat(live.history || [], live.spending || []).filter(Boolean);
    slots.forEach(o => {
      if (o.photoId && photoIds.indexOf(o.photoId) >= 0 && !_photos[o.photoId]) {
        const blob = dep.dataUrlToBlob(o.photo);
        if (blob) _photos[o.photoId] = blob;
      }
    });
  }

  function setVehicles(vehicles, activeId) {
    _garage = { vehicles, activeId };
    const active = vehicles.find(v => v.id === activeId) || vehicles[0] || null;
    _garage.activeId = active ? active.id : null;
    _state = active ? active.data : null;
  }

  function switchVehicle(id) {
    if (!_garage) return;
    const v = _garage.vehicles.find(x => x.id === id);
    if (!v) return;                 // unknown id must not blank the app
    _garage.activeId = id;
    _state = v.data;
  }

  /* Boot. Mirrors app.js:3211-3219, with hydrate moved in from app.js:989. */
  function load() {
    return dep.openStorage()
      .then(dep.loadAll)
      .then(({ garage: g, photos: p }) => {
        _photos = p || {};
        const h = hydrate(g, _photos);
        _garage = h.garage;
        _state = h.state;
        _booted = true;
        return !g || !g.vehicles || !g.vehicles.length;   // true => first run, caller should save()
      });
  }

  function save() {
    if (!_garage) return Promise.resolve(false);
    const v = _garage.vehicles.find(x => x.id === _garage.activeId);
    if (!v) return Promise.resolve(false);
    v.data = _state;
    const data = _state;        // `_state` may move before this resolves
    const doSave = env.saveVehicle || dep.saveVehicle;
    return Promise.resolve(doSave(v.id, data, _garage.activeId, dep.uid)).then(res => {
      if (res.ok) {
        dep.applyPhotoIds(data, res.data);
        cacheNewPhotos(data, res.photoIds);
        prunePhotoBlobs();
        return true;
      }
      env.notify(dep.isQuotaError(res.error)
        ? 'Storage is full — your change was NOT saved. Remove some receipt photos.'
        : 'Could not save your change.', 'warn');
      return false;
    });
  }

  /* Sign-out, in full. Phase 4 adds a storage wipe beside this call; nothing
     else in the app needs to change. */
  function clear() {
    revokeObjectUrls();
    _garage = null;
    _state = null;
    _booted = false;
    _photos = {};
  }

  return {
    configure, load, save, clear,
    current, garage, booted, photos,
    setVehicles, switchVehicle,
    objectUrl, revokeObjectUrls, refreshPhotoUrls
  };
});
