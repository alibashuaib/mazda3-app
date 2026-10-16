/* ============================================================
   Garage — one-tap "would you buy here again?" prompt after a purchase.
   Plain script; never blocks or fails the save that precedes it.
   ============================================================ */
'use strict';

function openShopFeedback(shop) {
  openModal('Would you buy from this shop again?', '', card => {
    card.appendChild(el('p', 'sub', html`${shop.name} · ${shop.city}`));
    let up = null;                       // null until a thumb is chosen
    const reasons = new Set();
    const toggle = (btn, on) => { btn.classList.toggle('primary', on); btn.setAttribute('aria-pressed', on ? 'true' : 'false'); };
    const thumbs = el('div', 'field-row');
    const yes = el('button', 'btn', '👍'), no = el('button', 'btn', '👎');
    [yes, no].forEach(b => { b.type = 'button'; b.setAttribute('aria-pressed', 'false'); });
    const send = el('button', 'btn primary block', html`${t('Send')}`);
    send.disabled = true;
    const pick = v => { up = v; toggle(yes, v); toggle(no, !v); send.disabled = false; };
    yes.onclick = () => pick(true);
    no.onclick = () => pick(false);
    thumbs.append(yes, no);
    const chips = el('div', 'field-row');
    [['price', 'Good price'], ['quality', 'Quality work'], ['honest', 'Honest'], ['fast', 'Fast']].forEach(([k, label]) => {
      const c = el('button', 'btn ghost', html`${t(label)}`);
      c.type = 'button'; c.setAttribute('aria-pressed', 'false');
      c.onclick = () => { const on = !reasons.has(k); on ? reasons.add(k) : reasons.delete(k); toggle(c, on); };
      chips.appendChild(c);
    });
    onAsyncClick(send, async () => {
      if (up === null) return;
      const ok = await shops.vote(shop.id, up, [...reasons]).catch(() => false);   // vote() resolves false on failure
      closeModal();
      if (ok) toast('Thanks for the feedback'); else toast('Could not send feedback', 'warn');
    });
    const skip = el('button', 'btn ghost block', html`${t('Not now')}`);
    skip.onclick = closeModal;
    card.append(thumbs, chips, send, skip);
  });
}
