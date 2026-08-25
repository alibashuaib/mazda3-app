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
function accentForColor(name) {
  const c = (name || '').toLowerCase();
  const hit = CAR_ACCENTS.find(([keys]) => keys.some(k => c.includes(k)));
  return hit ? [hit[1], hit[2]] : ['#d6203c', '#ff5c6e'];
}

/* real-paint swatches for the colour dropdown */
const COLOR_SWATCHES = typeof MAZDA_PAINTS === 'undefined' ? {} : MAZDA_PAINTS;
function swatchFor(name) { return COLOR_SWATCHES[name] || accentForColor(name)[0]; }
function applyAccent() {
  const [acc, soft] = accentForColor(session.current().car && session.current().car.color);
  const [r, g, b] = hexToRgb(acc);
  const s = document.documentElement.style;
  s.setProperty('--accent', acc);
  s.setProperty('--accent-soft', soft);
  s.setProperty('--accent-2', darkenHex(acc, 0.72));
  s.setProperty('--accent-glow', `rgba(${r}, ${g}, ${b}, .35)`);
}
