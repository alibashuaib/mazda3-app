/* ============================================================
   Garage — one-tap "would you buy here again?" prompt after a purchase.
   Plain script; never blocks or fails the save that precedes it.
   ============================================================ */
'use strict';

function openShopFeedback(shop) {
  openModal('Would you buy from shop again?', '', card => {
    card.appendChild(el('p', 'sub', html`${shop.name} · ${shop.city}`));
    const picked = new Set();
    const chips = el('div', 'field-row');
    [['price', 'Good price'], ['quality', 'Quality work'], ['honest', 'Honest'], ['fast', 'Fast']].forEach(([k, label]) => {
      const c = el('button', 'btn ghost', html`${t(label)}`);
      c.type = 'button';
      c.onclick = () => { picked.has(k) ? picked.delete(k) : picked.add(k); c.classList.toggle('primary', picked.has(k)); };
      chips.appendChild(c);
    });
    card.appendChild(chips);
    const send = v => async () => {
      const reasons = [...picked];
      closeModal();
      const ok = await shops.vote(shop.id, v, reasons).catch(() => false);   // vote() resolves false on failure
      if (ok) toast('Thanks feedback'); else toast('Could not send feedback', 'warn');
    };
    const row = el('div', 'field-row');
    const up = el('button', 'btn primary', '👍'); up.onclick = send(true);
    const down = el('button', 'btn', '👎'); down.onclick = send(false);
    const skip = el('button', 'btn ghost', html`${t('Not now')}`); skip.onclick = closeModal;
    row.append(up, down);
    card.append(row, skip);
  });
}
