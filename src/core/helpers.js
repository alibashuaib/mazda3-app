/* ============================================================
   Garage — primitives shared by every module.
   Dual-mode, like storage.js: a plain <script> in the browser and
   require()d by the Node tests. Lowest layer — depends on nothing.
   ============================================================ */
'use strict';
(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const api = factory();
  if (isNode) module.exports = api;
  else Object.assign(root, api);
})(typeof self !== 'undefined' ? self : globalThis, function () {

  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const uid = () => Math.random().toString(36).slice(2, 9);
  const fmt = n => Number(n).toLocaleString('en-US');
  const sar = n => Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const parseDate = s => new Date(s + 'T00:00:00');
  const monthsBetween = (a, b) => (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) + (b.getDate() - a.getDate()) / 30;
  const addMonths = (d, m) => { const x = new Date(d); x.setMonth(x.getMonth() + Math.round(m)); return x; };

  return { $, el, uid, fmt, sar, clamp, parseDate, monthsBetween, addMonths };
});
