/* ============================================================
   Garage — Parts page and the service↔part cross-links every page uses.
   Plain script, like app.js — not require()d directly by any test, only
   exercised through the boot harness.
   ============================================================ */
'use strict';

/* ---------- cross-page links: which parts each service consumes ---------- */
const SERVICE_PARTS = {
  'Engine Oil & Filter': ['Engine Oil 5W-30', 'Oil Filter', 'Fuel System Cleaner (additive)'],
  'Engine Air Filter': ['Engine Air Filter'],
  'Cabin (A/C) Filter': ['Cabin A/C Filter'],
  'Spark Plugs (x4)': ['Spark Plugs (each)'],
  'Spark Plugs (x6)': ['Spark Plugs (each)'],
  'Brake Fluid': ['Brake Fluid (DOT 4)'],
  'Engine Coolant (FL22)': ['Coolant FL22 (long-life)'],
  'Automatic Transmission Fluid': ['ATF FZ (per liter)', 'Transmission Fluid Filter', 'Transmission Pan Sealant'],
  'Drive (Serpentine) Belt': ['Serpentine Belt'],
  'Battery Check': ['12V Battery'],
  'Brake Inspection & Caliper Lube': ['Front Brake Pads', 'Rear Brake Pads']
};
function compatibleParts() {
  const state = session.current();
  return state.parts.filter(p => partFitsCar(p, state.car));
}
// Math.min() of nothing is Infinity, which renders as a price — 0 reads as "unpriced".
const partCheapest = p => (p.options && p.options.length) ? Math.min(...p.options.map(o => o.price)) : 0;
function partsForService(s) { return (SERVICE_PARTS[s.name] || []).map(n => compatibleParts().find(p => p.name === n)).filter(Boolean); }
function servicesForPart(p) { return session.current().services.filter(s => (SERVICE_PARTS[s.name] || []).includes(p.name)); }

/* How mandatory a part is for the car's health — drives the "do it next time"
   warning when a part is skipped (marked None). high = safety/engine-critical. */
const CRIT_HIGH = new Set(['Engine Oil 5W-30', 'Oil Filter', 'Fuel System Cleaner (additive)', 'Front Brake Pads', 'Rear Brake Pads', 'Brake Fluid (DOT 4)', 'Front Brake Disc (each)', 'Rear Brake Disc (each)', 'Coolant FL22 (long-life)', 'ATF FZ (per liter)', 'Transmission Fluid Filter', 'Spark Plugs (each)', 'Timing Chain Kit', 'Water Pump', 'Serpentine Belt']);
const CRIT_LOW = new Set(['Cabin A/C Filter', 'Wiper Blades (pair)', 'Windshield Washer Fluid (~2L)', 'Headlight Bulbs (H11 low · 9005 high)', 'Tail / Brake Light Bulbs', 'Transmission Pan Sealant']);
function partCrit(name) { return CRIT_HIGH.has(name) ? 'high' : CRIT_LOW.has(name) ? 'low' : 'med'; }
const critLevel = name => partCrit(name) === 'high' ? 'danger' : partCrit(name) === 'med' ? 'warn' : 'ok';
const critLabel = name => partCrit(name) === 'high' ? t('mandatory') : partCrit(name) === 'low' ? t('optional') : t('recommended');

/* ============================================================
   PAGE 3 — PARTS
   ============================================================ */
function renderParts() {
  const v = el('div');
  v.appendChild(pageIntro('Car Parts', 'Only compatible parts are shown. Shared consumables are marked ↔; vehicle-locked parts are marked 🔒.'));

  const cats = ['All', ...new Set(compatibleParts().map(p => p.cat))];
  let active = 'All';
  let query = '';

  const search = el('label', 'part-search');
  search.innerHTML = html`
    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path></svg>
    <input type="search" placeholder="${t('Search parts')}" aria-label="${t('Search parts')}">
    <span class="part-count"></span>`;
  v.appendChild(search);

  const seg = el('div', 'seg category-scroll');
  cats.forEach(c => {
    const b = el('button', c === active ? 'on' : '', html`${t(c)}`);
    b.onclick = () => { active = c; [...seg.children].forEach(x => x.classList.toggle('on', x === b)); paint(); };
    seg.appendChild(b);
  });
  v.appendChild(seg);

  const list = el('div', 'list');
  v.appendChild(list);
  function paint() {
    list.innerHTML = '';
    const needle = query.toLowerCase();
    const items = compatibleParts().filter(p => (active === 'All' || p.cat === active) &&
      (!needle || [p.name, p.cat, p.partsouq, ...(p.options || []).flatMap(o => [o.brand, o.partNo])]
        .some(value => String(value || '').toLowerCase().includes(needle))));
    items.forEach(p => list.appendChild(partCard(p)));
    search.querySelector('.part-count').textContent = String(items.length);
    if (!items.length) list.appendChild(emptyState('🔎', 'No matching parts.'));
  }
  search.querySelector('input').oninput = e => { query = e.target.value.trim(); paint(); };
  paint();

  // arriving via a "View part" link from Maintenance — open & scroll to it
  if (navIntent && navIntent.openPart) {
    const targetId = navIntent.openPart; navIntent = null;
    setTimeout(() => {
      const cardEl = list.querySelector(`[data-id="${targetId}"]`);
      if (cardEl) { cardEl.classList.add('open'); cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    }, 60);
  }

  const add = el('button', 'btn block ghost', html`${iconSvg('plus')}${t('Add a part')}`);
  add.style.marginTop = '16px';
  add.onclick = () => openEditPart(null);
  v.appendChild(add);
  return v;
}

function partCard(p) {
  const cheapest = partCheapest(p);
  const usedIn = servicesForPart(p);
  const model = CAR_MODELS.find(m => m.id === session.current().car.modelId);
  const fitmentLabel = p.fitment && p.fitment.shareable
    ? t('Shared consumable')
    : `🔒 ${model ? `Mazda ${model.model} · ${model.gen}` : t('This vehicle only')}`;
  const card = el('div', 'card part');
  card.dataset.id = p.id;
  card.innerHTML = html`
    <div class="part-head">
      <div class="item-ic">${p.icon || '🔩'}</div>
      <h3>${t(p.name)} <span title="${fitmentLabel}" style="font-size:11px;opacity:.65">${p.fitment && p.fitment.shareable ? '↔' : '🔒'}</span></h3>
      <div style="text-align:right">
        <div style="font-weight:750;font-size:14px">${t('from')} ${sar(cheapest)} <span class="muted" style="font-size:11px">SAR</span></div>
        <div class="muted" style="font-size:11px">${p.options.length} ${t('options')}</div>
      </div>
      <button class="part-toggle"><svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></button>
    </div>
    <div class="part-body">
      <div style="margin-bottom:10px"><span class="pill ${p.fitment && p.fitment.shareable ? 'ok' : ''}">${fitmentLabel}</span></div>
      ${p.options.map(o => html`
        <div class="opt">
          <span class="opt-tag ${o.tag === 'OEM' ? 'oem' : 'alt'}">${o.tag}</span>
          <div class="opt-main">
            <div class="b">${t(o.brand)}</div>
            <div class="s">${[o.partNo, t(o.note)].filter(Boolean).join(' · ') || raw('&nbsp;')}</div>
          </div>
          <div class="opt-price">
            <div class="p">${sar(o.price)} <span class="muted" style="font-size:10px">SAR</span></div>
            <div class="store">${t(o.store)}</div>
          </div>
        </div>`)}
      ${usedIn.length ? html`<div style="margin-top:12px;display:flex;flex-wrap:wrap;gap:6px;align-items:center">
        <span class="muted" style="font-size:11px;font-weight:600">${t('🔧 Used in:')}</span>
        ${usedIn.map(s => html`<button class="chip-link" data-svc="${s.id}">${t(s.name)}</button>`)}
      </div>` : ''}
      ${p.partsouq ? html`<a class="btn" href="https://partsouq.com/en/search/all?q=${encodeURIComponent(p.partsouq)}" target="_blank" rel="noopener noreferrer" style="width:100%;margin-top:12px;font-size:12.5px;padding:11px;text-decoration:none;color:var(--accent-soft)">${raw(t('🔎 Live price &amp; alternatives on PartSouq ↗'))}</a>` : ''}
      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="btn ghost" style="flex:1;font-size:12.5px;padding:9px" data-edit>${t('Edit')}</button>
      </div>
    </div>`;
  const toggle = () => card.classList.toggle('open');
  card.querySelector('.part-head').onclick = e => { if (!e.target.closest('.part-toggle') && !e.target.closest('button')) toggle(); };
  card.querySelector('.part-toggle').onclick = toggle;
  card.querySelector('[data-edit]').onclick = e => { e.stopPropagation(); openEditPart(p); };
  card.querySelectorAll('[data-svc]').forEach(btn => btn.onclick = e => {
    e.stopPropagation();
    const s = session.current().services.find(x => x.id === btn.dataset.svc);
    if (s) { go('maintenance'); setTimeout(() => openServiceDetail(s), 0); }
  });
  return card;
}

function openEditPart(p) {
  const editing = !!p;
  openModal(editing ? 'Edit part' : 'New part', 'Add the OEM option and any alternatives.', card => {
    card.appendChild(field('Part name', html`<input id="p_name" value="${p ? p.name : ''}" placeholder="${t('e.g. Front Brake Pads')}">`));
    const fitment = el('div', 'card');
    const fitmentModel = CAR_MODELS.find(m => m.id === session.current().car.modelId);
    fitment.style.cssText = 'padding:11px 13px;margin-bottom:12px;font-size:12px;color:var(--text-2)';
    fitment.textContent = p && p.fitment && p.fitment.shareable
      ? `↔ ${t('Shared consumable across compatible Mazda models')}`
      : `🔒 ${t('Locked to')} ${fitmentModel ? `Mazda ${fitmentModel.model} · ${fitmentModel.gen}` : t('this vehicle')}`;
    card.appendChild(fitment);
    const row = el('div', 'field-row');
    const curCat = p ? p.cat : 'Engine';
    const catList = [...new Set(['Engine', 'Interior', 'Brakes', 'Exterior', 'Electrical', 'Drivetrain', 'Suspension', 'A/C', 'Tires', 'General', ...session.current().parts.map(x => x.cat), curCat])];
    row.append(field('Icon (emoji)', html`<input id="p_icon" value="${p ? p.icon : '🔩'}" maxlength="2">`),
      field('Category', html`<select id="p_cat">${catList.map(c => html`<option value="${c}" ${c === curCat ? 'selected' : ''}>${t(c)}</option>`)}</select>`));
    card.appendChild(row);
    card.appendChild(field('PartSouq part no. (optional — enables live-price link)', html`<input id="p_psq" value="${p && p.partsouq ? p.partsouq : ''}" placeholder="e.g. PE0114302A">`));

    const optsWrap = el('div');
    const lbl = el('div'); lbl.style.cssText = 'font-size:12px;font-weight:600;color:var(--text-2);margin:6px 0';
    lbl.textContent = t('Options (OEM & alternatives)');
    card.appendChild(lbl);
    card.appendChild(optsWrap);

    const opts = p ? JSON.parse(JSON.stringify(p.options)) : [{ tag: 'OEM', brand: '', partNo: '', price: 0, store: '', note: '' }];
    function drawOpts() {
      optsWrap.innerHTML = '';
      opts.forEach((o, i) => {
        const box = el('div', 'card');
        box.style.cssText = 'padding:12px;margin-bottom:10px';
        box.innerHTML = html`
          <div class="field-row" style="margin-bottom:8px">
            <div class="field" style="margin:0"><label>${t('Type')}</label><select data-k="tag"><option ${o.tag === 'OEM' ? 'selected' : ''}>OEM</option><option ${o.tag !== 'OEM' ? 'selected' : ''}>ALT</option></select></div>
            <div class="field" style="margin:0"><label>${t('Price (SAR)')}</label><input type="number" data-k="price" value="${o.price}"></div>
          </div>
          <div class="field" style="margin:0 0 8px"><label>${t('Brand / product')}</label><input data-k="brand" value="${o.brand || ''}"></div>
          <div class="field-row" style="margin-bottom:8px">
            <div class="field" style="margin:0"><label>${t('Part no.')}</label><input data-k="partNo" value="${o.partNo || ''}"></div>
            <div class="field" style="margin:0"><label>${t('Store')}</label><input data-k="store" value="${o.store || ''}"></div>
          </div>
          <div class="field" style="margin:0"><label>${t('Note')}</label><input data-k="note" value="${o.note || ''}"></div>`;
        box.querySelectorAll('[data-k]').forEach(inp => inp.oninput = () => { o[inp.dataset.k] = inp.type === 'number' ? +inp.value : inp.value; });
        if (opts.length > 1) {
          const rm = el('button', 'btn ghost', html`${t('Remove option')}`); rm.style.cssText = 'margin-top:8px;font-size:12px;padding:7px;color:var(--danger)';
          rm.onclick = () => { opts.splice(i, 1); drawOpts(); };
          box.appendChild(rm);
        }
        optsWrap.appendChild(box);
      });
    }
    drawOpts();
    const addOpt = el('button', 'btn block ghost', html`${iconSvg('plus')}${t('Add option')}`);
    addOpt.style.marginBottom = '14px';
    addOpt.onclick = () => { opts.push({ tag: 'ALT', brand: '', partNo: '', price: 0, store: '', note: '' }); drawOpts(); };
    card.appendChild(addOpt);

    const b = el('button', 'btn primary block', html`${t('Save part')}`);
    onAsyncClick(b, async () => {
      const name = $('#p_name').value.trim();
      if (!name) return toast('Part name required', 'warn');
      const valid = opts.filter(o => o.brand.trim());
      if (!valid.length) return toast('Add at least one option', 'warn');
      const obj = { id: p ? p.id : uid(), name, icon: $('#p_icon').value.trim() || '🔩', cat: $('#p_cat').value.trim() || 'General', partsouq: $('#p_psq').value.trim().replace(/[^A-Za-z0-9]/g, ''), options: valid,
        fitment: p && p.fitment ? p.fitment : { shareable: false, modelIds: session.current().car.modelId ? [session.current().car.modelId] : [] } };
      if (p) Object.assign(p, obj); else session.current().parts.push(obj);
      const ok = await save(); closeModal(); go('parts'); if (ok) toast(editing ? 'Part updated' : 'Part added');
    });
    card.appendChild(b);
    if (editing) {
      const del = el('button', 'btn block ghost', html`${t('Delete part')}`);
      del.style.marginTop = '8px'; del.style.color = 'var(--danger)';
      onAsyncClick(del, async () => { session.current().parts = session.current().parts.filter(x => x.id !== p.id); const ok = await save(); closeModal(); go('parts'); if (ok) toast('Part deleted'); });
      card.appendChild(del);
    }
  });
}
