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

/* Phase 4 kinds. KIND_LABELS feeds the row sub-line and the kind filter. */
const KIND_LABELS = { schedule_item: 'Schedule item', recall: 'Recall', part: 'Part', failure: 'Known issue', car_model: 'New model' };
const NEW_KINDS = ['part', 'failure', 'car_model'];
const MODEL_ID_RE = /^[a-z0-9-]+:[a-z0-9.-]+$/; // same shape apply_proposal enforces (04-01)

function proposalSource(ev) {
  const box = el('div');
  if (ev.type === 'users') { // app-user price evidence has no quote or link (D-13)
    const u = el('p', 'muted');
    u.textContent = t('{n} app users agree (median SAR {m})').replace('{n}', String(Number(ev.users) || 0)).replace('{m}', String(Number(ev.median) || 0));
    box.appendChild(u);
    return box;
  }
  const q = el('blockquote');
  q.setAttribute('dir', 'auto');
  q.textContent = String(ev.quote || '').slice(0, 500);
  const meta = el('p', 'muted');
  const u = proposalSafeUrl(ev.url);
  // A missing fetch date drops its part rather than leaving a dangling " · "
  const tail = ['', t(PROPOSAL_TIER_LABEL[ev.tier] || 'Community'), String(ev.fetched_at || '').slice(0, 10)].filter((s, i) => !i || s).join(' · ');
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
const priceTxt = x => x && x.price != null && x.price !== '' ? x.price + ' SAR' : '';
const listTxt = v => Array.isArray(v) ? v.join(', ') : v == null ? '' : String(v);
const strTxt = v => v == null ? '' : String(v);
/* [label, before, after, indicativePill] rows for the Phase 4 kinds; all untrusted text. */
function newKindRows(kind, key, before, after) {
  const b = before || {}, a = after || {};
  if (kind === 'part') {
    const slot = x => x.tag ? (x.tag === 'OEM' ? 'OEM' : 'Alternative') : '';
    const rows = [['Part', '', String(key || '').split('|')[0]], ['Slot', '', slot(a)], ['Brand', strTxt(b.brand), strTxt(a.brand)],
      ['Part number', strTxt(b.part_no), strTxt(a.part_no)], ['Price', priceTxt(b), priceTxt(a), a.price_basis === 'indicative']];
    if (a.fitment) rows.push(['Fitment', '', listTxt(a.fitment)]);
    return rows;
  }
  if (kind === 'failure') return [['Title', strTxt(b.title), strTxt(a.title)], ['Summary', strTxt(b.summary), strTxt(a.summary)],
    ['Typical km', strTxt(b.typical_km), strTxt(a.typical_km)], ['Mentions', strTxt(b.mentions), strTxt(a.mentions)]];
  const wt = x => x.warranty_years != null || x.warranty_km != null ? strTxt(x.warranty_years) + ' / ' + strTxt(x.warranty_km) : '';
  return [['Model', strTxt(b.model), strTxt(a.model)], ['Generation', strTxt(b.generation), strTxt(a.generation)], ['Years', listTxt(b.years), listTxt(a.years)],
    ['Engine', strTxt(b.engine), strTxt(a.engine)], ['Oil (L)', strTxt(b.oil_capacity_l), strTxt(a.oil_capacity_l)],
    ['Warranty', wt(b), wt(a)], ['Markets', listTxt(b.markets), listTxt(a.markets)]];
}
function proposalSummaryLine(p, arrow) {
  if (p.kind === 'part') { const b = priceTxt(p.before), a = priceTxt(p.after); return (b || '—') + ' ' + arrow + ' ' + (a || '—'); }
  if (p.kind === 'failure') return t('Mentions') + ': ' + strTxt((p.after || {}).mentions);
  if (p.kind === 'car_model') return [(p.after || {}).model, (p.after || {}).engine].filter(Boolean).join(' · ');
  const first = catalogAdmin.draftDiff(p.before, p.after)[0];
  return first ? (first.before || '—') + ' ' + arrow + ' ' + (first.after || '—') : '';
}
function proposalDiffLines(p, arrow) {
  if (NEW_KINDS.includes(p.kind)) {
    const out = newKindRows(p.kind, p.target_key, p.before, p.after).filter(r => r[1] || r[2]).map(r => {
      const line = el('div');
      line.appendChild(document.createTextNode(t(r[0]) + ': '));
      if (r[1]) {
        const b = el('span', 'muted'); b.setAttribute('dir', 'auto'); b.textContent = r[1];
        const ar = el('span'); ar.setAttribute('aria-hidden', 'true'); ar.textContent = ' ' + arrow + ' ';
        line.append(b, ar);
      }
      const a = el('strong'); a.setAttribute('dir', 'auto'); a.textContent = r[2] || '—';
      line.appendChild(a);
      if (r[3]) { const pill = el('span', 'pill warn'); pill.textContent = t('indicative'); line.append(document.createTextNode(' '), pill); }
      return line;
    });
    if (p.kind === 'failure') {
      const hosts = [...new Set((Array.isArray(p.evidence) ? p.evidence : []).map(e => { const u = proposalSafeUrl((e || {}).url); return u ? u.hostname : null; }).filter(Boolean))];
      if (hosts.length) {
        const line = el('div'); const h = el('strong'); h.setAttribute('dir', 'ltr'); h.textContent = hosts.join(', ');
        line.append(document.createTextNode(t('Hosts') + ': '), h); out.push(line);
      }
    }
    return out;
  }
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

  const sum = el('div');
  sum.classList.add('proposal-sum');
  sum.setAttribute('role', 'button');
  sum.tabIndex = 0;
  sum.setAttribute('aria-expanded', 'false');
  sum.setAttribute('aria-controls', panelId);
  const main = el('div', 'item-main proposal-main');
  const h = el('h3'); h.setAttribute('dir', 'auto');
  h.textContent = `${proposalCarLabel(models, p.car_model_id)} · ${p.target_key}`;
  const sub = el('p');
  // FSI…PDI isolates the kind: an untranslated Latin kind ("part") otherwise turns the whole line LTR in Arabic and flips before/after.
  sub.textContent = `⁨${t(KIND_LABELS[p.kind] || p.kind)}⁩ · ${proposalSummaryLine(p, arrow)}`;
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
    const live = (NEW_KINDS.includes(p.kind)
      ? newKindRows(p.kind, p.target_key, null, r.live).filter(d => d[2]).map(d => t(d[0]) + ' ' + d[2])
      : catalogAdmin.draftDiff(null, r.live).map(d => t(DIFF_LABELS[d.field]) + ' ' + d.after)).join(', ') || '—';
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
  const numF = x => { const n = parseFloat(x); return Number.isFinite(n) && n >= 0 ? n : null; }; // SAR prices keep decimals
  // Per-kind edit fields and the p_edit value they produce; schedule_item and recall keep the original form.
  const editSpec = v => {
    if (p.kind === 'part') return {
      rows: [field('Brand', html`<input data-k="brand" value="${v.brand ?? ''}">`),
        field('Part number', html`<input data-k="part_no" value="${v.part_no ?? ''}">`),
        field('Price (SAR)', html`<input data-k="price" type="number" min="0" step="any" value="${v.price ?? ''}">`)],
      val: f => Object.assign({}, v, { brand: String(f.brand || '').trim(), part_no: String(f.part_no || '').trim(), price: numF(f.price) }) };
    if (p.kind === 'failure') return {
      rows: [field('Title', html`<input data-k="title" value="${v.title ?? ''}">`),
        field('Summary', html`<textarea data-k="summary" rows="2">${v.summary || ''}</textarea>`),
        field('Typical km', html`<input data-k="typical_km" type="number" min="0" value="${v.typical_km ?? ''}">`)],
      val: f => Object.assign({}, v, { title: String(f.title || '').trim(), summary: String(f.summary || '').trim(), typical_km: catalogAdmin.num(f.typical_km) }) };
    if (p.kind === 'car_model') return {
      rows: [field('Id', html`<input data-k="id" dir="ltr" value="${p.target_key ?? ''}">`),
        field('Generation', html`<input data-k="generation" value="${v.generation ?? ''}">`),
        field('Markets', html`<input data-k="markets" value="${listTxt(v.markets)}">`)],
      val: f => Object.assign({}, v, { id: String(f.id || '').trim(), generation: String(f.generation || '').trim(),
        markets: String(f.markets || '').split(',').map(x => x.trim()).filter(Boolean) }),
      check: val => MODEL_ID_RE.test(val.id) };
    const r = el('div', 'field-row');
    r.append(field('Dealer interval (km)', html`<input data-k="interval_km" type="number" min="0" value="${v.interval_km ?? ''}">`),
      field('Dealer interval (mo)', html`<input data-k="interval_months" type="number" min="0" value="${v.interval_months ?? ''}">`));
    return {
      rows: [r,
        field('Note', html`<textarea data-k="note" rows="2">${v.note || ''}</textarea>`),
        field('Parts (name | part number | qty, one per line)', html`<textarea data-k="parts" rows="2">${catalogAdmin.formatParts(v.parts)}</textarea>`)],
      val: f => ({ interval_km: catalogAdmin.num(f.interval_km), interval_months: catalogAdmin.num(f.interval_months),
        note: String(f.note || '').trim(), parts: catalogAdmin.parseParts(f.parts) }) };
  };
  edit.onclick = () => {
    const spec = editSpec(state.prefill || {});
    form.textContent = '';
    const go = el('button', 'btn primary'); go.type = 'button'; go.textContent = t('Approve edited value');
    const cancel = el('button', 'btn ghost'); cancel.type = 'button'; cancel.textContent = t('Cancel');
    cancel.onclick = () => { form.hidden = true; };
    onAsyncClick(go, async () => {
      clearMsgs();
      const f = {};
      form.querySelectorAll('[data-k]').forEach(i => { f[i.dataset.k] = i.value; });
      const val = spec.val(f);
      if (spec.check && !spec.check(val)) {
        const err = el('p', 'muted save-error'); err.setAttribute('role', 'alert');
        err.textContent = t('Invalid id. Use lowercase letters, digits and hyphens: maker:model-year');
        panel.appendChild(err);
        return;
      }
      settle(await catalogAdmin.applyProposal(p.id, val, state.seenHash));
    });
    form.append(...spec.rows, go, cancel);
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
  card.classList.add('pad-16', 'mt-12');
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
  card.classList.add('pad-16');
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
  fcard.classList.add('pad-16', 'mb-12');
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
    sel('kind', 'Kind', opts.kinds, v => t(KIND_LABELS[v] || v)),
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
      const bb = el('button', 'btn primary block mb-12'); bb.type = 'button';
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
    const list = el('div', 'list proposal-list');
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
