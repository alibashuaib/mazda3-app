/* ============================================================
   Garage — language (Arabic / English + RTL).
   Plain script, like the rest of app.js — not require()d directly by any
   test, only exercised through the boot harness, so no dual-mode wrapper.
   `lang` is a top-level `let`: a global LEXICAL binding, reachable by name
   from every script loaded after this one, but not a globalThis property
   (see test/helpers/boot.js's note on `evalInApp`).
   ============================================================ */
'use strict';

let lang = 'en';
function t(s) { return (lang === 'ar' && s != null && AR[s]) ? AR[s] : s; }
const relDate = d => {
  const days = Math.round((d - today()) / 86400000);
  const ar = lang === 'ar';
  if (days === 0) return t('today');
  if (days < 0) return ar ? `قبل ${Math.abs(days)} يوم` : `${Math.abs(days)}d ago`;
  if (days < 45) return ar ? `خلال ${days} يوم` : `in ${days}d`;
  const mo = Math.round(days / 30);
  return ar ? `خلال ${mo} شهر` : `in ${mo} mo`;
};

const NAV_KEYS = { dashboard: 'Dashboard', maintenance: 'Maintenance', parts: 'Parts', fuel: 'Fuel', budget: 'Budget', reports: 'Reports' };
function applyNavLabels() {
  document.querySelectorAll('.tab').forEach(tab => {
    const span = tab.querySelector('span'); const k = NAV_KEYS[tab.dataset.route];
    if (span && k) span.textContent = t(k);
  });
}
function applyLang(l) {
  lang = l;
  const root = document.documentElement;
  root.setAttribute('lang', l);
  root.setAttribute('dir', l === 'ar' ? 'rtl' : 'ltr');
  try { localStorage.setItem('garage.lang', l); } catch (e) {}
  applyNavLabels();
  renderTopbar();
  go(current);
}
