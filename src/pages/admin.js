/* ============================================================
   Garage — admin: review and correct the shared car catalogue.
   Reached from the account menu (admins only) or #admin. Hiding it is
   convenience, not security: RLS refuses a non-admin's writes.
   Plain script, exercised through the boot harness.
   ============================================================ */
'use strict';

let adminModelId = null;   // the car being edited, or null for the list
let adminTab = 'proposals';    // 'proposals' | 'queue' | 'errors'

/* Failures go to the error log (plan 01-10), not the browser console */
function adminReport(message, e) {
  if (typeof errorLog !== 'undefined') errorLog.report({ source: 'client', message, stack: e && e.stack });
}

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
    if (adminModelId) { const node = await adminEditor(adminModelId); body.innerHTML = ''; body.appendChild(node); return; }
    // One fetch feeds both the badge and the Errors tab. A failure here must
    // not take the review queue down with it.
    const [errs, props, changes, models] = await Promise.all([catalogAdmin.listErrors(), catalogAdmin.listProposals(),
      catalogAdmin.listRecentChanges(), catalogAdmin.listModels().catch(() => [])]);
    const open = errs.ok ? errs.groups.filter(g => g.open).length : 0;
    const show = async () => {
      body.innerHTML = '';
      body.appendChild(adminTabs([{ id: 'proposals', label: 'Proposals', badge: props.ok ? props.rows.length : 0 },
        { id: 'queue', label: 'Review queue' }, { id: 'errors', label: 'Errors', badge: open }], adminTab,
        id => { adminTab = id; show(); }));
      try {
        body.appendChild(adminTab === 'proposals' ? adminProposals(props, models, () => renderAdminBody(body), changes)
          : adminTab === 'errors' ? adminErrors(errs, () => renderAdminBody(body)) : await adminList());
      }
      catch (e) { adminReport('admin: render failed', e); body.appendChild(el('div', 'card', html`<p style="padding:16px">${t('Could not load the catalogue.')}</p>`)); }
    };
    await show();
  } catch (e) {
    adminReport('admin: body load failed', e);
    adminNotice(body, 'Could not load the catalogue.');
  }
}

/* Small tab bar. Phases 2 and 3 add their tabs by extending the list passed
   here ({ id, label, badge }); nothing else in the bar needs to change. */
function adminTabs(tabs, active, onPick) {
  const bar = el('div', 'field-row');
  bar.setAttribute('role', 'tablist');
  tabs.forEach(tab => {
    const b = el('button', 'btn ' + (tab.id === active ? 'primary' : 'ghost'));
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', tab.id === active ? 'true' : 'false');
    b.textContent = t(tab.label) + (tab.badge ? ' (' + tab.badge + ')' : '');
    b.onclick = () => onPick(tab.id);
    bar.appendChild(b);
  });
  return bar;
}

/* Errors tab. message and stack are untrusted: textContent only, no raw markup. */
function adminErrors(res, refresh) {
  const card = el('div', 'card');
  card.style.padding = '16px';
  const note = txt => { const p = el('p', 'muted'); p.textContent = t(txt); card.appendChild(p); };
  if (!res.ok) { note('Could not load errors.'); return card; }
  if (!res.groups.length) { note('No errors logged'); return card; }
  res.groups.forEach(g => {
    const box = el('div', 'admin-item');
    const title = el('h4'); title.textContent = g.message;
    const meta = el('p', 'muted');
    meta.textContent = [t('Count') + ': ' + g.count, t('First seen') + ': ' + new Date(g.firstSeen).toLocaleString(),
      t('Last seen') + ': ' + new Date(g.lastSeen).toLocaleString(), t('Source') + ': ' + g.source].join(' · ');
    box.append(title, meta);
    if (g.stacks.length) {
      const d = el('details');
      const sm = el('summary'); sm.textContent = t('Show stacks');
      d.appendChild(sm);
      g.stacks.forEach(st => { const pre = el('pre'); pre.style.whiteSpace = 'pre-wrap'; pre.textContent = st; d.appendChild(pre); });
      box.appendChild(d);
    }
    if (g.open) {
      const b = el('button', 'btn ghost'); b.type = 'button'; b.textContent = t('Resolve');
      onAsyncClick(b, async () => {
        const r = await catalogAdmin.resolveGroup(g.key);
        if (r.ok) return refresh();
        const p = el('p', 'muted'); p.textContent = t('Could not save'); box.appendChild(p);
      });
      box.appendChild(b);
    } else {
      const p = el('p', 'muted'); p.textContent = t('Resolved'); box.appendChild(p);
    }
    card.appendChild(box);
  });
  return card;
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

const DIFF_LABELS = { interval_km: 'Dealer interval (km)', interval_months: 'Dealer interval (mo)', note: 'Note', parts: 'Parts' };

/* Drafts and recalls the intake function wrote, waiting for a decision. Every
   dynamic string is textContent; a load failure just hides the queue. */
async function adminQueue() {
  let drafts = [], recalls = [];
  try { [drafts, recalls] = await Promise.all([catalogAdmin.listDrafts(), catalogAdmin.listPendingRecalls()]); }
  catch (e) { adminReport('admin: queue load failed', e); }
  const card = el('div', 'card');
  card.style.padding = '16px';
  const h = el('h3'); h.textContent = t('Review queue');
  card.appendChild(h);
  if (!drafts.length && !recalls.length) {
    const p = el('p', 'muted'); p.textContent = t('Nothing waiting for review');
    card.appendChild(p);
  }
  const decide = (box, approve, run) => {
    const mkBtn = (label, cls, ok) => {
      const b = el('button', cls); b.type = 'button'; b.textContent = t(label);
      onAsyncClick(b, async () => { try { await run(ok); go('admin'); } catch (e) { adminReport('admin: save failed', e); toast('Could not save'); } });
      return b;
    };
    const row = el('div', 'field-row');
    row.append(mkBtn('Approve', 'btn primary', true), mkBtn('Reject', 'btn ghost', false));
    box.appendChild(row);
  };
  drafts.forEach(d => {
    const box = el('div', 'admin-item');
    const title = el('h4'); title.textContent = d.service;
    box.appendChild(title);
    const why = el('p', 'muted'); why.textContent = t(d.reason);
    box.appendChild(why);
    catalogAdmin.draftDiff(d.live, d.proposed).forEach(r => {
      const line = el('div'); line.textContent = `${t(DIFF_LABELS[r.field])}: ${r.before || '—'} → ${r.after || '—'}`;
      box.appendChild(line);
    });
    if (/^https:\/\//.test(d.source_url)) {
      const a = el('a'); a.href = d.source_url; a.rel = 'noopener'; a.target = '_blank';
      try { a.textContent = new URL(d.source_url).hostname; } catch (e) { a.textContent = d.source_url; }
      box.appendChild(a);
    }
    decide(box, true, ok => catalogAdmin.decideDraft(d.id, ok));
    card.appendChild(box);
  });
  recalls.forEach(r => {
    const box = el('div', 'admin-item');
    const title = el('h4'); title.textContent = `${r.campaign} · ${r.component}`;
    const sum = el('p', 'muted'); sum.textContent = `${(r.years || []).join(', ')} — ${r.summary}`;
    box.append(title, sum);
    decide(box, true, ok => catalogAdmin.decideRecall(r.campaign, r.car_model_id, ok));
    card.appendChild(box);
  });
  const run = el('button', 'btn ghost block'); run.type = 'button'; run.textContent = t('Check Mazda sources now');
  onAsyncClick(run, async () => {
    try { const r = await catalogAdmin.runIntake(); toast(`${r ? r.drafts : 0} ${t('new drafts')}`); go('admin'); }
    catch (e) { adminReport('admin: check sources failed', e); toast('Could not check sources'); }
  });
  card.appendChild(run);
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
  const both = el('div');
  both.append(await adminQueue(), wrap);
  return both;
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
      adminReport('admin: render failed', e);
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
