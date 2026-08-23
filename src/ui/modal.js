/* ============================================================
   Garage — the single modal host every dialog builds into.
   Plain script, like app.js — not require()d directly by any test, only
   exercised through the boot harness.
   ============================================================ */
'use strict';

function openModal(title, sub, bodyBuilder) {
  const host = $('#modalHost'), card = $('#modalCard');
  card.innerHTML = '<div class="modal-grip"></div>';
  const h = el('h2', null, html`${t(title)}`); card.appendChild(h);
  if (sub) card.appendChild(el('p', 'sub', html`${t(sub)}`));
  bodyBuilder(card);
  host.hidden = false;
  host.querySelector('[data-close]').onclick = closeModal;
}
function closeModal() { $('#modalHost').hidden = true; }

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
