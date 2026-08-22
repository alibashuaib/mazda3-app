/* ============================================================
   Garage — Budget & Spending page.
   Plain script, like app.js — not require()d directly by any test, only
   exercised through the boot harness.
   ============================================================ */
'use strict';

function yearSpend(year) {
  return session.current().spending.filter(e => e.date.startsWith(String(year))).reduce((a, e) => a + Number(e.amount), 0);
}

/* ============================================================
   PAGE 4 — BUDGET & SPENDING
   ============================================================ */
function renderBudget() {
  const v = el('div');
  v.appendChild(pageIntro('Budget & Spending', 'Track what your Mazda costs to run and keep it in top shape.'));

  const spent = yearSpend(today().getFullYear());
  const budget = session.current().budget.annual;
  const pct = clamp(budget ? spent / budget : 0, 0, 1.2);
  const dash = 2 * Math.PI * 40;
  const overBudget = spent > budget;

  const ring = el('div', 'card budget-ring-card');
  ring.innerHTML = html`
    <div class="ring" style="width:96px;height:96px">
      <svg viewBox="0 0 92 92" style="width:96px;height:96px">
        <defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="${overBudget ? '#ff4d5e' : '#d6203c'}"/>
          <stop offset="1" stop-color="${overBudget ? '#ff8a95' : '#ff5c6e'}"/>
        </linearGradient></defs>
        <circle class="track" cx="46" cy="46" r="40" fill="none" stroke-width="8"/>
        <circle class="prog" cx="46" cy="46" r="40" fill="none" stroke-width="8"
          stroke-dasharray="${dash}" stroke-dashoffset="${dash * (1 - clamp(pct, 0, 1))}"/>
      </svg>
      <div class="ring-label"><div class="ring-num" style="font-size:19px">${Math.round(pct * 100)}%</div><div class="ring-cap">${t('of budget')}</div></div>
    </div>
    <div style="flex:1">
      <div class="muted" style="font-size:12px">${t('Spent in 2026')}</div>
      <div style="font-size:26px;font-weight:800;letter-spacing:-.5px">${sar(spent)} <span class="muted" style="font-size:13px;font-weight:600">SAR</span></div>
      <div style="font-size:12.5px;margin-top:4px" class="${overBudget ? '' : 'muted'}">
        ${overBudget ? html`⚠️ ${sar(spent - budget)} ${t('over budget')}` : html`${sar(budget - spent)} ${t('SAR remaining of')} ${sar(budget)}`}
      </div>
      <button class="odo-edit" id="editBudget" style="margin-top:8px">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
        ${t('Set annual budget')}
      </button>
    </div>`;
  v.appendChild(ring);

  // Upcoming maintenance cost — forecast pulled from the Maintenance schedule
  const upcoming = servicesRanked().filter(r => r.st.level !== 'ok');
  if (upcoming.length) {
    const dueCost = upcoming.reduce((a, r) => a + (r.s.cost || 0), 0);
    const odCount = upcoming.filter(r => r.st.level === 'danger').length;
    const fc = el('div', 'card');
    fc.style.cssText = 'padding:14px 16px;margin-top:12px;display:flex;align-items:center;gap:12px;cursor:pointer';
    fc.innerHTML = html`
      <div class="item-ic">🔧</div>
      <div style="flex:1">
        <h3 style="font-size:13.5px;font-weight:650">${t('Upcoming maintenance')}</h3>
        <p class="muted" style="font-size:12px;margin-top:2px">${upcoming.length} ${t('services due')}${odCount ? html` · ${odCount} ${t('overdue')}` : ''} — ${t('plan ~')}${sar(dueCost)} SAR</p>
      </div>
      <span style="color:var(--accent-soft);font-size:12.5px;font-weight:600">${t('View ›')}</span>`;
    fc.onclick = () => go('maintenance', { filter: odCount ? 'Overdue' : 'Due soon' });
    v.appendChild(fc);
  }

  // monthly bars (last 6 months)
  v.appendChild(sectionTitle('Monthly spending', '', null));
  const bars = el('div', 'card');
  bars.style.padding = '16px';
  bars.appendChild(monthlyBars());
  v.appendChild(bars);

  // breakdown by category
  const byCat = {};
  session.current().spending.filter(e => e.date.startsWith('2026')).forEach(e => { byCat[e.cat] = (byCat[e.cat] || 0) + Number(e.amount); });
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  if (cats.length) {
    v.appendChild(sectionTitle('By category (2026)', '', null));
    // (category names translated below)
    const cc = el('div', 'card');
    cc.style.padding = '14px 16px';
    const total = cats.reduce((a, c) => a + c[1], 0) || 1;
    cc.innerHTML = html`${cats.map(([k, val]) => html`
      <div style="margin:10px 0 12px">
        <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px">
          <span>${t(k)}</span><span style="font-weight:700">${sar(val)} SAR</span>
        </div>
        <div class="bar"><span style="width:${(val / total) * 100}%"></span></div>
      </div>`)}`;
    v.appendChild(cc);
  }

  // spending log
  v.appendChild(sectionTitle('Recent spending', 'Add', () => openAddSpending()));
  const log = el('div', 'list');
  const sorted = [...session.current().spending].sort((a, b) => b.date.localeCompare(a.date));
  if (!sorted.length) log.appendChild(emptyState('🧾', 'No spending logged yet.'));
  sorted.slice(0, 12).forEach(e => log.appendChild(spendEntry(e)));
  v.appendChild(log);

  ring.querySelector('#editBudget').onclick = openEditBudget;
  return v;
}

function openEditBudget() {
  openModal('Annual budget', 'Your target spend on the car for the year.', card => {
    card.appendChild(field('Budget (SAR / year)', html`<input id="m_budget" type="number" inputmode="numeric" value="${session.current().budget.annual}">`));
    const b = el('button', 'btn primary block', html`${t('Save')}`);
    onAsyncClick(b, async () => { const v = parseInt($('#m_budget').value, 10); if (!isNaN(v)) session.current().budget.annual = v; const ok = await save(); closeModal(); go('budget'); if (ok) toast('Budget updated'); });
    card.appendChild(b);
  });
}

function openAddSpending(e) {
  const editing = !!e;
  const cats = ['Maintenance', 'Tires', 'Parts', 'Fuel', 'Electrical', 'Insurance', 'Other'];
  openModal(editing ? 'Edit expense' : 'Add spending', 'Log money spent on the car.', card => {
    if (!editing) {
      const partOpts = session.current().parts.map((p, i) => html`<option value="part:${i}">${t(p.name)} · ${sar(partCheapest(p))} SAR</option>`);
      const quickPick = field('Quick pick',
        html`<select id="x_pick"><option value="">${t('Start from scratch…')}</option>${partOpts}</select>`);
      // The "— autofill from a part" note is styled markup, not plain text —
      // build it as a real DOM node and append it to the label rather than
      // asking field() to accept raw markup (see field()'s comment).
      const note = document.createElement('span');
      note.className = 'muted';
      note.setAttribute('style', 'font-weight:500');
      note.textContent = t('— autofill from a part');
      quickPick.querySelector('label').append(' ', note);
      card.appendChild(quickPick);
    }
    card.appendChild(field('Description', html`<input id="x_desc" value="${e ? e.desc : ''}" placeholder="${t('e.g. New front brake pads')}">`));
    const row = el('div', 'field-row');
    row.append(field('Amount (SAR)', html`<input id="x_amt" type="number" inputmode="numeric" value="${e ? e.amount : ''}">`),
      field('Date', html`<input id="x_date" type="date" value="${e ? e.date : isoDate(today())}">`));
    card.appendChild(row);
    card.appendChild(field('Category', html`<select id="x_cat">${cats.map(c => html`<option value="${c}" ${e && e.cat === c ? 'selected' : ''}>${t(c)}</option>`)}</select>`));
    card.appendChild(field('Odometer at time (km)', html`<input id="x_odo" type="number" value="${e ? e.odometer : session.current().car.odometer}">`));
    let xphoto = e ? (e.photo || '') : '';
    card.appendChild(field('Receipt / invoice', ''));
    card.appendChild(photoPicker(xphoto, v => xphoto = v));
    if (!editing) {
      $('#x_pick').onchange = function () {
        if (!this.value) return;
        const p = session.current().parts[+this.value.split(':')[1]];
        $('#x_desc').value = p.name;
        $('#x_amt').value = partCheapest(p);
        $('#x_cat').value = p.cat === 'Tires' ? 'Tires' : p.cat === 'Electrical' ? 'Electrical' : 'Parts';
      };
    }
    const b = el('button', 'btn primary block', html`${t('Save')}`);
    onAsyncClick(b, async () => {
      const desc = $('#x_desc').value.trim(); const amt = +$('#x_amt').value;
      if (!desc) return toast('Description required', 'warn');
      if (isNaN(amt)) return toast('Amount required', 'warn');
      const obj = { id: e ? e.id : uid(), desc, amount: amt, date: $('#x_date').value || isoDate(today()), cat: $('#x_cat').value, odometer: +$('#x_odo').value || session.current().car.odometer, photo: xphoto };
      if (e) Object.assign(e, obj); else session.current().spending.push(obj);
      const ok = await save(); closeModal(); go('budget'); if (ok) toast(editing ? 'Expense updated' : 'Expense added');
    });
    card.appendChild(b);
    if (editing) {
      const del = el('button', 'btn block ghost', html`${t('Delete expense')}`);
      del.style.marginTop = '8px'; del.style.color = 'var(--danger)';
      onAsyncClick(del, async () => { session.current().spending = session.current().spending.filter(x => x.id !== e.id); const ok = await save(); closeModal(); go('budget'); if (ok) toast('Expense deleted'); });
      card.appendChild(del);
    }
  });
}
