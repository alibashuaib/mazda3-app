'use strict';
const test = require('node:test');
const assert = require('node:assert');
const session = require('../src/data/session.js');

const SENTINEL = 'SENTINEL-PRIVATE-9137';

function setup(env) {
  session.clear();
  session.setVehicles([{ id: 'v1', data: { car: { nickname: SENTINEL, odometer: 1 }, services: [], parts: [], history: [], spending: [], fuel: [], docs: [] } }], 'v1');
  const reports = [], notes = [];
  globalThis.errorLog = { report: r => reports.push(r) };
  session.configure(Object.assign({ notify: (...a) => notes.push(a), afterSave: () => {} }, env));
  return { reports, notes };
}
const done = () => { delete globalThis.errorLog; session.clear(); };

test('afterSave throw: one warn notify with no retry, one report, save still true', async () => {
  const { reports, notes } = setup({ saveVehicle: async () => ({ ok: true, data: {}, photoIds: [] }), afterSave: () => { throw new Error('enqueue boom'); } });
  try {
    assert.strictEqual(await session.save(), true);
    assert.strictEqual(notes.length, 1);
    assert.strictEqual(notes[0][1], 'warn');
    assert.strictEqual(notes[0].length, 2, 'no options (no Retry) for afterSave failure');
    assert.strictEqual(reports.length, 1);
    assert.match(reports[0].message, /^afterSave failed: /);
  } finally { done(); }
});

test('post-save bookkeeping throw: save still true, no Retry toast, one report', async () => {
  // photoIds without indexOf makes cacheNewPhotos throw after the write landed.
  const { reports, notes } = setup({ saveVehicle: async () => ({ ok: true, data: {}, photoIds: { length: 1 } }) });
  try {
    session.current().car.photoId = 'p1';
    assert.strictEqual(await session.save(), true);
    assert.strictEqual(notes.length, 0, 'no failure toast');
    assert.strictEqual(reports.length, 1);
    assert.match(reports[0].message, /^post-save bookkeeping failed: /);
  } finally { done(); }
});

test('res.ok false: one report, Retry notify whose closure re-runs save', async () => {
  let calls = 0;
  const { reports, notes } = setup({ saveVehicle: async () => { calls++; return { ok: false, error: new Error('nope') }; } });
  try {
    assert.strictEqual(await session.save(), false);
    assert.strictEqual(reports.length, 1);
    assert.strictEqual(reports[0].source, 'client');
    assert.match(reports[0].message, /^save failed: /);
    assert.strictEqual(notes[0][0], "Couldn't save. Your changes are still on screen.");
    assert.strictEqual(await notes[0][2].retry(), false);
    assert.strictEqual(calls, 2);
  } finally { done(); }
});

test('rejected save: exactly one report', async () => {
  const { reports } = setup({ saveVehicle: async () => { throw new Error('reject'); } });
  try {
    await session.save();
    assert.strictEqual(reports.length, 1);
  } finally { done(); }
});

test('success: no report; failure report has only source/message/stack and no record data', async () => {
  const ok = setup({ saveVehicle: async () => ({ ok: true, data: {}, photoIds: [] }) });
  try {
    await session.save();
    assert.strictEqual(ok.reports.length, 0);
  } finally { done(); }
  const bad = setup({ saveVehicle: async () => ({ ok: false, error: new Error('x') }) });
  try {
    await session.save();
    assert.deepStrictEqual(Object.keys(bad.reports[0]).sort(), ['message', 'source', 'stack']);
    assert.ok(!JSON.stringify(bad.reports[0]).includes(SENTINEL));
  } finally { done(); }
});
