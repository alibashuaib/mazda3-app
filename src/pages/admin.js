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
  v.appendChild(pageIntro('Advanced', 'Review and correct the shared car catalogue.'));
  const body = el('div');
  body.innerHTML = html`<p class="muted">${t('Loading…')}</p>`;
  v.appendChild(body);
  renderAdminBody(body);
  return v;
}

/* The Advanced page's data, loaded once per signed-in user and reused by every
   tab switch and boot re-render. It is reloaded only by the Refresh button or
   after a write (adminReload), not on every render. */
let adminLoaded = null;   // { uid, p } — p resolves to the bundle
function adminBundle() {
  const uid = account.user().id;
  if (!adminLoaded || adminLoaded.uid !== uid) {
    const p = (async () => {
      if (!(await catalogAdmin.isAdmin())) return { admin: false };
      const [errs, props, changes, models, status, domains, unverified, drafts, recalls] = await Promise.all([catalogAdmin.listErrors(), catalogAdmin.listProposals(),
        catalogAdmin.listRecentChanges(), catalogAdmin.listModels().catch(() => []),
        catalogAdmin.autopilotStatus(), catalogAdmin.listDomains(), catalogAdmin.listUnverified(),
        // The review queue's own lists: a failure here only empties that part, never the whole page.
        catalogAdmin.listDrafts().catch(e => { adminReport('admin: queue load failed', e); return []; }),
        catalogAdmin.listPendingRecalls().catch(e => { adminReport('admin: queue load failed', e); return []; })]);
      return { admin: true, errs, props, changes, models, status, domains, unverified, drafts, recalls };
    })();
    adminLoaded = { uid, p };
    p.catch(() => { if (adminLoaded && adminLoaded.p === p) adminLoaded = null; });   // a failed load is retried next time
  }
  return adminLoaded.p;
}
/* Drops the cached data and redraws; used by Refresh and after every write. */
function adminReload() {
  adminLoaded = null;
  go('admin');
}

function adminNotice(body, msg) {
  body.innerHTML = html`<div class="card pad-16">${t(msg)}</div>`;
}

async function renderAdminBody(body) {
  if (!catalogAdmin.available()) return adminNotice(body, 'Admin needs an internet connection.');
  // The stored session is still being read: wait, rather than offer a sign-in form to someone already signed in.
  if (!account.restored()) return;
  if (!account.user()) return adminNotice(body, 'Sign in to use the app.');   // the app-wide sign-in gate normally catches this first
  try {
    const bundle = await adminBundle();
    if (!bundle.admin) return adminNotice(body, 'This account is not an admin.');
    if (adminModelId) { const node = await adminEditor(adminModelId); body.innerHTML = ''; body.appendChild(node); return; }
    // One fetch feeds both the badge and the Errors tab. A failure here must
    // not take the review queue down with it.
    const { errs, props, changes, models, status, domains, unverified } = bundle;
    const refresh = () => adminReload();
    const open = errs.ok ? errs.groups.filter(g => g.open).length : 0;
    const show = async () => {
      body.innerHTML = '';
      // Banner sits above the tab strip so a failed or overdue run is visible on every tab (REV-08).
      const banner = status.ok ? adminBanner(status.runs) : null;
      const toolbar = el('div', 'admin-toolbar');
      const refreshBtn = el('button', 'btn ghost'); refreshBtn.type = 'button'; refreshBtn.textContent = t('Refresh');
      refreshBtn.onclick = () => adminReload();   // the only way to re-fetch without a write
      toolbar.appendChild(refreshBtn);
      // With a banner, Refresh sits beside it on the same row; without one it keeps its own row.
      if (banner) { toolbar.classList.add('with-banner'); toolbar.insertBefore(banner, refreshBtn); }
      body.appendChild(toolbar);
      body.appendChild(adminTabs([{ id: 'proposals', label: 'Proposals', badge: props.ok ? props.rows.length : 0 },
        { id: 'queue', label: 'Review queue' }, { id: 'errors', label: 'Errors', badge: open }], adminTab,
        id => { adminTab = id; show(); }));
      try {
        // Two columns on wide screens (autopilot | proposals); a lone child spans both. See .admin-cols.
        const cols = el('div', 'admin-cols');
        if (adminTab === 'proposals') cols.appendChild(adminAutopilot({ status, domains, unverified, models }, refresh));
        cols.appendChild(adminTab === 'proposals' ? adminProposals(props, models, refresh, changes)
          : adminTab === 'errors' ? adminErrors(errs, () => adminReload()) : adminList(bundle));
        body.appendChild(cols);
      }
      catch (e) { adminReport('admin: render failed', e); body.appendChild(el('div', 'card', html`<p class="pad-16">${t('Could not load the catalogue.')}</p>`)); }
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
  const bar = el('div', 'admin-tabs');
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
  card.classList.add('pad-16');
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
      g.stacks.forEach(st => { const pre = el('pre'); pre.classList.add('pre-wrap'); pre.textContent = st; d.appendChild(pre); });
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

const DIFF_LABELS = { interval_km: 'Dealer interval (km)', interval_months: 'Dealer interval (mo)', severe_km: 'Severe km', severe_months: 'Severe months', note: 'Note', parts: 'Parts' };

/* Drafts and recalls the intake function wrote, waiting for a decision. Every
   dynamic string is textContent; a load failure just hides the queue. */
/* drafts and recalls come from the page's cached bundle, so switching to this tab fetches nothing. */
function adminQueue(drafts, recalls) {
  const card = el('div', 'card');
  card.classList.add('pad-16');
  const h = el('h3'); h.textContent = t('Review queue');
  card.appendChild(h);
  if (!drafts.length && !recalls.length) {
    const p = el('p', 'muted'); p.textContent = t('Nothing waiting for review');
    card.appendChild(p);
  }
  const decide = (box, approve, run) => {
    const mkBtn = (label, cls, ok) => {
      const b = el('button', cls); b.type = 'button'; b.textContent = t(label);
      onAsyncClick(b, async () => { try { await run(ok); adminReload(); } catch (e) { adminReport('admin: save failed', e); toast('Could not save'); } });
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
    try { const r = await catalogAdmin.runIntake(); toast(`${r ? r.drafts : 0} ${t('new drafts')}`); adminReload(); }
    catch (e) { adminReport('admin: check sources failed', e); toast('Could not check sources'); }
  });
  card.appendChild(run);
  return card;
}

function adminList(bundle) {
  const models = bundle.models;
  // The full car list is hidden; only cars waiting for review show, since this is the only way into their editor.
  const ordered = models.filter(m => m.status === 'draft');
  const wrap = el('div', 'card');
  ordered.forEach(m => {
    const it = el('div', 'item');
    it.innerHTML = html`<div class="item-main"><h3>Mazda ${m.model} · ${m.generation}</h3><p>${m.engine}</p></div>
      <div class="item-side">${m.status === 'draft' ? html`<span class="pill warn">${t('Needs review')}</span>` : ''}</div>`;
    it.onclick = () => { adminModelId = m.id; go('admin'); };
    wrap.appendChild(it);
  });
  const both = el('div');
  both.append(adminQueue(bundle.drafts, bundle.recalls));
  if (ordered.length) both.appendChild(wrap);
  return both;
}

async function adminEditor(id) {
  const { model, items, changes } = await catalogAdmin.loadModel(id);
  const wrap = el('div');
  const back = el('button', 'btn ghost', html`← ${t('All cars')}`);
  back.onclick = () => { adminModelId = null; go('admin'); };
  wrap.appendChild(back);

  const head = el('div', 'card');
  head.classList.add('pad-16');
  head.innerHTML = html`<h3>Mazda ${model.model} · ${model.generation} · ${model.engine}</h3>`;
  const wr = el('div', 'field-row');
  wr.append(
    field('Warranty (years)', html`<input id="adm_wy" type="number" min="0" value="${model.warranty_years ?? ''}">`),
    field('Warranty (km)', html`<input id="adm_wkm" type="number" min="0" value="${model.warranty_km ?? ''}">`));
  head.appendChild(wr);
  wrap.appendChild(head);

  const list = el('div', 'card');
  list.classList.add('pad-16');
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
      adminReload();
    } catch (e) {
      adminReport('admin: render failed', e);
      toast('Could not save. Check your connection.', 'warn');
    }
  });
  wrap.appendChild(save);

  if (changes.length) {
    const h = el('div', 'card');
    h.classList.add('pad-16');
    h.innerHTML = html`<h4>${t('Recent changes')}</h4>${changes.map(c =>
      html`<p class="muted fs-12 mt-8">${String(c.changed_at).slice(0, 10)} · ${catalogAdmin.describeChange(c)}</p>`)}`;
    wrap.appendChild(h);
  }
  return wrap;
}
