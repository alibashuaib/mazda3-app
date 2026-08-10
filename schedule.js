/* ============================================================
   Garage — pure schedule math.
   Dual-mode: a plain <script> in the browser (assigns to the global
   object) and require()d by the Node tests. Must stay free of DOM,
   localStorage and the app's `state` global so it is testable.
   ============================================================ */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof self !== 'undefined' ? self : globalThis, function () {

  /* The current date at local midnight. Called per render — never cached,
     so the app stays correct when left open across midnight. */
  function today() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  /* localStorage quota errors, across browsers. Chrome/Safari throw
     QuotaExceededError, Firefox NS_ERROR_DOM_QUOTA_REACHED, older
     engines set legacy code 22. */
  function isQuotaError(err) {
    if (!err) return false;
    return err.name === 'QuotaExceededError'
      || err.name === 'NS_ERROR_DOM_QUOTA_REACHED'
      || err.code === 22;
  }

  return { today, isQuotaError };
});
