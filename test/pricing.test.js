'use strict';
const test = require('node:test');
const assert = require('node:assert');
const pricing = require('../src/data/pricing.js');

function fakeClient() {
  return { from: () => ({}) };
}

test.beforeEach(() => { pricing.reset(); });

test('available() is false with no client configured', () => {
  assert.strictEqual(pricing.available(), false);
});

test('available() is true once a client is configured', () => {
  pricing.configure({ client: fakeClient() });
  assert.strictEqual(pricing.available(), true);
});
