/* ============================================================
   Garage — documents & renewals (insurance, Istimara, license…),
   rendered inside the Dashboard, plus the mileage editor.
   Plain script, like app.js — not require()d directly by any test, only
   exercised through the boot harness.
   ============================================================ */
'use strict';

/* ---------- documents & renewals ---------- */
const DOC_ICONS = { 'Insurance': '📄', 'Registration (Istimara)': '🪪', 'Vehicle Inspection (Fahes)': '✅', 'Driving License': '🚗', 'Warranty': '🛡️', 'Other': '📎' };
function docStatus(expiry) {
  if (!expiry) return { level: 'ok', txt: t('No date set') };
  const days = Math.round((parseDate(expiry) - today()) / 86400000);
  const ar = lang === 'ar';
  const level = days < 0 ? 'danger' : days <= 30 ? 'warn' : 'ok';
  const txt = days < 0 ? (ar ? `منتهية منذ ${Math.abs(days)} يوم` : `Expired ${Math.abs(days)}d ago`)
    : days === 0 ? t('Due today')
    : days <= 60 ? (ar ? `خلال ${days} يوم` : `in ${days}d`)
    : (ar ? `خلال ${Math.round(days / 30)} شهر` : `in ${Math.round(days / 30)} mo`);
  return { days, level, txt };
}
function docItem(d) {
  const st = docStatus(d.expiry);
  const it = el('div', 'item');
  it.innerHTML = html`
    <div class="item-ic">${DOC_ICONS[d.type] || '📄'}</div>
    <div class="item-main">
      <h3>${d.name ? d.name : t(d.type)}</h3>
      <p>${d.expiry ? t('Expires') + ' ' + new Date(d.expiry + 'T00:00:00').toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' }) : t('No expiry date')}${d.number ? ` · ${d.number}` : ''}</p>
    </div>
    <div class="item-side"><span class="pill ${st.level}">${st.txt}</span></div>`;
  it.onclick = () => openAddDoc(d);
  return it;
}
function openAddDoc(d) {
  const editing = !!d;
  const types = Object.keys(DOC_ICONS);
  openModal(editing ? 'Edit document' : 'Add document', 'Track renewals so you never miss an expiry.', card => {
    card.appendChild(field('Type', html`<select id="d_type">${types.map(ty => html`<option value="${ty}" ${d && d.type === ty ? 'selected' : ''}>${t(ty)}</option>`)}</select>`));
    card.appendChild(field('Label (optional)', html`<input id="d_name" value="${d ? (d.name || '') : ''}" placeholder="${t('e.g. Tawuniya comprehensive')}">`));
    const r = el('div', 'field-row');
    r.append(field('Expiry date', html`<input id="d_exp" type="date" value="${d ? (d.expiry || '') : ''}">`),
      field('Reference no. (optional)', html`<input id="d_num" value="${d ? (d.number || '') : ''}">`));
    card.appendChild(r);
    const b = el('button', 'btn primary block', html`${t('Save')}`);
    onAsyncClick(b, async () => {
      const obj = { id: d ? d.id : uid(), type: $('#d_type').value, name: $('#d_name').value.trim(), expiry: $('#d_exp').value, number: $('#d_num').value.trim() };
      if (d) Object.assign(d, obj); else { session.current().docs = session.current().docs || []; session.current().docs.push(obj); }
      await commit('dashboard', editing ? 'Document updated' : 'Document added');
    });
    card.appendChild(b);
    if (editing) {
      const del = deleteRow('Delete document', 'docs', d, 'dashboard', 'Document deleted');
      card.appendChild(del);
    }
  });
}

function openEditOdo() {
  openModal('Update mileage', 'Keep this current so due dates stay accurate.', card => {
    card.appendChild(field('Odometer (km)', html`<input id="m_odo" type="number" inputmode="numeric" value="${session.current().car.odometer}">`));
    card.appendChild(field('Average driving (km / day)', html`<input id="m_daily" type="number" inputmode="numeric" value="${session.current().car.dailyKm}">`));
    const b = el('button', 'btn primary block', html`${t('Save')}`);
    onAsyncClick(b, async () => {
      const val = parseInt($('#m_odo').value, 10);
      if (!isNaN(val)) { session.current().car.odometer = val; session.current().car.odoUpdatedAt = isoDate(today()); }
      const d = parseInt($('#m_daily').value, 10);
      if (!isNaN(d) && d > 0) session.current().car.dailyKm = d;
      await commit(current, 'Mileage updated');
    });
    card.appendChild(b);
  });
}
