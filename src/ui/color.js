/* ============================================================
   Garage — colour math: hex/RGB/HSL conversions, the per-car accent
   derived from the vehicle's real Mazda paint (or a keyword-bucket
   fallback), and the theme-aware nudges (outline/pop/soft-link colour)
   built on top of it.
   Dual-mode, like storage.js — pulled out of chrome.js so this pure,
   catalog-dependent math is testable directly, without booting a DOM.
   Theme-dependent functions (accentForColor, paintOutline, paintPop,
   swatchFor, swatchStyle) take an explicit `theme` argument rather than
   reading document/window themselves, for the same reason: a caller
   under Node has neither. currentTheme() — which DOES read document/
   window — is what browser callers use to produce that argument; see
   chrome.js's and main.js's call sites.
   ============================================================ */
'use strict';
(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  // MAZDA_PAINTS is catalog.js's, not this file's. In the browser, these
  // functions are only ever CALLED after boot — never at parse time — so a
  // lazy global lookup at call time is enough there, same as before this
  // file existed. Node has no shared global to lazily resolve through, so
  // it requires catalog.js directly instead.
  const dep = isNode ? require('../data/catalog.js') : null;
  const api = factory(dep);
  if (isNode) module.exports = api;
  else Object.assign(root, api);
})(typeof self !== 'undefined' ? self : globalThis, function (dep) {

  function hexToRgb(h) {
    // An invalid hex (missing '#', wrong length, non-hex characters) must
    // not flow NaN silently into every caller downstream (hexToHsl above
    // all — NaN comparisons are always false, so its bucket logic would
    // just fall through unpredictably). Fail loudly instead. This is the
    // one runtime guard against bad hex input — callers with untrusted
    // names (realPaintHex, accentForColor) go through MAZDA_PAINTS or the
    // fixed CAR_ACCENTS table first, both of which are pinned valid by the
    // MAZDA_PAINTS-validity test in test/color.test.js, so this throwing is
    // a last-resort assertion, not the primary defense.
    if (typeof h !== 'string') throw new TypeError(`hexToRgb: expected a hex string, got ${typeof h}`);
    const clean = h.replace('#', '');
    if (!/^[0-9a-fA-F]{6}$/.test(clean)) throw new TypeError(`hexToRgb: not a 6-digit hex colour: ${JSON.stringify(h)}`);
    return [parseInt(clean.slice(0, 2), 16), parseInt(clean.slice(2, 4), 16), parseInt(clean.slice(4, 6), 16)];
  }
  function rgbToHex(r, g, b) { return '#' + [r, g, b].map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join(''); }
  function darkenHex(hex, f) { const [r, g, b] = hexToRgb(hex); return rgbToHex(r * f, g * f, b * f); }
  function lightenHex(hex, f) { const [r, g, b] = hexToRgb(hex); return rgbToHex(r + (255 - r) * f, g + (255 - g) * f, b + (255 - b) * f); }
  function hexToHsl(hex) {
    const [r8, g8, b8] = hexToRgb(hex);
    const r = r8 / 255, g = g8 / 255, b = b8 / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l };
    const d = max - min;
    const s = d / (1 - Math.abs(2 * l - 1));
    let h;
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
    if (h < 0) h += 360;
    return { h, s, l };
  }
  /* Shared normalization for a stored colour name: lowercased, with any
     trailing "(code ...)"/"(Code ...)" paint-code suffix stripped. Used on
     BOTH sides of the realPaintHex lookup below (the stored name and every
     MAZDA_PAINTS key), so a legacy value like "Soul Red (code 46V)" still
     matches a catalog key that carries no code suffix at all — and main.js
     uses this directly too (its colour-picker match against a model's
     colour list), so there is exactly one normalization, not two. */
  function normalizeColorName(name) {
    return String(name || '').toLowerCase().replace(/\s*\(code[^)]*\)\s*$/i, '').trim();
  }
  // Memoized by table identity, not rebuilt on every call — MAZDA_PAINTS
  // is a static table in both Node and the browser, so this is built once,
  // the first time realPaintHex actually runs (lazily, for the same
  // load-order reason the table lookup itself is lazy: chrome.js/color.js
  // load before catalog.js in index.html).
  let normalizedTableCache = null;
  let normalizedTableSource = null;
  /* Looked up live (not cached at parse time) in the browser — this file
     loads before catalog.js in index.html, so a top-level `MAZDA_PAINTS`
     snapshot taken here would always see it as undefined. Returns null
     (not a fallback) so callers can tell "no verified paint for this name"
     apart from "this is the colour". */
  function realPaintHex(name) {
    const table = dep ? dep.MAZDA_PAINTS : (typeof MAZDA_PAINTS === 'undefined' ? {} : MAZDA_PAINTS);
    if (!name) return null;
    if (normalizedTableSource !== table) {
      normalizedTableCache = {};
      for (const key of Object.keys(table)) normalizedTableCache[normalizeColorName(key)] = table[key];
      normalizedTableSource = table;
    }
    return normalizedTableCache[normalizeColorName(name)] || null;
  }
  /* Fallback only, for a custom/free-typed colour with no verified paint
     (accentForColor below uses the real hex whenever one exists). */
  const CAR_ACCENTS = [
    [['soul red', 'red'], '#d6203c', '#ff5c6e'],
    [['blue', 'crystal'], '#2f6df0', '#6fa8ff'],
    [['green', 'olive'], '#1f9d6b', '#4be0a6'],
    [['bronze', 'copper', 'brown', 'zircon'], '#b0702c', '#e0a860'],
    [['silver', 'sonic', 'aluminium', 'aluminum'], '#7c879a', '#a8b3c6'],
    [['white', 'snowflake', 'arctic', 'platinum', 'ceramic'], '#5f86b3', '#93b3d8'],
    // Black has no legible near-black accent of its own — this deliberately
    // reuses the red accent rather than a near-invisible near-black one, so
    // buttons/links/the health ring stay usable on a black car's theme.
    [['black', 'jet'], '#c0142c', '#ff5c6e'],
    [['gray', 'grey', 'machine', 'meteor', 'titanium', 'polymetal', 'graphite', 'gunmetal'], '#5b6b82', '#8ea1bd']
  ];
  /* data-theme, when set, wins outright — it is the user's explicit choice.
     Absent that (nothing has painted <html> yet, or this is running outside
     a DOM at all, e.g. under Node) fall back to the OS preference, the same
     query chrome.js's own systemTheme() runs. Kept self-contained — rather
     than calling chrome.js's systemTheme() — so this file has no load-order
     dependency on it. This is the ONLY function here that reads document/
     window; every other theme-dependent function below takes the result as
     an explicit `theme` argument instead, so it works the same under Node
     (no document at all) as it does in the browser. */
  function currentTheme() {
    const attr = typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme');
    if (attr) return attr;
    return (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
  }
  /* The app's accent (buttons, glows, the health ring, "Switch ›" links, …)
     is the car's real paint hue — not a generic bucket colour. A very light
     or very dark paint is nudged toward a usable mid-lightness first, since
     text/icons drawn directly on --accent need it to actually have contrast;
     the hue itself is never swapped out. */
  function accentForColor(name, theme) {
    const hex = realPaintHex(name);
    if (!hex) {
      // No verified paint (empty/custom colour text) — the old keyword
      // buckets are the best guess left.
      const c = (name || '').toLowerCase();
      const hit = CAR_ACCENTS.find(([keys]) => keys.some(k => c.includes(k)));
      return hit ? [hit[1], hit[2]] : ['#d6203c', '#ff5c6e'];
    }
    const { l } = hexToHsl(hex);
    const usable = l > 0.78 ? darkenHex(hex, 0.55) : l < 0.22 ? lightenHex(hex, 0.5) : hex;
    // --accent-soft is read as literal small link-text colour ("View ›",
    // "Switch ›", …) directly on the page background. A fixed "lighten by
    // X" only reads clearly on the dark theme's near-black background —
    // measured as low as 1.4:1 against the light theme's near-white one for
    // lighter paints. Darkening toward that background instead of always
    // lightening keeps every verified paint at >=4.5:1 (WCAG AA) against
    // --bg on whichever theme is live. Pinned by the contrast test in
    // test/color.test.js, checked against the stylesheet's actual --bg
    // hexes (#eef0f4 light, #0f1013 dark).
    const soft = theme === 'light' ? darkenHex(usable, 0.55) : lightenHex(usable, 0.45);
    return [usable, soft];
  }
  /* real-paint swatches for the colour dropdown — the *unmodified* hex,
     unlike accentForColor's usability-nudged version above. */
  function swatchFor(name, theme) { return realPaintHex(name) || accentForColor(name, theme)[0]; }
  /* A swatch/photo whose real paint is near-white on the light theme, or
     near-black on the dark theme, would blend straight into the surrounding
     surface. Returns the stroke colour to give it in that case, or null when
     the paint already reads clearly against the current theme. */
  function paintOutline(hex, theme) {
    const { l } = hexToHsl(hex);
    if (theme === 'light' && l > 0.72) return 'rgba(20,22,26,.55)';
    if (theme !== 'light' && l < 0.22) return 'rgba(255,255,255,.42)';
    return null;
  }
  /* Inline style for a `.sw` colour dot: the real paint, plus a contrasting
     stroke when that paint would otherwise blend into the current theme. */
  function swatchStyle(name, theme) {
    const hex = swatchFor(name, theme);
    const outline = paintOutline(hex, theme);
    return `background:${hex}` + (outline ? `;box-shadow:inset 0 0 0 1.5px ${outline}, 0 1px 2px rgba(0,0,0,.35)` : '');
  }
  /* The dashboard's studio car, not just a swatch dot: rather than a border,
     a near-white car on the light theme gets a heavier ground shadow to pop
     off the card, and a near-black car on the dark theme gets a soft light
     bloom behind it — { shadow } or { glow } (never both), or null when the
     paint already reads clearly against the current theme. */
  function paintPop(hex, theme) {
    const { l } = hexToHsl(hex);
    if (theme === 'light' && l > 0.72) return { shadow: 'drop-shadow(0 18px 16px rgba(15,17,20,.4))' };
    if (theme !== 'light' && l < 0.22) return { glow: 'radial-gradient(ellipse 62% 55% at 50% 46%, rgba(255,255,255,.3), transparent 68%)' };
    return null;
  }

  return {
    hexToRgb, rgbToHex, darkenHex, lightenHex, hexToHsl,
    normalizeColorName, realPaintHex, CAR_ACCENTS, currentTheme,
    accentForColor, swatchFor, paintOutline, swatchStyle, paintPop
  };
});
