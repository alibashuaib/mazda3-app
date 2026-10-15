/* ============================================================
   Garage — admin: review and correct the shared car catalogue.
   Reached from the account menu (admins only) or #admin. Hiding it is
   convenience, not security: RLS refuses a non-admin's writes.
   Plain script, exercised through the boot harness.
   ============================================================ */
'use strict';

let adminModelId = null;   // the car being edited, or null for the list

function renderAdmin() {
  const v = el('div', 'admin-view');
  v.appendChild(pageIntro('Admin', 'Review and correct the shared car catalogue.'));
  const body = el('div');
  body.innerHTML = html`<p class="muted">${t('Loading…')}</p>`;
  v.appendChild(body);
  renderAdminBody(body);
  return v;
}

function adminNotice(body, msg) {
  body.innerHTML = html`<div class="card" style="padding:16px">${t(msg)}</div>`;
}

async function renderAdminBody(body) {
  if (!catalogAdmin.available()) return adminNotice(body, 'Admin needs an internet connection.');
  if (!account.user()) { body.innerHTML = ''; body.appendChild(adminSignIn()); return; }
  if (!(await catalogAdmin.isAdmin())) return adminNotice(body, 'This account is not an admin.');
  try {
    const node = adminModelId ? await adminEditor(adminModelId) : await adminList();
    body.innerHTML = '';
    body.appendChild(node);
  } catch (e) {
    console.error(e);
    adminNotice(body, 'Could not load the catalogue.');
  }
}

function adminSignIn() {
  const card = el('div', 'card');
  card.style.padding = '16px';
  card.appendChild(field('Email', html`<input id="adm_email" type="email" autocomplete="username">`));
  card.appendChild(field('Password', html`<input id="adm_pw" type="password" autocomplete="current-password">`));
  const err = el('p', 'muted');
  err.hidden = true;
  const b = el('button', 'btn primary block', html`${t('Sign in')}`);
  onAsyncClick(b, async () => {
    err.hidden = true;
    try {
      await account.signIn($('#adm_email').value.trim(), $('#adm_pw').value);
      go('admin');
    } catch (e) {
      err.textContent = t('Sign-in failed. Check your email and password.');
      err.hidden = false;
    }
  });
  card.append(b, err);
  return card;
}

async function adminList() {
  const models = await catalogAdmin.listModels();
  const ordered = models.filter(m => m.status === 'draft').concat(models.filter(m => m.status !== 'draft'));
  const wrap = el('div', 'card');
  ordered.forEach(m => {
    const it = el('div', 'item');
    it.innerHTML = html`<div class="item-main"><h3>Mazda ${m.model} · ${m.generation}</h3><p>${m.engine}</p></div>
      <div class="item-side">${m.status === 'draft' ? html`<span class="pill warn">${t('Needs review')}</span>` : ''}</div>`;
    it.onclick = () => { adminModelId = m.id; go('admin'); };
    wrap.appendChild(it);
  });
  return wrap;
}

async function adminEditor(id) {
  const { model, items, changes } = await catalogAdmin.loadModel(id);
  const wrap = el('div');
  const back = el('button', 'btn ghost', html`← ${t('All cars')}`);
  back.onclick = () => { adminModelId = null; go('admin'); };
  wrap.appendChild(back);

  const head = el('div', 'card');
  head.style.padding = '16px';
  head.innerHTML = html`<h3>Mazda ${model.model} · ${model.generation} · ${model.engine}</h3>`;
  const wr = el('div', 'field-row');
  wr.append(
    field('Warranty (years)', html`<input id="adm_wy" type="number" min="0" value="${model.warranty_years ?? ''}">`),
    field('Warranty (km)', html`<input id="adm_wkm" type="number" min="0" value="${model.warranty_km ?? ''}">`));
  head.appendChild(wr);
  wrap.appendChild(head);

  const list = el('div', 'card');
  list.style.padding = '16px';
  items.forEach(it => {
    const box = el('div', 'admin-item');
    box.dataset.itemId = String(it.id);
    box.innerHTML = html`<h4>${it.icon} ${t(it.service)}</h4>`;
    const r = el('div', 'field-row');
    r.append(
      field('Dealer interval (km)', html`<input data-k="interval_km" type="number" min="0" value="${it.interval_km ?? ''}">`),
      field('Dealer interval (mo)', html`<input data-k="interval_months" type="number" min="0" value="${it.interval_months ?? ''}">`));
    box.appendChild(r);
    box.appendChild(field('Note', html`<textarea data-k="note" rows="2">${it.note}</textarea>`));
    box.appendChild(field('Parts (name | part number | qty, one per line)',
      html`<textarea data-k="parts" rows="2">${catalogAdmin.formatParts(it.parts)}</textarea>`));
    list.appendChild(box);
  });
  wrap.appendChild(list);

  const save = el('button', 'btn primary block', html`${t(model.status === 'draft' ? 'Save and approve' : 'Save changes')}`);
  onAsyncClick(save, async () => {
    try {
      await catalogAdmin.saveWarranty(id, catalogAdmin.num($('#adm_wy').value), catalogAdmin.num($('#adm_wkm').value));
      for (const box of list.querySelectorAll('.admin-item')) {
        const before = items.find(x => String(x.id) === box.dataset.itemId);
        const fields = {};
        box.querySelectorAll('[data-k]').forEach(inp => { fields[inp.dataset.k] = inp.value; });
        const patch = catalogAdmin.itemPatch(before, fields);
        if (patch) await catalogAdmin.saveItem(before.id, patch);
      }
      if (model.status === 'draft') await catalogAdmin.approve(id);
      toast('Catalogue saved');
      go('admin');
    } catch (e) {
      console.error(e);
      toast('Could not save. Check your connection.', 'warn');
    }
  });
  wrap.appendChild(save);

  if (changes.length) {
    const h = el('div', 'card');
    h.style.padding = '16px';
    h.innerHTML = html`<h4>${t('Recent changes')}</h4>${changes.map(c =>
      html`<p class="muted" style="font-size:12.5px;margin-top:6px">${String(c.changed_at).slice(0, 10)} · ${catalogAdmin.describeChange(c)}</p>`)}`;
    wrap.appendChild(h);
  }
  return wrap;
}
