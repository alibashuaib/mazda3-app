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

/* ---------- absolute dates ----------
   Every absolute date in the app renders through fmtDate(). Before this, each
   call site wrote its own `toLocaleDateString('en', …)`, so Arabic showed
   English month names ("3 Mar 2027") no matter the UI language — the one seam
   left in an otherwise complete translation.

   Accepts either a Date or a 'YYYY-MM-DD' string. The string form is parsed at
   LOCAL midnight, which is what the `+ 'T00:00:00'` suffix every call site used
   to append by hand was for: a bare 'YYYY-MM-DD' is parsed as UTC, and west of
   Greenwich that renders as the previous day.

   `opts` is an Intl.DateTimeFormat options object, passed through unchanged —
   the granularity stays each call site's decision, so EN output is identical
   to what it produced before. */
function toLocalDate(d) {
  return d instanceof Date ? d : new Date(String(d) + 'T00:00:00');
}
/* Latin digits (nu-latn) even in Arabic: the app already writes "7,500 كم" via
   helpers.js's fmt(), and a date in Arabic-Indic digits beside a distance in
   Latin ones reads as two different number systems in one line. */
const AR_LOCALE = 'ar-u-ca-gregory-nu-latn';
function fmtDate(d, opts) {
  const date = toLocalDate(d);
  return date.toLocaleDateString(lang === 'ar' ? AR_LOCALE : 'en', opts);
}

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
