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

/* Calendar system, Arabic only — English is always Gregorian. A global lexical
   `let` hydrated at boot, exactly like `lang` above, so the render path reads a
   variable instead of hitting localStorage once per date on a long list. */
let calendar = 'gregory';
const CALENDARS = ['gregory', 'islamic', 'both'];
/* Anything unrecognised — absent, corrupt, or from a future version — reads as
   'gregory'. No migration: the absent case and the default are the same value. */
function readCalendarPref() {
  try {
    const v = localStorage.getItem('garage.calendar');
    return CALENDARS.indexOf(v) >= 0 ? v : 'gregory';
  } catch (e) { return 'gregory'; }
}
function applyCalendar(c) {
  calendar = CALENDARS.indexOf(c) >= 0 ? c : 'gregory';
  try { localStorage.setItem('garage.calendar', calendar); } catch (e) {}
  go(current);            // dates live in the view; the topbar carries none
}

/* Umm al-Qura is Saudi Arabia's civil calendar and the right default for this
   app's users, but not every ICU build ships it — an unsupported calendar key
   silently resolves back to 'gregory', which would render "Hijri" dates that
   are quietly Gregorian. Probe once and cache: this runs on every date. */
let hijriCal = null;
function hijriCalendar() {
  if (hijriCal) return hijriCal;
  for (const c of ['islamic-umalqura', 'islamic', 'islamic-civil']) {
    try {
      if (Intl.DateTimeFormat('ar-u-ca-' + c).resolvedOptions().calendar.indexOf('islamic') === 0) {
        return (hijriCal = c);
      }
    } catch (e) {}
  }
  return (hijriCal = 'islamic');
}

/* Unicode bidi isolation — the text-level equivalent of <bdi>. It survives the
   html`` escaping every call site goes through, which markup would not: a
   literal <bdi> would arrive on screen as visible tag text, and reaching for
   raw() to avoid that would widen the escaping guard test's blast radius for
   a purely typographic concern. Without isolation the Latin digits at the
   seam of "3 مارس 2027 · 24 رمضان 1448 هـ" reorder against each other. */
const FSI = '⁨', PDI = '⁩';
function isolate(s) { return FSI + s + PDI; }

function fmtHijri(date, opts) {
  /* ICU appends the era marker ("هـ") whenever a year is shown, which is what
     makes a Hijri date self-identifying next to a Gregorian one. Asking for it
     explicitly guarantees it on builds that would otherwise drop it — but only
     alongside a year, since a bare day/month has no year to disambiguate and
     would just collect a stray marker. */
  const o = opts && opts.year ? Object.assign({}, opts, { era: 'short' }) : opts;
  return date.toLocaleDateString('ar-u-ca-' + hijriCalendar() + '-nu-latn', o);
}

function fmtDate(d, opts) {
  const date = toLocalDate(d);
  if (lang !== 'ar') return date.toLocaleDateString('en', opts);
  const greg = () => isolate(date.toLocaleDateString(AR_LOCALE, opts));
  const hijri = () => isolate(fmtHijri(date, opts));
  if (calendar === 'islamic') return hijri();
  if (calendar === 'both') return greg() + ' · ' + hijri();
  return greg();
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
