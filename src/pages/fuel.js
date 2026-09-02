/* ============================================================
   Garage — Fuel log & economy page.
   Plain script, like app.js — not require()d directly by any test, only
   exercised through the boot harness.
   ============================================================ */
'use strict';

/* ============================================================
   PAGE 6 — FUEL LOG & ECONOMY
   ============================================================ */
/* Tank-to-tank economy is only meaningful between two FULL tanks: a partial
   fill leaves an unknown amount already in the tank, so its litres are not
   what the car burned since the last fill. A partial therefore closes no
   interval — its litres and cost carry forward and settle on the next full
   tank, which measures the whole stretch since the previous full one. The
   `full` flag was already collected and shown; this is what reads it. */
function fuelRows() {
  const entries = [...(session.current().fuel || [])].sort((a, b) => a.date.localeCompare(b.date) || a.odometer - b.odometer);
  let anchor = null;             // last full tank — the open interval's start
  let carriedL = 0, carriedCost = 0;   // partials since that anchor
  return entries.map(e => {
    const isFull = e.full !== false;
    const litres = Number(e.litres) || 0;
    const cost = Number(e.cost) || 0;
    let l100 = null, km = null, costPerKm = null;
    if (!isFull) {
      carriedL += litres; carriedCost += cost;
      return { e, l100, km, costPerKm, partial: true };
    }
    if (anchor && e.odometer > anchor.odometer) {
      km = e.odometer - anchor.odometer;
      l100 = (carriedL + litres) / km * 100;
      costPerKm = (carriedCost + cost) / km;
    }
    anchor = e; carriedL = 0; carriedCost = 0;
    return { e, l100, km, costPerKm, partial: false };
  });
}
function renderFuel() {
  if (!session.current().fuel) session.current().fuel = [];
  const v = el('div');
  v.appendChild(pageIntro('Fuel', 'Log fill-ups to track economy (L/100 km) and running cost.'));

  const rows = fuelRows();
  const withEcon = rows.filter(r => r.l100 != null);
  // Distance-weighted, not a mean of the per-interval figures: a 900 km tank
  // and a 90 km tank are not equal evidence of how the car is consuming.
  const totalKm = withEcon.reduce((a, r) => a + r.km, 0);
  const avg = totalKm ? withEcon.reduce((a, r) => a + r.l100 * r.km, 0) / totalKm : null;
  const last = withEcon.length ? withEcon[withEcon.length - 1].l100 : null;
  const lastCPK = withEcon.length ? withEcon[withEcon.length - 1].costPerKm : null;
  const totalFuel = (session.current().fuel).reduce((a, e) => a + (Number(e.cost) || 0), 0);

  const tiles = el('div', 'tiles');
  tiles.innerHTML = html`
    <div class="tile"><div class="t-num">${last != null ? last.toFixed(1) : '—'}</div><div class="t-cap">${t('Last L/100km')}</div></div>
    <div class="tile"><div class="t-num">${avg != null ? avg.toFixed(1) : '—'}</div><div class="t-cap">${t('Avg L/100km')}</div></div>
    <div class="tile"><div class="t-num">${lastCPK != null ? lastCPK.toFixed(2) : '—'}</div><div class="t-cap">${t('SAR / km')}</div></div>`;
  v.appendChild(tiles);

  // economy-drop early warning → points to culprits already in the app
  if (last != null && avg != null && last > avg * 1.15) {
    const warn = el('div', 'card rec');
    warn.style.borderLeftColor = 'var(--warn)';
    warn.innerHTML = html`<div class="r-ic">⚠️</div><div><h3>${t('Fuel economy has dropped')}</h3><p>${t('Last fill-up was')} ${last.toFixed(1)} L/100km ${t('vs your')} ${avg.toFixed(1)} ${t('average.')} ${t('Common causes: low tire pressure (keep 36 PSI), dirty air filter, worn MAF/O2 sensor, tired spark plugs, or a dragging brake.')}</p></div>`;
    v.appendChild(warn);
  }

  const add = el('button', 'btn primary block', html`${iconSvg('plus')}${t('Add fill-up')}`);
  add.style.margin = '14px 0 4px';
  add.onclick = () => openAddFuel(null);
  v.appendChild(add);

  if (withEcon.length) {
    v.appendChild(sectionTitle('Economy trend — L/100km (lower is better)', '', null));
    const card = el('div', 'card');
    card.style.padding = '16px';
    card.appendChild(fuelBars(withEcon.slice(-8)));
    v.appendChild(card);
  }

  v.appendChild(sectionTitle('Fill-up log', '', null));
  const list = el('div', 'list');
  if (!rows.length) list.appendChild(emptyState('⛽', 'No fill-ups logged yet.\nTap "Add fill-up" after your next refuel.'));
  [...rows].reverse().forEach(({ e, l100, km }) => {
    const it = el('div', 'card entry');
    it.innerHTML = html`
      <div class="e-ic">⛽</div>
      <div class="e-main">
        <h3>${e.litres} L${e.full === false ? ' · ' + t('partial') : ''}${l100 != null ? ` · ${l100.toFixed(1)} L/100km` : ''}</h3>
        <p>${fmtDate(e.date, { day: 'numeric', month: 'short', year: 'numeric' })} · ${fmt(e.odometer)} km${km ? ` · +${fmt(km)} km` : ''}</p>
      </div>
      <div class="e-amt">${sar(e.cost)} <span class="muted" style="font-size:10px">SAR</span></div>`;
    it.onclick = () => openAddFuel(e);
    list.appendChild(it);
  });
  v.appendChild(list);
  return v;
}
function fuelBars(points) {
  const wrap = el('div', 'spend-bars');
  const max = Math.max(...points.map(p => p.l100), 1);
  points.forEach((p, i) => {
    const isNow = i === points.length - 1;
    const sb = el('div', 'sb' + (isNow ? ' now' : ''));
    const h = Math.max(6, p.l100 / max * 100);
    sb.innerHTML = html`<div class="col" style="height:${h}%"></div><div class="m">${p.l100.toFixed(1)}</div>`;
    sb.title = p.l100.toFixed(1) + ' L/100km';
    wrap.appendChild(sb);
  });
  return wrap;
}
function openAddFuel(e) {
  const editing = !!e;
  openModal(editing ? 'Edit fill-up' : 'Add fill-up', 'Record a refuel to track economy & cost.', card => {
    const r0 = el('div', 'field-row');
    r0.append(field('Date', html`<input id="f_date" type="date" value="${e ? e.date : isoDate(today())}">`),
      field('Odometer (km)', html`<input id="f_odo" type="number" inputmode="numeric" value="${e ? e.odometer : session.current().car.odometer}">`));
    card.appendChild(r0);
    const r1 = el('div', 'field-row');
    r1.append(field('Litres', html`<input id="f_l" type="number" inputmode="decimal" step="0.01" value="${e ? e.litres : ''}" placeholder="${t('e.g. 42')}">`),
      field('Cost (SAR)', html`<input id="f_cost" type="number" inputmode="decimal" value="${e ? e.cost : ''}" placeholder="${t('e.g. 95')}">`));
    card.appendChild(r1);
    card.appendChild(field('Tank', html`<select id="f_full"><option value="yes"${!e || e.full !== false ? ' selected' : ''}>${t('Full tank')}</option><option value="no"${e && e.full === false ? ' selected' : ''}>${t('Partial fill')}</option></select>`));
    const b = el('button', 'btn primary block', html`${t('Save')}`);
    onAsyncClick(b, async () => {
      const litres = +$('#f_l').value, odo = +$('#f_odo').value;
      if (!litres) return fail('#f_l', 'Litres required');
      if (!odo) return fail('#f_odo', 'Odometer required');
      const obj = { id: e ? e.id : uid(), date: $('#f_date').value || isoDate(today()), odometer: odo, litres, cost: +$('#f_cost').value || 0, full: $('#f_full').value !== 'no' };
      if (e) Object.assign(e, obj); else { session.current().fuel = session.current().fuel || []; session.current().fuel.push(obj); }
      // a fill-up is a real odometer reading — stamp it with the fill-up's own date
      if (odo > session.current().car.odometer) { session.current().car.odometer = odo; session.current().car.odoUpdatedAt = obj.date; }
      await commit('fuel', editing ? 'Fill-up updated' : 'Fill-up added');
    });
    card.appendChild(b);
    if (editing) {
      const del = deleteRow('Delete fill-up', 'fuel', e, 'fuel', 'Fill-up deleted');
      card.appendChild(del);
    }
  });
}
