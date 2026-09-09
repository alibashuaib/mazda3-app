'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { bootApp } = require('./helpers/boot.js');

/* fmtDate lives in lang.js as a top-level function, alongside the `lang`
   binding it reads — a global LEXICAL binding, not a property of globalThis,
   so it is only reachable through evalInApp (see boot.js's note). */
async function withBoot(fn) {
  const ctx = await bootApp();
  try { await fn(ctx); } finally { ctx.cleanup(); }
}

/* The call sites pass Intl options through unchanged, so these are the exact
   granularities the app actually renders. */
const DMY = "{ day: 'numeric', month: 'short', year: 'numeric' }";

test('English output is byte-identical to the toLocaleDateString it replaced', () => withBoot(async ({ evalInApp }) => {
  const viaFmt = evalInApp(`fmtDate('2027-03-03', ${DMY})`);
  const direct = new Date('2027-03-03T00:00:00').toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' });
  assert.strictEqual(viaFmt, direct);
}));

test('a YYYY-MM-DD string is parsed at local midnight, not UTC', () => withBoot(async ({ evalInApp }) => {
  /* A bare 'YYYY-MM-DD' parses as UTC, so anywhere west of Greenwich it
     renders as the previous day. Every call site used to append 'T00:00:00'
     by hand for this; fmtDate now owns it, and dropping it would shift dates
     by one day for a whole hemisphere without failing anything else. */
  assert.strictEqual(evalInApp(`fmtDate('2027-03-03', { day: 'numeric' })`), '3');
  assert.strictEqual(evalInApp(`fmtDate('2027-01-01', { day: 'numeric', month: 'numeric' })`),
    new Date('2027-01-01T00:00:00').toLocaleDateString('en', { day: 'numeric', month: 'numeric' }));
}));

test('a Date instance is accepted as-is', () => withBoot(async ({ evalInApp }) => {
  assert.strictEqual(
    evalInApp(`fmtDate(new Date(2027, 2, 3), ${DMY})`),
    evalInApp(`fmtDate('2027-03-03', ${DMY})`));
}));

test('Arabic renders Arabic month names, never English ones', () => withBoot(async ({ evalInApp }) => {
  evalInApp("lang = 'ar'");
  const out = evalInApp(`fmtDate('2027-03-03', ${DMY})`);
  assert.match(out, /[؀-ۿ]/, `expected Arabic script in ${JSON.stringify(out)}`);
  assert.doesNotMatch(out, /Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/,
    `English month name leaked into Arabic output: ${JSON.stringify(out)}`);
}));

test('Arabic keeps Latin digits, matching the app’s "7,500 km" numerals', () => withBoot(async ({ evalInApp }) => {
  evalInApp("lang = 'ar'");
  const out = evalInApp(`fmtDate('2027-03-03', ${DMY})`);
  assert.match(out, /2027/, `expected Latin digits in ${JSON.stringify(out)}`);
  assert.doesNotMatch(out, /[٠-٩۰-۹]/,
    `Arabic-Indic digits leaked into ${JSON.stringify(out)}`);
}));

test('switching language switches date language, with no reload', () => withBoot(async ({ evalInApp }) => {
  const en = evalInApp(`fmtDate('2027-03-03', ${DMY})`);
  evalInApp("lang = 'ar'");
  const ar = evalInApp(`fmtDate('2027-03-03', ${DMY})`);
  evalInApp("lang = 'en'");
  assert.notStrictEqual(en, ar);
  assert.strictEqual(evalInApp(`fmtDate('2027-03-03', ${DMY})`), en);
}));

/* ---------- calendar system (Arabic only) ---------- */

/* Bidi isolates are invisible but real characters; strip them before matching
   on content so a failure reports the date, not a wall of escapes. */
const unwrap = s => s.replace(/[⁦-⁩]/g, '');

function arWith(evalInApp, cal) {
  evalInApp("lang = 'ar'");
  evalInApp(`calendar = ${JSON.stringify(cal)}`);
  return unwrap(evalInApp(`fmtDate('2027-03-03', ${DMY})`));
}

test('the calendar pref defaults to gregory and rejects junk', () => withBoot(async ({ evalInApp }) => {
  assert.strictEqual(evalInApp('readCalendarPref()'), 'gregory');
  evalInApp("localStorage.setItem('garage.calendar', 'julian')");
  assert.strictEqual(evalInApp('readCalendarPref()'), 'gregory');
  evalInApp("localStorage.setItem('garage.calendar', 'islamic')");
  assert.strictEqual(evalInApp('readCalendarPref()'), 'islamic');
  evalInApp("localStorage.removeItem('garage.calendar')");
}));

test('Hijri resolves to a real islamic calendar, never silently to gregory', () => withBoot(async ({ evalInApp }) => {
  /* An unsupported calendar key resolves back to 'gregory' rather than
     throwing, which would render "Hijri" dates that are quietly Gregorian. */
  const resolved = evalInApp('hijriCalendar()');
  assert.match(resolved, /^islamic/, `hijriCalendar() picked ${JSON.stringify(resolved)}`);
}));

test('Hijri renders a Hijri year with its era marker', () => withBoot(async ({ evalInApp }) => {
  const out = arWith(evalInApp, 'islamic');
  assert.match(out, /1448/, `expected a Hijri year in ${JSON.stringify(out)}`);
  assert.doesNotMatch(out, /2027/, `Gregorian year leaked into Hijri output: ${JSON.stringify(out)}`);
  assert.match(out, /هـ/, `Hijri date is not self-identifying: ${JSON.stringify(out)}`);
}));

test('a day/month-only Hijri date gets no stray era marker', () => withBoot(async ({ evalInApp }) => {
  evalInApp("lang = 'ar'"); evalInApp("calendar = 'islamic'");
  const out = unwrap(evalInApp(`fmtDate('2027-03-03', { day: 'numeric', month: 'short' })`));
  assert.doesNotMatch(out, /هـ/, `era marker with no year to qualify: ${JSON.stringify(out)}`);
}));

test('Both shows Gregorian first, then Hijri', () => withBoot(async ({ evalInApp }) => {
  const both = arWith(evalInApp, 'both');
  assert.match(both, /2027/);
  assert.match(both, /1448/);
  assert.ok(both.indexOf('2027') < both.indexOf('1448'), `Hijri came first in ${JSON.stringify(both)}`);
  assert.match(both, / · /);
}));

test('every Arabic calendar mode isolates its dates for bidi', () => withBoot(async ({ evalInApp }) => {
  for (const cal of ['gregory', 'islamic', 'both']) {
    evalInApp("lang = 'ar'"); evalInApp(`calendar = ${JSON.stringify(cal)}`);
    const raw = evalInApp(`fmtDate('2027-03-03', ${DMY})`);
    assert.match(raw, /⁨.*⁩/, `${cal}: no bidi isolation`);
  }
  /* Both is two separate dates joined by a separator — each needs its own
     isolate, or the digits either side of the "·" reorder against each other. */
  evalInApp("calendar = 'both'");
  const both = evalInApp(`fmtDate('2027-03-03', ${DMY})`);
  assert.strictEqual((both.match(/⁨/g) || []).length, 2, `both: ${JSON.stringify(both)}`);
}));

test('English ignores the calendar pref entirely', () => withBoot(async ({ evalInApp }) => {
  evalInApp("lang = 'en'");
  const plain = evalInApp(`fmtDate('2027-03-03', ${DMY})`);
  for (const cal of ['islamic', 'both']) {
    evalInApp(`calendar = ${JSON.stringify(cal)}`);
    assert.strictEqual(evalInApp(`fmtDate('2027-03-03', ${DMY})`), plain,
      `calendar=${cal} changed English output`);
  }
  /* No isolates in English either — nothing there is bidirectional. */
  assert.doesNotMatch(plain, /[⁦-⁩]/);
}));

test('no Arabic-Indic digits in any calendar mode', () => withBoot(async ({ evalInApp }) => {
  for (const cal of ['gregory', 'islamic', 'both']) {
    const out = arWith(evalInApp, cal);
    assert.doesNotMatch(out, /[٠-٩۰-۹]/, `${cal}: ${JSON.stringify(out)}`);
  }
}));

test('no English month names in Arabic, in any calendar mode', () => withBoot(async ({ evalInApp }) => {
  for (const cal of ['gregory', 'islamic', 'both']) {
    const out = arWith(evalInApp, cal);
    assert.doesNotMatch(out, /Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/, `${cal}: ${JSON.stringify(out)}`);
  }
}));

/* ---------- the settings control ---------- */

const calGroup = doc => doc.querySelector('#modalCard [role="radiogroup"][aria-label^="Calendar"]');
const svGroup = doc => doc.querySelector('#modalCard [role="radiogroup"][aria-label^="Maintenance schedule"]');
const rowOf = group => group.previousSibling.parentNode;   // the wrapper holding label + seg

// Language moved to the account menu (account-menu.test.js), so the calendar
// control's visibility now just follows the applied `lang` directly — there is
// no longer a language segment in this dialog to tap and check against.
test('the calendar control is hidden in English and shown in Arabic', () => withBoot(async ({ document, api, evalInApp }) => {
  api.openSettings();
  assert.ok(calGroup(document), 'the calendar control is absent from the dialog entirely');
  assert.strictEqual(rowOf(calGroup(document)).hidden, true, 'calendar control visible in an English UI');
  api.closeModal();

  evalInApp("lang = 'ar'");
  api.openSettings();
  assert.strictEqual(rowOf(calGroup(document)).hidden, false, 'calendar control hidden in an Arabic UI');
}));

test('picking a calendar applies and persists on tap, with no Save', () => withBoot(async ({ document, api, evalInApp }) => {
  evalInApp("lang = 'ar'");
  api.openSettings();
  const hijri = Array.from(calGroup(document).children)[1];
  hijri.onclick();

  assert.strictEqual(evalInApp('calendar'), 'islamic', 'the tap did not apply');
  assert.strictEqual(evalInApp("localStorage.getItem('garage.calendar')"), 'islamic', 'the tap did not persist');
  assert.strictEqual(hijri.getAttribute('aria-checked'), 'true');
  evalInApp("localStorage.removeItem('garage.calendar')");
}));

test('both segments are announced as one control with a live selection', () => withBoot(async ({ document, api, evalInApp }) => {
  evalInApp("lang = 'ar'");
  api.openSettings();
  for (const group of [svGroup(document), calGroup(document)]) {
    const buttons = Array.from(group.children);
    assert.ok(buttons.length >= 2, 'a segment with nothing to choose between');
    assert.ok(buttons.every(b => b.getAttribute('role') === 'radio'), 'a segment button is not a radio');
    /* Exactly one selected — `.on` is a class, and a class says nothing to
       assistive tech, so aria-checked is what actually reports the state. */
    assert.strictEqual(buttons.filter(b => b.getAttribute('aria-checked') === 'true').length, 1,
      `${group.getAttribute('aria-label')}: selection is not exactly one`);
    const other = buttons.find(b => b.getAttribute('aria-checked') === 'false');
    other.onclick();
    assert.strictEqual(other.getAttribute('aria-checked'), 'true', 'aria-checked did not follow the tap');
    assert.strictEqual(buttons.filter(b => b.getAttribute('aria-checked') === 'true').length, 1,
      'two options reported as selected at once');
  }
  evalInApp("localStorage.removeItem('garage.calendar')");
}));

test('applyCalendar persists, and an invalid value lands on gregory', () => withBoot(async ({ evalInApp }) => {
  evalInApp("applyCalendar('islamic')");
  assert.strictEqual(evalInApp('calendar'), 'islamic');
  assert.strictEqual(evalInApp("localStorage.getItem('garage.calendar')"), 'islamic');
  evalInApp("applyCalendar('julian')");
  assert.strictEqual(evalInApp('calendar'), 'gregory');
  evalInApp("localStorage.removeItem('garage.calendar')");
}));
