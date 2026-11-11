'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { bootApp } = require('./helpers/boot');
const { CAR_MODELS, partsForModel, skyactivServices, engineInfo } = require('../src/data/catalog.js');

/* Every part and service name the catalogue can build must read in Arabic.
   t() falls back to English silently, so a new part name (or a size-stamped
   one like "Tires (205/60R16, each)") shows English in the Arabic UI. */
test('every catalogue part and service name and note has an Arabic translation', async () => {
  const names = new Set();
  for (const m of CAR_MODELS) for (const [eng, oil] of m.engines) {
    for (const p of partsForModel(m.id, eng)) {
      names.add(p.name).add(p.cat);
      for (const o of p.options || []) if (o.note) names.add(o.note);   // parts.js renders t(o.note)
    }
    for (const s of skyactivServices(oil, engineInfo(m.id, eng))) {
      names.add(s.name).add(s.cat);
      if (s.note) names.add(s.note);                                    // maintenance.js renders t(s.note)
    }
  }
  const ctx = await bootApp();
  try {
    ctx.evalInApp("lang = 'ar'");
    const missing = [...names].filter(n => ctx.evalInApp(`t(${JSON.stringify(n)})`) === n);
    assert.deepStrictEqual(missing, []);
  } finally { ctx.cleanup(); }
});
