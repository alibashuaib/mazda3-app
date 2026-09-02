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
