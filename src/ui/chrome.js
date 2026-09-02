/* ============================================================
   Garage — chrome: topbar, theme, accent colour, and the small shared
   UI builders every page reuses.
   Plain script, like app.js — not require()d directly by any test, only
   exercised through the boot harness. The colour math itself (hex/HSL
   conversions, accent derivation, theme nudges) lives in color.js, which
   IS require()able — this file just consumes it as globals, same as it
   already did before the split.
   ============================================================ */
'use strict';

/* ---------- car profile / topbar ---------- */
/* Shared join logic behind both carTitle() (topbar) and vehicleName()
   (main.js's garage-list rows) — one place that can produce
   "undefined undefined" instead of two. The two callers deliberately pass
   different field lists (the topbar's year already renders in the sub-line
   below it, so repeating it in the title would be redundant; the list has
   no sub-line, so it needs the year in the name itself) — this only
   factors out the "nickname, else join these fields, else localized
   fallback" shape, not the fields themselves. */
function joinName(c, fields, fallback) {
  return (c && c.nickname) || fields.map(f => c && c[f]).filter(Boolean).join(' ') || t(fallback);
}
function carTitle() { return joinName(session.current().car, ['make', 'model'], 'My car'); }
/* Shared with main.js's vehicle-list rows. */
function vehicleName(c) { return joinName(c, ['year', 'make', 'model'], 'Vehicle'); }
/* A brand mark, not per-car initials — every vehicle in the garage is a
   Mazda, so "M3"/"CX5" text never told the user anything CarTitle/CarSub
   didn't already say better. A stylized wing-over-oval mark (not a
   pixel copy of Mazda's official corporate logo file) reads clearly at
   badge size on both themes. */
const BRAND_MARK = html`<svg viewBox="0 0 44 44" fill="none"><ellipse cx="22" cy="23" rx="16" ry="10.5" stroke="currentColor" stroke-width="2.2"/><path d="M7 26c4-9.5 9.5-13.5 15-13.5s11 4 15 13.5" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>`;
function renderTopbar() {
  // An empty garage (no vehicle added yet) has no car to describe — go()
  // routes that case to the onboarding screen instead, which hides this
  // row entirely, so there is nothing here to keep in sync with.
  if (!session.current()) return;
  const c = session.current().car;
  $('#carTitle').textContent = carTitle();
  $('#carSub').textContent = [c.year, c.engine, c.transmission, c.color].filter(Boolean).join(' · ');
  $('#carBadge').innerHTML = BRAND_MARK;
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
  const has = Object.prototype.hasOwnProperty.call(paths, name);
  if (!has) console.warn(`iconSvg: unknown icon name ${JSON.stringify(name)}`);
  return html`<svg viewBox="0 0 24 24">${raw(has ? paths[name] : '')}</svg>`;
}
const TOAST_CAP = 3;
const TOAST_MS = 2200;
/* A deletion toast holds the only way back, so it has to outlive a plain
   confirmation — 2.2s is not enough to read a message and decide to undo. */
const UNDO_TOAST_MS = 7000;
/* toast() owns t() — every caller passes a raw translation key (or plain
   text with no key), never a pre-translated string, so a message never
   gets translated twice or shown in the wrong language because a caller
   forgot to call t() itself. */
function toastNode(msg, kind) {
  const host = $('#toastHost');
  const node = el('div', 'toast', html`<span class="dot" style="background:${kind === 'warn' ? 'var(--warn)' : 'var(--ok)'}"></span>${t(msg)}`);
  /* #toastHost itself carries aria-live="polite" (index.html) and is present
     from first paint, so the announcement never depends on the live region
     being inserted at the same moment as its content — the failure mode that
     makes dynamically-inserted regions unreliable. The role goes on the node,
     because it is what separates the two kinds: a save that did NOT happen is
     not a status update, and role="alert" is what makes it interrupt the
     screen reader rather than queue behind whatever is being read. */
  node.setAttribute('role', kind === 'warn' ? 'alert' : 'status');
  host.appendChild(node);
  // Cap stacked toasts so a burst of quick actions doesn't pile up
  // unboundedly — drop the oldest once the cap is exceeded.
  while (host.children.length > TOAST_CAP) host.firstElementChild.remove();
  return node;
}
function fadeToast(node) {
  if (!node.parentNode) return;   // already capped out, or dismissed by hand
  node.style.opacity = '0';
  node.style.transform = 'translateY(10px)';
  node.style.transition = '.3s';
  setTimeout(() => node.remove(), 300);
}
function toast(msg, kind) {
  const node = toastNode(msg, kind);
  setTimeout(() => fadeToast(node), TOAST_MS);
}
/* A toast that carries an action. .toast-host is pointer-events:none so
   toasts never block the page underneath, so a toast with something to click
   has to opt its own box back in — hence the extra class. */
function undoToast(msg, onUndo) {
  const node = toastNode(msg, null);
  node.classList.add('toast-action');
  const btn = el('button', 'toast-undo', html`${t('Undo')}`);
  node.appendChild(btn);
  // Dismiss on click anywhere else in the toast: the undo window is long
  // enough to be in the way if the answer is "no, that delete was intended".
  node.onclick = () => fadeToast(node);
  btn.onclick = ev => { ev.stopPropagation(); fadeToast(node); onUndo(); };
  /* Interactive content inside a live region is announced but not otherwise
     reachable — a screen-reader user has no virtual cursor there and nothing
     puts the button in the tab order ahead of the page behind it. Moving
     focus here is what makes the undo actually operable; it also means
     Escape-free keyboard use lands on the one control that matters. */
  if (typeof btn.focus === 'function') btn.focus();
  setTimeout(() => fadeToast(node), UNDO_TOAST_MS);
}

/* ============================================================
   SHARED PAGE ACTIONS
   ============================================================ */
/* The tail every modal form ends with. The order is load-bearing: persist
   first, so the confirmation reflects what actually landed rather than what
   was attempted; then close; then repaint the page underneath; then confirm.
   A failed save is normally reported by session.save()'s own notify hook,
   which can tell a full-storage failure ("Storage is full — change NOT
   saved") from a generic one — so this stays silent on !ok and never doubles
   up on that. failMsg is an override for the callers that need a
   case-specific warning instead, not an addition to it. */
async function commit(route, okMsg, failMsg) {
  const ok = await save();
  closeModal();
  if (route) go(route);
  if (ok) { if (okMsg) toast(okMsg); }
  else if (failMsg) toast(failMsg, 'warn');
  return ok;
}

/* Only these two record lists carry receipt photos — storage.js's
   photoSlots() is car/history/spending, and the car is not a deletable row.
   Every other list below needs record-only undo. */
const PHOTO_LISTS = ['history', 'spending'];

/* Deleting a row is a single tap with no confirmation step in front of it,
   which is right on a phone but only if there is something behind it: the
   row comes back exactly where it was, photo included, for as long as the
   toast is up.
   Everything the restore needs is captured BEFORE the save, and that is not
   tidiness. saveVehicle() collects the now-orphaned photo and deletes the
   stored blob during this very save, and session.save() prunes the
   in-memory copy the moment it resolves — read either one afterwards and
   there is nothing left to put back. */
function deleteRow(label, listKey, record, route, msg) {
  const del = el('button', 'btn block ghost', html`${t(label)}`);
  del.style.cssText = 'margin-top:8px;color:var(--danger)';
  onAsyncClick(del, async () => {
    const list = session.current()[listKey] || [];
    const index = list.indexOf(record);
    if (index < 0) return;   // already gone; nothing to delete and nothing to undo
    const vehicleId = session.garage().activeId;
    const photoId = PHOTO_LISTS.indexOf(listKey) >= 0 ? record.photoId : null;
    const blob = photoId ? session.photos()[photoId] : null;
    list.splice(index, 1);
    const ok = await commit(route, null);
    // Only offer undo for a delete that actually persisted. Offering it on a
    // failed save would promise to reverse something that never happened.
    if (ok) undoToast(msg, () => restoreRow({ vehicleId, listKey, record, index, photoId, blob, route }));
  });
  return del;
}

/* The undo window outlives the delete, so by the time it is clicked the
   garage may not be what it was: a sign-out clears the session outright, and
   the vehicle itself can be removed from the garage screen in that time.
   Re-inserting blind would resurrect a record into the next user's garage,
   or into a vehicle that no longer exists. */
async function restoreRow(u) {
  const g = session.garage();
  const v = g && g.vehicles.find(x => x.id === u.vehicleId);
  if (!v) return;
  /* save() only ever persists the ACTIVE vehicle, so an undo aimed at any
     other one has to make it active again or the restore would live in
     memory and never reach disk. */
  if (g.activeId !== u.vehicleId) { switchVehicle(u.vehicleId); applyAccent(); renderTopbar(); }
  const list = v.data[u.listKey] || (v.data[u.listKey] = []);
  if (list.some(x => x.id === u.record.id)) return;   // already back
  list.splice(Math.min(u.index, list.length), 0, u.record);
  /* Put the blob back on disk BEFORE the save. The restored record still
     carries its photoId and a (revoked) blob: URL rather than a data: URL,
     so splitPhotos() reads it as already-stored and would persist nothing —
     the row would come back pointing at an image that is gone. */
  if (u.photoId && u.blob) {
    session.photos()[u.photoId] = u.blob;
    await putPhotoBlob(u.photoId, u.blob);
    refreshPhotoUrls();
  }
  const ok = await save();
  go(u.route);
  if (ok) toast('Restored');
}

/* A validation toast names what is wrong but not where, and inside a long
   modal the offending input is often scrolled out of view — the user is told
   to fix something they cannot see. Ring it and focus it so the message and
   the fix are in the same place. The ring clears on the next keystroke (the
   listener here, not just the CSS) so it never outlives the mistake.
   Returns false so guards stay one-liners:
     if (!litres) return fail('#f_litres', 'Litres required'); */
function fail(sel, msg, root) {
  const node = $(sel, root || document);
  if (node) {
    node.classList.add('field-error');
    // Added, not assigned: several of these inputs already own an .oninput
    // handler of their own, and this must not replace it.
    node.addEventListener('input', () => node.classList.remove('field-error'), { once: true });
    if (typeof node.focus === 'function') node.focus();
  }
  toast(msg, 'warn');
  return false;
}

/* One `.seg` row where exactly one button carries `.on`. Every call site was
   re-implementing the same sweep across its own siblings; the wizard's
   `.wiz-opt` grids are the reason nodes can be passed explicitly, since
   those buttons are not siblings of each other. */
function segSelect(btn, nodes) {
  const group = nodes || (btn.parentElement ? btn.parentElement.children : [btn]);
  Array.from(group).forEach(x => x.classList.toggle('on', x === btn));
}

/* The icon / heading / sub-line / button row used for the account and plan
   prompts. `sub` goes through t() like the title, which is a no-op for the
   values that are already text (an email address has no translation). */
function bannerRow(icon, title, sub, button) {
  const row = el('div', 'card plan-setup-banner');
  row.innerHTML = html`<div class="r-ic">${icon}</div><div style="flex:1"><h3>${t(title)}</h3><p class="muted" style="font-size:12px;margin-top:2px">${t(sub)}</p></div>`;
  if (button) row.appendChild(button);
  return row;
}

/* ---------- theme ---------- */
function systemTheme() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  // The harness shell and any stripped-down HTML may not carry this meta
  // tag at all — guard rather than throw on a null $() result.
  const meta = $('meta[name=theme-color]');
  if (meta) meta.setAttribute('content', t === 'light' ? '#eef0f4' : '#0f1013');
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
/* hexToRgb, darkenHex, hexToHsl, accentForColor, paintOutline, paintPop,
   swatchFor, swatchStyle, currentTheme, etc. live in color.js now (see
   the file header) — chrome.js just calls them as globals, exactly as it
   called its own definitions before. accentForColor/paintOutline/paintPop
   take an explicit theme argument there, so every call site here passes
   currentTheme() itself. */
function applyAccent() {
  const s = document.documentElement.style;
  // No vehicle yet — nothing to accent from. setProperty() below is an
  // inline style, and inline styles outlive whatever set them — a bare
  // early return here left the PREVIOUS car's accent painted over the
  // onboarding screen after sign-out, because the inline override was
  // still there. Removing the properties instead of leaving them is what
  // actually lets the stylesheet's own :root defaults for all four of
  // them (styles.css) apply again — which is also why renderOnboarding()
  // in main.js calls applyAccent() itself before it paints: the onboarding
  // screen must never depend on some other call site having cleared the
  // override for it first.
  if (!session.current()) {
    s.removeProperty('--accent');
    s.removeProperty('--accent-soft');
    s.removeProperty('--accent-2');
    s.removeProperty('--accent-glow');
    return;
  }
  const theme = currentTheme();
  const [acc, soft] = accentForColor(session.current().car && session.current().car.color, theme);
  const [r, g, b] = hexToRgb(acc);
  s.setProperty('--accent', acc);
  s.setProperty('--accent-soft', soft);
  s.setProperty('--accent-2', darkenHex(acc, 0.72));
  s.setProperty('--accent-glow', `rgba(${r}, ${g}, ${b}, .35)`);
}
