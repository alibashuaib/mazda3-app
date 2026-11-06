/* ============================================================
   Car photos — one map of cache-buster revisions per model.
   Dual-mode like bills.js. The revision strings are cache keys already
   in the field: never rename one. Bumping a photo = edit one line below.
   ============================================================ */
'use strict';

(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const api = factory();
  if (isNode) module.exports = api;
  else root.carPhotos = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  const CX = 'cx-family-fixes-211';
  const PHOTO_REV = {
    mazda3bp: 'mazda3bp-cleanup-200',
    mazda6: 'mazda6-wheel-logo-205',
    cx3: 'cx3-alignment-logos-207',
    mazda2: 'mazda2-paint-fixes-209',
    mazda3bm: 'mazda3bm-framing-213',
    cx30: CX, cx5ke: CX, cx5kf: CX, cx5gen3: CX, cx9tb: CX, cx9: CX,
    cx50: CX, cx60: CX, cx70: CX, cx80: CX, cx90: CX
  };

  // hasOwnProperty: a model id like 'constructor' must not hit Object.prototype.
  const photoUrl = (url, modelId) =>
    Object.prototype.hasOwnProperty.call(PHOTO_REV, modelId) ? `${url}?v=${PHOTO_REV[modelId]}` : url;

  return { photoUrl, PHOTO_REV };
});
