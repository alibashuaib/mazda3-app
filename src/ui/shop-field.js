/* ============================================================
   Garage — optional shop picker (name + city + area) for purchases.
   Plain script; exercised through the boot harness (test/shop-field.test.js).
   ============================================================ */
'use strict';

const SEARCH_DEBOUNCE_MS = 250;

function shopField(initial) {
  initial = initial || {};
  const cid = 'scl_' + uid();
  const nameF = field('Shop (optional)', html`<input value="${initial.name || ''}" autocomplete="off" maxlength="80">`);
  const cityF = field('City', html`<input value="${initial.city || shops.lastCity(session.current().history) || ''}" list="${cid}" maxlength="40">`);
  const areaF = field('Area', html`<input value="${initial.area || ''}" maxlength="40">`);
  const nameIn = nameF.querySelector('input'), cityIn = cityF.querySelector('input'), areaIn = areaF.querySelector('input');
  const cl = el('datalist'); cl.id = cid;
  shops.CITIES.forEach(c => { const o = el('option'); o.value = c; cl.appendChild(o); });
  const list = el('div'); list.hidden = true;       // visible suggestions (names always via textContent)
  const prompt = el('div'); prompt.hidden = true;   // "Did you mean" box
  const same = (a, b) => shops.norm(a) === shops.norm(b);
  let seq = 0, timer = 0, picked = null, asked = false, prompting = false;

  const choice = (hit, sub, onTap) => {
    const b = el('button', 'btn ghost block'); b.type = 'button';
    const n = el('span'); n.textContent = hit.name;
    b.appendChild(n);
    if (sub) { const d = el('small'); d.textContent = ' · ' + sub; b.appendChild(d); }
    b.onclick = onTap;
    b.setAttribute('aria-label', hit.name + (sub ? ', ' + sub : ''));
    return b;
  };
  const sub = s => [s.area, s.city].filter(Boolean).join(', ');
  const pick = s => {
    nameIn.value = s.name; cityIn.value = s.city || ''; areaIn.value = s.area || '';
    picked = { name: s.name, city: s.city || '', area: s.area || '' };
    seq++; clearTimeout(timer); list.replaceChildren(); list.hidden = true;
  };
  nameIn.addEventListener('input', () => {
    const mine = ++seq;
    clearTimeout(timer);                              // debounce: only the last keystroke in the window searches
    timer = setTimeout(() => {
      shops.search(nameIn.value, cityIn.value.trim()).then(rows => {
        if (mine !== seq || prompting) return;                     // a newer keystroke owns the list
        rows = rows || [];
        list.replaceChildren(...rows.map(s => choice(s, sub(s), () => pick(s))));
        list.hidden = !rows.length;
      }).catch(() => {});
    }, SEARCH_DEBOUNCE_MS);
  });
  const row = el('div', 'field-row');
  row.append(cityF, areaF);
  const value = () => {
    const name = nameIn.value.trim();
    return name ? { name, city: cityIn.value.trim(), area: areaIn.value.trim() } : null;
  };
  return {
    nodes: [nameF, list, row, prompt, cl],
    value,
    set(s) { nameIn.value = s.name || ''; cityIn.value = s.city || ''; areaIn.value = s.area || ''; },
    /* Asks "Did you mean" once per form when the typed shop is close to an existing one. */
    async resolve() {
      const v = value();
      if (!v) return null;
      if (asked || (picked && same(picked.name, v.name) && same(picked.city, v.city))) return v;
      const hits = await shops.similar(v.name, v.city);
      if (!hits.length) return v;
      asked = true; prompting = true;
      list.replaceChildren(); list.hidden = true;
      return new Promise(resolve => {
        const done = r => { prompting = false; prompt.replaceChildren(); prompt.hidden = true; resolve(r); };
        const q = el('div'); q.textContent = t('Did you mean:');
        const no = el('button', 'btn ghost block'); no.type = 'button'; no.textContent = t('No, it is a new shop');
        no.onclick = () => done(value());   // read at click time: the user may have edited while the prompt was up
        prompt.replaceChildren(q, ...hits.map(h => choice(h, h.area || h.city, () => { pick(h); done({ name: h.name, city: h.city || '', area: h.area || '' }); })), no);
        prompt.hidden = false;
      });
    }
  };
}
