'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const color = require('../src/ui/color.js');
const { MAZDA_PAINTS } = require('../src/data/catalog.js');

// WCAG 2.x relative luminance / contrast ratio, per the spec formula.
function channel(c) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
function relativeLuminance(hex) {
  const [r, g, b] = color.hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
function contrastRatio(hexA, hexB) {
  const la = relativeLuminance(hexA), lb = relativeLuminance(hexB);
  const lighter = Math.max(la, lb), darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

test('MAZDA_PAINTS: every value is a valid #rrggbb hex', () => {
  for (const [name, hex] of Object.entries(MAZDA_PAINTS)) {
    assert.match(hex, /^#[0-9a-fA-F]{6}$/, `${name}: ${JSON.stringify(hex)} is not a #rrggbb hex`);
    assert.doesNotThrow(() => color.hexToRgb(hex), `${name}: hexToRgb rejected ${hex}`);
  }
});

/* styles.css's --bg is #eef0f4 on the light theme and #0f1013 on the dark
   theme (see :root and :root[data-theme="light"]) — this is the page
   background --accent-soft's small link text ("View ›", "Switch ›", …)
   actually sits on, so it's what this test checks against, not an
   arbitrary guess. */
test('accentForColor: every verified Mazda paint\'s soft colour is >=4.5:1 against the page background, both themes', () => {
  const LIGHT_BG = '#eef0f4';
  const DARK_BG = '#0f1013';
  const failures = [];
  for (const name of Object.keys(MAZDA_PAINTS)) {
    const softLight = color.accentForColor(name, 'light')[1];
    const softDark = color.accentForColor(name, 'dark')[1];
    const cLight = contrastRatio(softLight, LIGHT_BG);
    const cDark = contrastRatio(softDark, DARK_BG);
    if (cLight < 4.5) failures.push(`${name}: light ${softLight} vs ${LIGHT_BG} = ${cLight.toFixed(2)}:1`);
    if (cDark < 4.5) failures.push(`${name}: dark ${softDark} vs ${DARK_BG} = ${cDark.toFixed(2)}:1`);
  }
  assert.deepStrictEqual(failures, [], `paints failing WCAG AA (4.5:1):\n${failures.join('\n')}`);
});

test('realPaintHex: matches a normalized name, stripping a "(code ...)" suffix, on either side', () => {
  const [fullName, hex] = Object.entries(MAZDA_PAINTS).find(([n]) => /\(code/i.test(n));
  const legacy = fullName.replace(/\s*\(code[^)]*\)\s*$/i, '');
  assert.strictEqual(color.realPaintHex(legacy), hex);
  assert.strictEqual(color.realPaintHex(legacy.toUpperCase()), hex);
  assert.strictEqual(color.realPaintHex(fullName.toUpperCase()), hex);
  assert.strictEqual(color.realPaintHex('not a real paint'), null);
  assert.strictEqual(color.realPaintHex(''), null);
  assert.strictEqual(color.realPaintHex(undefined), null);
});

test('normalizeColorName: lowercases and strips a trailing "(code ...)" suffix', () => {
  assert.strictEqual(color.normalizeColorName('Soul Red Crystal Metallic (Code 46V)'), 'soul red crystal metallic');
  assert.strictEqual(color.normalizeColorName('  Jet Black Mica  '), 'jet black mica');
  assert.strictEqual(color.normalizeColorName(undefined), '');
});

test('hexToRgb: rejects invalid input rather than flowing NaN through', () => {
  assert.throws(() => color.hexToRgb('not-a-hex'));
  assert.throws(() => color.hexToRgb('#fff'));
  assert.throws(() => color.hexToRgb(undefined));
  assert.deepStrictEqual(color.hexToRgb('#ff0000'), [255, 0, 0]);
});
