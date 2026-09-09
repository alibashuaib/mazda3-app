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

  return { configure, reset, available };
});
