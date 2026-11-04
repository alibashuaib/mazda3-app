'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { photoUrl, PHOTO_REV } = require('../src/data/car-photos.js');

const U = 'assets/x.webp';
// Literal pre-change outputs of the old studioCarImage freshAsset ternary.
const TABLE = {
  mazda3bp: 'mazda3bp-cleanup-200', mazda6: 'mazda6-wheel-logo-205',
  cx3: 'cx3-alignment-logos-207', mazda2: 'mazda2-paint-fixes-209',
  mazda3bm: 'mazda3bm-framing-213',
  cx30: 'cx-family-fixes-211', cx5ke: 'cx-family-fixes-211', cx5kf: 'cx-family-fixes-211',
  cx5gen3: 'cx-family-fixes-211', cx9tb: 'cx-family-fixes-211', cx9: 'cx-family-fixes-211',
  cx50: 'cx-family-fixes-211', cx60: 'cx-family-fixes-211', cx70: 'cx-family-fixes-211',
  cx80: 'cx-family-fixes-211', cx90: 'cx-family-fixes-211'
};

test('photoUrl matches the pre-change cache-buster for every model', () => {
  for (const [id, rev] of Object.entries(TABLE)) {
    assert.equal(photoUrl(U, id), `${U}?v=${rev}`, id);
    assert.equal(photoUrl('assets/mazda3-soul-red.webp', id), `assets/mazda3-soul-red.webp?v=${rev}`, id);
    assert.ok(PHOTO_REV[id], id);
  }
  assert.equal(Object.keys(PHOTO_REV).length, Object.keys(TABLE).length);
});

test('photoUrl leaves unknown models unchanged', () => {
  assert.equal(photoUrl(U, 'mx5'), U);
  assert.equal(photoUrl(U, undefined), U);
  assert.equal(photoUrl(U, 'constructor'), U);
});
