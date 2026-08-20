/* ============================================================
   Garage — HTML built safely by construction.

   Every interpolation in an html`` template is escaped. Injecting
   markup requires raw(), which is deliberately greppable: an audit
   is a list of raw() calls, not a reading of every template.

   Raw extends String rather than being a plain marker object because
   innerHTML must accept it directly. Browsers coerce assignments via
   ToString, but linkedom — which the tests run against — hands the
   value to its parser untouched and throws on a non-string.

   Dual-mode, like storage.js.
   ============================================================ */
'use strict';
(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const api = factory();
  if (isNode) module.exports = api;
  else Object.assign(root, api);
})(typeof self !== 'undefined' ? self : globalThis, function () {

  class Raw extends String {}

  const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  // Real call sites nest one level deep at most (an array of option/row
  // strings). This bounds a self-referential or pathologically nested array
  // from overflowing the stack, without touching the common (depth 0-1) path.
  const MAX_ESC_DEPTH = 50;

  function esc(v, depth) {
    if (v == null) return '';
    if (v instanceof Raw) return String(v);
    // Arrays keep the existing .map(...).join('') call sites working unchanged.
    if (Array.isArray(v)) {
      const d = depth || 0;
      if (d >= MAX_ESC_DEPTH) return '';
      return v.map(x => esc(x, d + 1)).join('');
    }
    return String(v).replace(/[&<>"']/g, c => ENTITIES[c]);
  }

  function raw(v) { return new Raw(v == null ? '' : String(v)); }

  function html(strings, ...values) {
    let out = strings[0];
    for (let i = 0; i < values.length; i++) out += esc(values[i]) + strings[i + 1];
    return new Raw(out);
  }

  return { html, raw, esc, Raw };
});
