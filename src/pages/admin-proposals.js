/* ============================================================
   Garage — admin: Proposals tab (the approval gate's review queue).
   Every field here (target, note, reason, quote, url) came from scraped or
   LLM text and is untrusted: textContent only, never raw markup. A source
   link is only built for https URLs that parse; the link text is the
   hostname, never the raw URL. Plain script, exercised through the boot
   harness. Loaded after admin.js (uses DIFF_LABELS and adminReport).
   ============================================================ */
'use strict';

const PROPOSAL_TIER_LABEL = { official: 'Official', secondary: 'Secondary', community: 'Community' };

/* Survives refresh() after an approve, like adminTab. */
let proposalFilter = { car: '', kind: '', tier: '', run: '' };

/* Result of the last bulk approve, shown once above the list after the refetch. */
let lastBulk = null;

function proposalCarLabel(models, id) {
  const m = (models || []).find(x => x.id === id);
  return m ? `${m.model} ${m.generation}` : String(id || '');
}

/* null when the URL is not a safe https link; otherwise the parsed URL. */
function proposalSafeUrl(url) {
  if (!/^https:\/\//i.test(String(url || ''))) return null;
  try { const u = new URL(url); return u.protocol === 'https:' ? u : null; } catch (e) { return null; }
}

function proposalSource(ev) {
  const box = el('div');
  const q = el('blockquote');
  q.setAttribute('dir', 'auto');
  q.textContent = String(ev.quote || '').slice(0, 500);
  const meta = el('p', 'muted');
  const u = proposalSafeUrl(ev.url);
  const tail = ' · ' + t(PROPOSAL_TIER_LABEL[ev.tier] || 'Community') + ' · ' + String(ev.fetched_at || '').slice(0, 10);
  if (u) {
    const a = el('a');
    a.href = u.href; a.rel = 'noopener noreferrer'; a.target = '_blank';
    a.setAttribute('dir', 'ltr');
    a.textContent = u.hostname;
    meta.append(a, document.createTextNode(tail));
  } else {
    meta.textContent = t('Invalid source link') + tail;
  }
  box.append(q, meta);
  return box;
}

/* Severe km/months are separate rows via draftDiff + DIFF_LABELS (D-09). A recall
   proposal has no plan fields: show its campaign, component and summary instead. */
const RECALL_LABELS = { campaign: 'Campaign', component: 'Component', summary: 'Summary' };
function proposalDiffLines(p, arrow) {
  if (p.kind === 'recall') {
    // the campaign id is the proposal's target_key (apply_proposal writes it there), not a field of after
    const a = Object.assign({}, p.after, p.target_key ? { campaign: p.target_key } : {});
    return Object.keys(RECALL_LABELS).filter(k => a[k] != null && a[k] !== '').map(k => {
      const line = el('div');
      const v = el('strong'); v.setAttribute('dir', 'auto'); v.textContent = String(a[k]);
      line.append(document.createTextNode(t(RECALL_LABELS[k]) + ': '), v);
      return line;
    });
  }
  return catalogAdmin.draftDiff(p.before, p.after).map(r => {
    const line = el('div');
    const lab = document.createTextNode(t(DIFF_LABELS[r.field]) + ': ');
    const b = el('span', 'muted'); b.setAttribute('dir', 'ltr'); b.textContent = r.before || '—';
    const ar = el('span'); ar.setAttribute('aria-hidden', 'true'); ar.textContent = ' ' + arrow + ' ';
    const a = el('strong'); a.setAttribute('dir', 'ltr'); a.textContent = r.after || '—';
    line.append(lab, b, ar, a);
    return line;
  });
}

function proposalRow(p, models, refresh) {
  const rtl = document.documentElement.getAttribute('dir') === 'rtl';
  const arrow = rtl ? '←' : '→';
  const row = el('div', 'item proposal-row');
  const panelId = 'proposal-panel-' + p.id;
  const first = catalogAdmin.draftDiff(p.before, p.after)[0];

  const sum = el('div');
  sum.style.cssText = 'display:flex;justify-content:space-between;gap:12px;cursor:pointer';
  sum.setAttribute('role', 'button');
  sum.tabIndex = 0;
  sum.setAttribute('aria-expanded', 'false');
  sum.setAttribute('aria-controls', panelId);
  const main = el('div', 'item-main');
  const h = el('h3'); h.setAttribute('dir', 'auto');
  h.textContent = `${proposalCarLabel(models, p.car_model_id)} · ${p.target_key}`;
  const sub = el('p');
  sub.textContent = `${t(p.kind === 'schedule_item' ? 'Schedule item' : p.kind)} · ${first ? (first.before || '—') + ' ' + arrow + ' ' + (first.after || '—') : ''}`;
  main.append(h, sub);
  const side = el('div', 'item-side');
  const conf = catalogAdmin.confidenceLabel(p.confidence_tier);
  const pill = el('span', 'pill ' + conf.cls); pill.textContent = t(conf.text);
  const run = el('div', 'sub'); run.textContent = t('Run {n}').replace('{n}', p.run_id == null ? '—' : String(p.run_id));
  side.append(pill, run);
  sum.append(main, side);

  const panel = el('div', 'proposal-panel');
  panel.id = panelId;
  panel.hidden = true;
  const toggle = () => {
    const open = sum.getAttribute('aria-expanded') !== 'true';
    sum.setAttribute('aria-expanded', open ? 'true' : 'false');
    panel.hidden = !open;
  };
  sum.onclick = () => toggle();
  sum.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } };

  const diff = el('div');
  proposalDiffLines(p, arrow).forEach(l => diff.appendChild(l));
  if (p.reason) { const r = el('p', 'muted'); r.setAttribute('dir', 'auto'); r.textContent = p.reason; diff.appendChild(r); }

  const f = p.confidence_factors || {};
  const why = el('div');
  const wh = el('h4'); wh.textContent = t('Why this confidence');
  const ul = el('ul');
  const li = s => { const x = el('li'); x.textContent = s; ul.appendChild(x); };
  li(t('Best source: {tier}').replace('{tier}', t(PROPOSAL_TIER_LABEL[f.best_tier] || 'Community')));
  li(t('Agreeing sources: {n}').replace('{n}', String(Number(f.domains) || 0)));
  if (f.change_pct != null) li(t('Change size: {n}%').replace('{n}', String(Number(f.change_pct) || 0)));
  why.append(wh, ul);

  const src = el('div');
  const sh = el('h4'); sh.textContent = t('Sources');
  src.appendChild(sh);
  (Array.isArray(p.evidence) ? p.evidence : []).slice(0, 10).forEach(ev => src.appendChild(proposalSource(ev || {})));

  // seenHash is the live hash the owner was shown in a stale alert; prefill is what Edit starts from.
  const state = { seenHash: null, prefill: p.after };
  const clearMsgs = () => panel.querySelectorAll('.save-error, .proposal-alert').forEach(x => x.remove());
  const stale = r => {
    state.seenHash = r.live_hash || null;
    state.prefill = r.live || {};
    const live = catalogAdmin.draftDiff(null, r.live).map(d => t(DIFF_LABELS[d.field]) + ' ' + d.after).join(', ') || '—';
    const al = el('div', 'proposal-alert save-error'); al.setAttribute('role', 'alert');
    const ah = el('strong'); ah.textContent = t('Live value changed');
    const ap = el('p', 'muted'); ap.setAttribute('dir', 'auto');
    ap.textContent = t('The live value is now {live}. Reject this proposal or edit it against the live value.').replace('{live}', live);
    al.append(ah, ap);
    panel.appendChild(al);
  };
  // One result handler for plain and edited approve; the row stays pending on stale (CONTEXT A3).
  const settle = r => {
    if (r.ok) { toast(t('Approved')); return refresh(); }
    clearMsgs();
    if (r.error === 'stale') return stale(r);
    const err = el('p', 'muted save-error'); err.setAttribute('role', 'alert');
    err.textContent = t('Could not save. Check your connection.');
    panel.appendChild(err);
  };

  const actions = el('div', 'field-row');
  const approve = el('button', 'btn primary'); approve.type = 'button';
  approve.textContent = t('Approve');
  approve.setAttribute('aria-label', t('Approve {target}').replace('{target}', p.target_key));
  onAsyncClick(approve, async () => { clearMsgs(); settle(await catalogAdmin.applyProposal(p.id, null, null)); });
  const edit = el('button', 'btn ghost'); edit.type = 'button';
  edit.textContent = t('Edit');
  edit.setAttribute('aria-label', t('Edit {target}').replace('{target}', p.target_key));
  const rej = el('button', 'btn ghost reject'); rej.type = 'button';
  rej.textContent = t('Reject');
  rej.setAttribute('aria-label', t('Reject {target}').replace('{target}', p.target_key));
  actions.append(approve, edit, rej);

  const form = el('div', 'proposal-edit');
  form.hidden = true;
  edit.onclick = () => {
    const v = state.prefill || {};
    form.textContent = '';
    const r = el('div', 'field-row');
    r.append(
      field('Dealer interval (km)', html`<input data-k="interval_km" type="number" min="0" value="${v.interval_km ?? ''}">`),
      field('Dealer interval (mo)', html`<input data-k="interval_months" type="number" min="0" value="${v.interval_months ?? ''}">`));
    const go = el('button', 'btn primary'); go.type = 'button'; go.textContent = t('Approve edited value');
    const cancel = el('button', 'btn ghost'); cancel.type = 'button'; cancel.textContent = t('Cancel');
    cancel.onclick = () => { form.hidden = true; };
    onAsyncClick(go, async () => {
      clearMsgs();
      const f = {};
      form.querySelectorAll('[data-k]').forEach(i => { f[i.dataset.k] = i.value; });
      const val = { interval_km: catalogAdmin.num(f.interval_km), interval_months: catalogAdmin.num(f.interval_months),
        note: String(f.note || '').trim(), parts: catalogAdmin.parseParts(f.parts) };
      settle(await catalogAdmin.applyProposal(p.id, val, state.seenHash));
    });
    form.append(r,
      field('Note', html`<textarea data-k="note" rows="2">${v.note || ''}</textarea>`),
      field('Parts (name | part number | qty, one per line)', html`<textarea data-k="parts" rows="2">${catalogAdmin.formatParts(v.parts)}</textarea>`),
      go, cancel);
    form.hidden = false;
  };

  // Inline two-step reject (no modal): the reason is optional, capped at 300 like the DB.
  const rform = el('div', 'proposal-reject');
  rform.hidden = true;
  rej.onclick = () => {
    rform.textContent = '';
    const ta = field('Reason (optional)', html`<textarea data-k="reason" rows="2" maxlength="300" placeholder="${t('Why is this wrong or not useful?')}"></textarea>`);
    const go = el('button', 'btn ghost reject'); go.type = 'button'; go.textContent = t('Reject proposal');
    const cancel = el('button', 'btn ghost'); cancel.type = 'button'; cancel.textContent = t('Cancel');
    cancel.onclick = () => { rform.hidden = true; };
    onAsyncClick(go, async () => {
      clearMsgs();
      const r = await catalogAdmin.rejectProposal(p.id, ta.querySelector('textarea').value);
      if (r.ok) { toast(t('Rejected')); return refresh(); }
      const err = el('p', 'muted save-error'); err.setAttribute('role', 'alert');
      err.textContent = t('Could not save. Check your connection.');
      panel.appendChild(err);
    });
    rform.append(ta, go, cancel);
    rform.hidden = false;
  };

  panel.append(diff, why, src, actions, form, rform);
  row.append(sum, panel);
  return row;
}

/* Recent approvals: last 30 audited changes, one-click revert (no confirmation,
   CONTEXT: a revert is itself an audited change and can be reverted). */
function recentChangesCard(changes, models, refresh) {
  const card = el('div', 'card');
  card.style.cssText = 'padding:16px;margin-top:12px';
  const h = el('h3'); h.textContent = t('Recent approvals');
  card.appendChild(h);
  if (!changes.ok) {
    const p = el('p', 'muted'); p.textContent = t('Could not load proposals. Check your connection and try again.');
    card.appendChild(p);
    return card;
  }
  if (!changes.rows.length) {
    const p = el('p', 'muted'); p.textContent = t('No approvals yet');
    card.appendChild(p);
    return card;
  }
  const arrow = document.documentElement.getAttribute('dir') === 'rtl' ? '←' : '→';
  const list = el('div', 'list');
  changes.rows.forEach(c => {
    const row = el('div', 'item');
    const main = el('div', 'item-main');
    const title = el('h3'); title.setAttribute('dir', 'auto');
    title.textContent = `${c.reverts_id ? t('Reverted:') + ' ' : ''}${String(c.made_at || '').slice(0, 10)} · ${proposalCarLabel(models, c.car_model_id)} · ${c.row_key}`;
    const first = c.before && c.after ? catalogAdmin.draftDiff(c.before, c.after)[0] : null;
    const sub = el('p', 'muted'); sub.setAttribute('dir', 'ltr');
    sub.textContent = first ? `${first.before || '—'} ${arrow} ${first.after || '—'}` : '—';
    main.append(title, sub);
    const side = el('div', 'item-side');
    const b = el('button', 'btn ghost'); b.type = 'button';
    b.textContent = t('Revert');
    b.setAttribute('aria-label', t('Revert {target}').replace('{target}', c.row_key));
    onAsyncClick(b, async () => {
      row.querySelectorAll('.save-error').forEach(x => x.remove());
      const r = await catalogAdmin.revertChange(c.id);
      if (r.ok) { toast(t('Reverted')); return refresh(); }
      const err = el('p', 'muted save-error'); err.setAttribute('role', 'alert');
      err.textContent = t(r.error === 'drifted' ? 'Newer change exists. Revert that one first.' : 'Could not save. Check your connection.');
      row.appendChild(err);
    });
    side.appendChild(b);
    row.append(main, side);
    list.appendChild(row);
  });
  card.appendChild(list);
  return card;
}

/* res is listProposals() output; models is listModels() or []; changes is listRecentChanges(). */
function adminProposals(res, models, refresh, changes) {
  const box = el('div');
  box.append(adminProposalsQueue(res, models, refresh), recentChangesCard(changes || { ok: true, rows: [] }, models, refresh));
  return box;
}

function adminProposalsQueue(res, models, refresh) {
  const card = el('div', 'card');
  card.style.padding = '16px';
  if (!res.ok) {
    const p = el('p', 'muted'); p.textContent = t('Could not load proposals. Check your connection and try again.');
    const b = el('button', 'btn ghost'); b.type = 'button'; b.textContent = t('Try again');
    b.onclick = () => refresh();
    card.append(p, b);
    return card;
  }
  if (!res.rows.length) {
    const h = el('h3'); h.textContent = t('No proposals waiting');
    const p = el('p', 'muted');
    p.textContent = t('New findings from the autopilot will appear here for your approval. Nothing reaches users until you approve it.');
    card.append(h, p);
    return card;
  }
  const wrap = el('div');
  const opts = catalogAdmin.proposalFilterOptions(res.rows);
  const fcard = el('div', 'card');
  fcard.style.cssText = 'padding:16px;margin-bottom:12px';
  const frow = el('div', 'field-row proposal-filters');
  const sel = (key, label, values, labelOf) => {
    const f = field(label, html`<select data-f="${key}"></select>`);
    const s = f.querySelector('select');
    [['', t('All')]].concat(values.map(v => [v, labelOf(v)])).forEach(([v, text]) => {
      const o = el('option'); o.value = v; o.textContent = text; s.appendChild(o);
    });
    s.value = proposalFilter[key];
    s.onchange = () => { proposalFilter[key] = s.value; paint(); };
    return f;
  };
  frow.append(
    sel('car', 'Car', opts.cars, v => proposalCarLabel(models, v)),
    sel('kind', 'Kind', opts.kinds, v => t(v === 'schedule_item' ? 'Schedule item' : v)),
    sel('tier', 'Confidence', opts.tiers, v => t(catalogAdmin.confidenceLabel(v).text)),
    sel('run', 'Run', opts.runs, v => t('Run {n}').replace('{n}', v)));
  fcard.appendChild(frow);
  const clear = el('button', 'btn ghost'); clear.type = 'button'; clear.textContent = t('Clear filters');
  clear.onclick = () => {
    proposalFilter = { car: '', kind: '', tier: '', run: '' };
    fcard.querySelectorAll('select').forEach(s => { s.value = ''; });
    paint();
  };
  const bulkBox = el('div');
  const body = el('div');
  wrap.append(fcard, bulkBox, body);
  if (lastBulk) {
    const b = lastBulk; lastBulk = null;
    const al = el('div', 'proposal-alert' + (b.failed.length ? ' fail' : '')); al.setAttribute('role', 'alert');
    const ah = el('strong'); ah.textContent = t('{x} approved, {y} failed').replace('{x}', String(b.approved)).replace('{y}', String(b.failed.length));
    al.appendChild(ah);
    b.failed.forEach(f => { const l = el('p', 'muted'); l.setAttribute('dir', 'auto'); l.textContent = f.line; al.appendChild(l); });
    wrap.insertBefore(al, bulkBox);
  }
  const safeRefresh = () => { try { refresh(); } catch (e) { adminReport('admin: proposals refresh failed', e); } };
  const bulkAsk = rows => {
    const ids = rows.map(p => p.id), n = ids.length;
    const labels = {};
    rows.forEach(p => { labels[p.id] = `${proposalCarLabel(models, p.car_model_id)} · ${p.target_key}`; });
    openModal(t('Approve high-confidence proposals'), null, card => {
      const msg = el('p'); msg.textContent = t('Approve {n} high-confidence proposals? Each one changes the live catalogue for all users.').replace('{n}', String(n));
      const cancel = el('button', 'btn ghost'); cancel.type = 'button'; cancel.textContent = t('Cancel');
      cancel.onclick = () => closeModal();
      const go = el('button', 'btn primary'); go.type = 'button'; go.textContent = t('Approve {n}').replace('{n}', String(n));
      onAsyncClick(go, async () => {
        go.textContent = t('Approving…');
        const r = await catalogAdmin.applyProposals(ids, 'high');
        closeModal();
        if (!r.ok) { toast(t('Could not save. Check your connection.'), 'warn'); return; }
        const sum = catalogAdmin.bulkSummary(r.results);
        const why = { stale: 'Live value changed', not_high: 'No longer high confidence' };
        lastBulk = { approved: sum.approved, failed: sum.failed.map(f => ({ line: `${labels[f.id] || f.id}: ${t(why[f.error] || 'Could not apply')}` })) };
        safeRefresh();
      });
      card.append(msg, cancel, go);
    });
  };
  function paint() {
    body.textContent = '';
    bulkBox.textContent = '';
    const high = catalogAdmin.filterProposals(res.rows, proposalFilter).filter(p => p.confidence_tier === 'high');
    if (high.length) {
      const bb = el('button', 'btn primary block'); bb.type = 'button';
      bb.textContent = t('Approve {n} high-confidence').replace('{n}', String(high.length));
      bb.onclick = () => bulkAsk(high);
      bulkBox.appendChild(bb);
    }
    const active = Object.values(proposalFilter).some(Boolean);
    if (active) fcard.appendChild(clear); else clear.remove();
    const rows = catalogAdmin.filterProposals(res.rows, proposalFilter);
    if (!rows.length) {
      const m = el('p', 'muted'); m.textContent = t('No proposals match these filters');
      body.appendChild(m);
      return;
    }
    const list = el('div', 'list');
    rows.forEach(p => list.appendChild(proposalRow(p, models, safeRefresh)));
    body.appendChild(list);
  }
  paint();
  if (res.capped) {
    const m = el('p', 'muted');
    m.textContent = t('Showing the newest 500. Approve or reject some to see more.');
    wrap.appendChild(m);
  }
  return wrap;
}
