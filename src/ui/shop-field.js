/* ============================================================
   Garage — optional shop picker (name + city + area) for purchases.
   Plain script; exercised through the boot harness (test/shop-field.test.js).
   ============================================================ */
'use strict';

function shopField(initial) {
  initial = initial || {};
  const lid = 'shl_' + uid(), cid = 'scl_' + uid();
  const nameF = field('Shop (optional)', html`<input value="${initial.name || ''}" list="${lid}" autocomplete="off" maxlength="80">`);
  const cityF = field('City', html`<input value="${initial.city || shops.lastCity(session.current().history) || ''}" list="${cid}" maxlength="40">`);
  const areaF = field('Area', html`<input value="${initial.area || ''}" maxlength="40">`);
  const nameIn = nameF.querySelector('input'), cityIn = cityF.querySelector('input'), areaIn = areaF.querySelector('input');
  const dl = el('datalist'); dl.id = lid;
  const cl = el('datalist'); cl.id = cid;
  shops.CITIES.forEach(c => { const o = el('option'); o.value = c; cl.appendChild(o); });
  let seq = 0, found = [];
  const fillFrom = hit => { if (!hit) return; if (!cityIn.value.trim()) cityIn.value = hit.city; if (!areaIn.value.trim()) areaIn.value = hit.area || ''; };
  nameIn.addEventListener('input', () => {
    fillFrom(found.find(s => s.name === nameIn.value));   // a suggestion was just picked
    const mine = ++seq;
    shops.search(nameIn.value, cityIn.value.trim()).then(rows => {
      if (mine !== seq) return;                       // a newer keystroke owns the list
      found = rows || [];
      dl.replaceChildren(...found.map(s => { const o = el('option'); o.value = s.name; o.label = s.area || s.city; return o; }));
      fillFrom(found.find(s => s.name === nameIn.value));
    }).catch(() => {});
  });
  const row = el('div', 'field-row');
  row.append(cityF, areaF);
  return {
    nodes: [nameF, row, dl, cl],
    value() {
      const name = nameIn.value.trim();
      return name ? { name, city: cityIn.value.trim(), area: areaIn.value.trim() } : null;
    }
  };
}
