/* ============================================================
   Garage — chrome: topbar, theme, accent colour, and the small shared
   UI builders every page reuses.
   Plain script, like app.js — not require()d directly by any test, only
   exercised through the boot harness.
   ============================================================ */
'use strict';

/* ---------- car profile / topbar ---------- */
function carTitle() { return session.current().car.nickname || `${session.current().car.make} ${session.current().car.model}`.trim() || 'My car'; }
function carInitials() {
  const c = session.current().car;
  const a = (c.make || '')[0] || '';
  const b = (c.model || '')[0] || '';
  return (a + b).toUpperCase() || '🚗';
}
function renderTopbar() {
  const c = session.current().car;
  $('#carTitle').textContent = carTitle();
  $('#carSub').textContent = [c.year, c.engine, c.transmission, c.color].filter(Boolean).join(' · ');
  const badge = $('#carBadge');
  badge.classList.remove('has-photo');
  badge.textContent = carInitials();
  // index.html ships a fixed "2016 Mazda 3" title; this is a multi-vehicle
  // garage, so the tab should name whichever vehicle is actually active.
  document.title = 'Garage — ' + carTitle();
}

/* ============================================================
   SHARED UI BITS
   ============================================================ */
function sectionTitle(title, linkTxt, onLink, badge) {
  const s = el('div', 'section-title');
  const left = el('div', 'section-title-left');
  left.appendChild(el('h2', null, html`${t(title)}`));
  if (badge) left.appendChild(el('span', 'section-title-badge', html`${badge}`));
  s.appendChild(left);
  if (linkTxt && onLink) { const b = el('button', 'link', html`${t(linkTxt)}`); b.onclick = onLink; s.appendChild(b); }
  return s;
}
function pageIntro(title, sub) {
  const d = el('div');
  d.style.margin = '6px 4px 8px';
  d.innerHTML = html`<h2 style="font-size:22px;font-weight:800;letter-spacing:-.4px">${t(title)}</h2><p class="muted" style="font-size:13px;margin-top:4px;line-height:1.5">${t(sub)}</p>`;
  return d;
}
function emptyState(emoji, txt) {
  const e = el('div', 'empty');
  e.innerHTML = html`<div class="e-emoji">${emoji}</div><p>${t(txt)}</p>`;
  return e;
}
function iconSvg(name) {
  const paths = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    check: '<path d="M20 6 9 17l-5-5"/>'
  };
  // paths is a hardcoded constant map of SVG path data, never user input.
  // Object.prototype.hasOwnProperty guards against a name like 'constructor'
  // resolving to an inherited Object.prototype value that raw() would then
  // mark as trusted markup.
  const d = Object.prototype.hasOwnProperty.call(paths, name) ? paths[name] : '';
  return html`<svg viewBox="0 0 24 24">${raw(d)}</svg>`;
}
function toast(msg, kind) {
  const host = $('#toastHost');
  const node = el('div', 'toast', html`<span class="dot" style="background:${kind === 'warn' ? 'var(--warn)' : 'var(--ok)'}"></span>${t(msg)}`);
  host.appendChild(node);
  setTimeout(() => { node.style.opacity = '0'; node.style.transform = 'translateY(10px)'; node.style.transition = '.3s'; setTimeout(() => node.remove(), 300); }, 2200);
}

/* ---------- theme ---------- */
function systemTheme() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  $('meta[name=theme-color]').setAttribute('content', t === 'light' ? '#eef0f4' : '#0f1013');
}
/* Stored preference: 'light' | 'dark', or absent meaning "follow the device". */
function themePref() {
  try { return localStorage.getItem('garage.theme') || 'system'; } catch (e) { return 'system'; }
}
function setThemePref(p) {
  try {
    if (p === 'system') localStorage.removeItem('garage.theme');
    else localStorage.setItem('garage.theme', p);
  } catch (e) {}
  applyTheme(p === 'system' ? systemTheme() : p);
}

/* ---------- accent follows the car colour ---------- */
/* Fallback only, for a custom/free-typed colour with no verified paint
   (accentForColor below uses the real hex whenever one exists). */
const CAR_ACCENTS = [
  [['soul red', 'red'], '#d6203c', '#ff5c6e'],
  [['blue', 'crystal'], '#2f6df0', '#6fa8ff'],
  [['green', 'olive'], '#1f9d6b', '#4be0a6'],
  [['bronze', 'copper', 'brown', 'zircon'], '#b0702c', '#e0a860'],
  [['silver', 'sonic', 'aluminium', 'aluminum'], '#7c879a', '#a8b3c6'],
  [['white', 'snowflake', 'arctic', 'platinum', 'ceramic'], '#5f86b3', '#93b3d8'],
  [['black', 'jet'], '#c0142c', '#ff5c6e'],
  [['gray', 'grey', 'machine', 'meteor', 'titanium', 'polymetal', 'graphite', 'gunmetal'], '#5b6b82', '#8ea1bd']
];
function hexToRgb(h) { h = h.replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
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
/* Real per-car paint doesn't come with a distinct studio photo for every
   model — most vehicles ship a single reference image. A CSS filter bucket
   picked from the actual verified paint hex (not the colour's name text)
   is how the "same car, different colour" look reaches every model. */
function paintFilterClass(hex) {
  const { h, s, l } = hexToHsl(hex);
  if (l > 0.82) return 'paint-white';
  if (l < 0.15) return 'paint-black';
  if (s < 0.13) return l > 0.55 ? 'paint-silver' : 'paint-gray';
  if (h < 15 || h >= 350) return 'paint-red';
  if (h < 55) return s > 0.35 ? 'paint-copper' : 'paint-titanium';
  if (h < 170) return 'paint-green';
  if (h < 265) return 'paint-blue';
  return 'paint-gray';
}
/* Looked up live (not cached at parse time) because chrome.js loads before
   catalog.js in index.html — a top-level `MAZDA_PAINTS` snapshot here would
   always see it as undefined. Returns null (not a fallback) so callers can
   tell "no verified paint for this name" apart from "this is the colour". */
function realPaintHex(name) {
  const table = typeof MAZDA_PAINTS === 'undefined' ? {} : MAZDA_PAINTS;
  return table[name] || null;
}
/* The app's accent (buttons, glows, the health ring, "Switch ›" links, …)
   is the car's real paint hue — not a generic bucket colour. A very light
   or very dark paint is nudged toward a usable mid-lightness first, since
   text/icons drawn directly on --accent need it to actually have contrast;
   the hue itself is never swapped out. */
function accentForColor(name) {
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
  // "Switch ›", …) directly on a card surface. A fixed "lighten by X" only
  // reads clearly on the dark theme's near-black surface — measured as low
  // as 1.4:1 against the light theme's near-white one for lighter paints.
  // Darkening toward that surface instead of always lightening keeps every
  // verified paint at >=4.5:1 (WCAG AA) on whichever theme is live.
  const theme = (typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme')) || (typeof systemTheme === 'function' ? systemTheme() : 'dark');
  const soft = theme === 'light' ? darkenHex(usable, 0.55) : lightenHex(usable, 0.45);
  return [usable, soft];
}
/* real-paint swatches for the colour dropdown — the *unmodified* hex,
   unlike accentForColor's usability-nudged version above. */
function swatchFor(name) { return realPaintHex(name) || accentForColor(name)[0]; }
function applyAccent() {
  const [acc, soft] = accentForColor(session.current().car && session.current().car.color);
  const [r, g, b] = hexToRgb(acc);
  const s = document.documentElement.style;
  s.setProperty('--accent', acc);
  s.setProperty('--accent-soft', soft);
  s.setProperty('--accent-2', darkenHex(acc, 0.72));
  s.setProperty('--accent-glow', `rgba(${r}, ${g}, ${b}, .35)`);
}
/* A swatch/photo whose real paint is near-white on the light theme, or
   near-black on the dark theme, would blend straight into the surrounding
   surface. Returns the stroke colour to give it in that case, or null when
   the paint already reads clearly against the current theme. */
function paintOutline(hex) {
  const { l } = hexToHsl(hex);
  const theme = (typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme')) || (typeof systemTheme === 'function' ? systemTheme() : 'dark');
  if (theme === 'light' && l > 0.72) return 'rgba(20,22,26,.55)';
  if (theme !== 'light' && l < 0.22) return 'rgba(255,255,255,.42)';
  return null;
}
/* Inline style for a `.sw` colour dot: the real paint, plus a contrasting
   stroke when that paint would otherwise blend into the current theme. */
function swatchStyle(name) {
  const hex = swatchFor(name);
  const outline = paintOutline(hex);
  return `background:${hex}` + (outline ? `;box-shadow:inset 0 0 0 1.5px ${outline}, 0 1px 2px rgba(0,0,0,.35)` : '');
}
/* The dashboard's studio car, not just a swatch dot: rather than a border,
   a near-white car on the light theme gets a heavier ground shadow to pop
   off the card, and a near-black car on the dark theme gets a soft light
   bloom behind it — { shadow } or { glow } (never both), or null when the
   paint already reads clearly against the current theme. */
function paintPop(hex) {
  const { l } = hexToHsl(hex);
  const theme = (typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme')) || (typeof systemTheme === 'function' ? systemTheme() : 'dark');
  if (theme === 'light' && l > 0.72) return { shadow: 'drop-shadow(0 18px 16px rgba(15,17,20,.4))' };
  if (theme !== 'light' && l < 0.22) return { glow: 'radial-gradient(ellipse 62% 55% at 50% 46%, rgba(255,255,255,.3), transparent 68%)' };
  return null;
}
