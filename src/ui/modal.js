/* ============================================================
   Garage — the single modal host every dialog builds into.
   Plain script, like app.js — not require()d directly by any test, only
   exercised through the boot harness.
   ============================================================ */
'use strict';

/* The card carries role="dialog" aria-modal="true" (see index.html). That
   asserts the rest of the page is inert, so the dialog has to actually
   behave like one: name itself, take focus, keep Tab inside, close on
   Escape, and hand focus back to whatever opened it. */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
let modalReturnFocus = null;
/* Set by openModal()'s optional opts.onDismissed, fired from closeModal() no
   matter which of its three call sites triggered the close (the backdrop's
   [data-close] click, Escape via onModalKeydown, or a caller invoking
   closeModal() directly) — a caller that only overrides [data-close].onclick
   misses Escape entirely, and a promise waiting on that click never resolves. */
let modalOnDismiss = null;

function trapTab(ev) {
  if (ev.key !== 'Tab') return;
  const items = Array.from($('#modalCard').querySelectorAll(FOCUSABLE)).filter(n => n.offsetParent !== null || n === document.activeElement);
  if (!items.length) return;
  const first = items[0], last = items[items.length - 1];
  if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
  else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
}
function onModalKeydown(ev) {
  if (ev.key === 'Escape') { ev.preventDefault(); closeModal(); return; }
  trapTab(ev);
}

function openModal(title, sub, bodyBuilder, opts) {
  const host = $('#modalHost'), card = $('#modalCard');
  card.innerHTML = '<div class="modal-grip"></div>';
  const h = el('h2', null, html`${t(title)}`);
  h.id = 'modalTitle';
  card.setAttribute('aria-labelledby', h.id);   // otherwise the dialog is unnamed
  card.appendChild(h);
  if (sub) card.appendChild(el('p', 'sub', html`${t(sub)}`));
  bodyBuilder(card);
  host.hidden = false;
  // The host markup always has a backdrop with [data-close] (see index.html),
  // but a defensive guard here costs nothing and turns a missing one into a
  // silently-inert backdrop instead of a thrown TypeError that aborts the
  // rest of openModal() (and leaves the dialog half-wired: visible, but with
  // no keydown listener and no focus trap).
  const closeBtn = host.querySelector('[data-close]');
  if (closeBtn) closeBtn.onclick = closeModal;
  modalOnDismiss = (opts && opts.onDismissed) || null;
  // Remember the opener only on a fresh open — a dialog that replaces another
  // must not overwrite it with the outgoing dialog's own button.
  if (!modalReturnFocus) modalReturnFocus = document.activeElement;
  document.addEventListener('keydown', onModalKeydown);
  document.body.style.overflow = 'hidden';      // don't scroll the page behind it
  const target = card.querySelector(FOCUSABLE);
  if (target) target.focus();
}
function closeModal() {
  $('#modalHost').hidden = true;
  document.removeEventListener('keydown', onModalKeydown);
  document.body.style.overflow = '';
  const back = modalReturnFocus;
  modalReturnFocus = null;
  if (back && typeof back.focus === 'function' && document.contains(back)) back.focus();
  const onDismiss = modalOnDismiss;
  modalOnDismiss = null;
  if (onDismiss) onDismiss();
}

/* onAsyncClick lives in ui.js so the re-entry guard is covered by the tests —
   it is a race, and races do not show up in a render. */
function field(label, inputHtml) {
  const f = el('div', 'field');
  // label is always plain text and always escaped — there is no raw-markup
  // escape hatch here. A caller that wants markup in its label (see
  // openAddSpending's "Quick pick" note) builds it itself, after this
  // returns, as real DOM nodes appended to the <label> element.
  f.innerHTML = html`<label>${t(label)}</label>${inputHtml}`;
  return f;
}
