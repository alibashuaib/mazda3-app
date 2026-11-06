/* ============================================================
   Garage — admin: monthly autopilot card (banner, kill switch, last run
   report, source domains, unverified items, Check now with cost preview).
   Domains, skipped-source text, errors and quotes are scraped or LLM text and
   untrusted: textContent only. Plain script, exercised through the boot
   harness. Loaded after admin.js and before admin-proposals.js.
   ============================================================ */
'use strict';

const AUTOPILOT_BANNER_TEXT = {
  failed: 'The last monthly autopilot run failed.',
  overdue: 'The monthly autopilot has not finished a run in over 35 days.',
  never: 'The monthly autopilot has not completed a run yet.'
};

/* Shown above the tab strip on every admin tab (REV-08). runs is listRuns() rows or null. */
function adminBanner(runs) {
  const b = catalogAdmin.bannerState(runs || [], Date.now());
  if (!b.show) return null;
  const box = el('div', 'proposal-alert fail');
  box.setAttribute('role', 'alert');
  box.textContent = t(AUTOPILOT_BANNER_TEXT[b.reason] || AUTOPILOT_BANNER_TEXT.never);
  return box;
}

function apLine(parent, text, cls) {
  const p = el('p', cls || 'muted'); p.setAttribute('dir', 'auto'); p.textContent = text; parent.appendChild(p); return p;
}
function apButton(label, cls, fn) {
  const b = el('button', cls); b.type = 'button'; b.textContent = label;
  onAsyncClick(b, fn); return b;
}
/* One number with its label, for the stat grids. Text only. */
function apStat(label, value) {
  const d = el('div', 'ap-stat');
  const v = el('span', 'ap-stat-value'); v.textContent = String(value); d.appendChild(v);
  const l = el('span'); l.textContent = label; d.appendChild(l);
  return d;
}
/* A titled block inside the card. */
function apSection(title) {
  const s = el('section', 'ap-section');
  const h = el('h4'); h.textContent = title; s.appendChild(h);
  return s;
}
const apSkipText = v => typeof v === 'string' ? v : v && typeof v === 'object'
  ? ([v.url || v.host, v.reason].filter(Boolean).join(' — ') || JSON.stringify(v)) : String(v);

function apReport(run) {
  const box = apSection(t('Last run report'));
  const rep = run && run.report;
  if (!run || !rep) { apLine(box, t('No run report yet')); return box; }
  apLine(box, `${String(run.started_at || '').slice(0, 10)} · ${run.kind} · ${run.status}`);
  const grid = el('div', 'ap-stats');
  grid.append(
    apStat(t('Cost'), `${Math.round((Number(rep.cost_sar) || 0) * 100) / 100} SAR`),
    apStat(t('Searches'), Number(rep.searches) || 0),
    apStat(t('LLM calls'), Number(rep.llm_calls) || 0));
  box.appendChild(grid);
  Object.entries(rep.proposals || {}).forEach(([kind, c]) => {
    const n = c && typeof c === 'object' ? c : {};
    apLine(box, `${kind}: ${Number(n.inserted) || 0} ${t('new')}, ${Number(n.noop) || 0} ${t('unchanged')}`);
  });
  (Array.isArray(rep.failed_jobs) ? rep.failed_jobs : []).forEach(j => apLine(box, `${t('Error')}: ${j.car} ${j.stage} ${j.error}`, 'muted save-error'));
  const sk = Array.isArray(rep.skipped_sources) ? rep.skipped_sources : [];
  if (sk.length) {
    const d = el('details'); const sm = el('summary'); sm.textContent = `${t('Skipped sources')} (${sk.length})`; d.appendChild(sm);
    sk.slice(0, 50).forEach(v => apLine(d, apSkipText(v)));
    box.appendChild(d);
  }
  return box;
}

function apBanConfirm(host, refresh) {
  openModal(t('Ban domain'), null, card => {
    const msg = el('p');
    msg.textContent = t('Ban {host}? This is permanent and automatically rejects its pending proposals.').replace('{host}', host);
    const cancel = el('button', 'btn ghost'); cancel.type = 'button'; cancel.textContent = t('Cancel');
    cancel.onclick = () => closeModal();
    const go = apButton(t('Ban'), 'btn ghost reject', async () => {
      const r = await catalogAdmin.banDomain(host);
      closeModal();
      if (r.ok) { toast(t('Banned')); return refresh(); }
      toast(t('Could not save. Check your connection.'), 'warn');
    });
    card.append(msg, cancel, go);
  });
}

function apDomains(res, refresh) {
  const box = apSection(t('Source domains'));
  if (!res.ok) { apLine(box, t('Could not load.')); return box; }
  if (!res.rows.length) { apLine(box, t('No domains yet')); return box; }
  res.rows.forEach(d => {
    const row = el('div', 'ap-row');
    const left = el('div', 'ap-row-main');
    const name = el('strong'); name.setAttribute('dir', 'ltr'); name.textContent = d.host;
    const st = el('span', 'pill ' + (d.status === 'pending' ? 'warn' : d.status === 'banned' ? 'danger' : 'ok'));
    st.textContent = t(d.status === 'pending' ? 'Pending' : d.status === 'banned' ? 'Banned' : 'Approved');
    left.append(name, st);
    const actions = el('div', 'ap-row-actions');
    if (d.status !== 'approved') actions.appendChild(apButton(t('Approve'), 'btn ghost', async () => {
      const r = await catalogAdmin.approveDomain(d.host);
      if (r.ok) return refresh();
      toast(t('Could not save. Check your connection.'), 'warn');
    }));
    if (d.status !== 'banned') {
      const ban = el('button', 'btn ghost reject'); ban.type = 'button'; ban.textContent = t('Ban');
      ban.setAttribute('aria-label', t('Ban {host}').replace('{host}', d.host));
      ban.onclick = () => apBanConfirm(d.host, refresh);
      actions.appendChild(ban);
    }
    row.append(left, actions);
    box.appendChild(row);
  });
  return box;
}

function apUnverified(res, models) {
  const box = apSection(t('Unverified items'));
  if (!res.ok) { apLine(box, t('Could not load.')); return box; }
  if (!res.rows.length) { apLine(box, t('Everything was re-verified recently')); return box; }
  res.rows.forEach(r => {
    const row = el('div', 'ap-row');
    const label = el('span'); label.textContent = `${proposalCarLabel(models, r.car_model_id)} · ${r.target_key}`;
    const pill = el('span', 'pill warn');
    pill.textContent = `${t('missed runs')}: ${Number(r.missed_runs) || 0}`;
    row.append(label, pill);
    box.appendChild(row);
  });
  return box;
}

/* Check now: free preview first, then an explicit Confirm run (T-03-28). */
function apCheckNow(models, refresh) {
  const box = apSection(t('Check now'));
  /* Two steps, cost first: Preview is free and only fills the panel below;
     nothing starts until Confirm run, which is shown with the cost it will spend. */
  const hint = el('p', 'muted ap-check-hint'); hint.textContent = t('Preview costs nothing. A run starts only when you confirm.');
  const bar = el('div', 'ap-check');
  const sel = el('select'); sel.setAttribute('aria-label', t('Car'));
  (models || []).forEach(m => { const o = el('option'); o.value = m.id; o.textContent = `${m.model} ${m.generation} · ${m.engine}`; sel.appendChild(o); });
  if (models && models.length) sel.value = models[0].id;
  const out = el('div', 'ap-estimate');
  out.hidden = true;
  const note = msg => { out.hidden = false; out.textContent = ''; const p = apLine(out, msg, 'ap-error'); p.setAttribute('role', 'status'); };
  const preview = apButton(t('Preview'), 'btn ghost', async () => {
    if (!sel.value) return;
    const r = await catalogAdmin.checkCar(sel.value, 'preview');
    if (!r.ok) return note(t('Could not preview. Try again.'));
    const e = r.estimate || r;
    out.hidden = false;
    out.textContent = '';
    /* The cost is the headline; the rest is supporting detail in one divided row. */
    const head = el('div', 'ap-est-head');
    const cost = el('span', 'ap-est-cost'); cost.textContent = `${Math.round((Number(e.sar) || 0) * 100) / 100} SAR`;
    const costLabel = el('span', 'ap-est-label'); costLabel.textContent = t('Estimated cost');
    head.append(costLabel, cost);
    const row = el('div', 'ap-est-row');
    [[t('Searches'), Number(e.searches) || 0], [t('LLM calls'), Number(e.llm_calls) || 0], [t('Skipped as unchanged'), (e.skipped || []).length]]
      .forEach(([label, value]) => {
        const c = el('div', 'ap-est-cell');
        const v = el('span', 'ap-est-value'); v.textContent = String(value);
        const l = el('span', 'ap-est-label'); l.textContent = label;
        c.append(v, l);
        row.appendChild(c);
      });
    const confirm = apButton(t('Confirm run'), 'btn primary block ap-confirm', async () => {
      const g = await catalogAdmin.checkCar(sel.value, 'run');
      if (g.ok) { toast(t('Run started')); return refresh(); }
      note(t(g.error === 'limit' ? 'Monthly cost cap reached.' : 'Could not start the run.'));
    });
    out.append(head, row, confirm);
  });
  bar.append(sel, preview);
  box.append(hint, bar, out);
  return box;
}

/* state: { status, domains, unverified, models } from the data functions; refresh() reloads the admin body. */
function adminAutopilot(state, refresh) {
  const card = el('div', 'card ap-card');
  const s = state.status || { ok: false };
  const head = el('div', 'ap-head');
  const h = el('h3'); h.textContent = t('Monthly autopilot'); head.appendChild(h);
  if (s.ok) {
    const st = el('span', 'pill ' + (s.enabled ? 'ok' : 'warn'));
    st.textContent = s.enabled ? t('Autopilot is on') : t('Autopilot is paused');
    head.appendChild(st);
  }
  card.appendChild(head);
  if (!s.ok) { apLine(card, t('Could not load.')); return card; }

  /* kill switch: the one control that matters, so it sits on its own row with its consequence */
  const ctl = el('div', 'ap-control');
  const why = el('p', 'muted'); why.textContent = t('Turning it off stops the run at the next paid call.');
  ctl.append(why, apButton(s.enabled ? t('Turn off') : t('Turn on'), 'btn ghost', async () => {
    const r = await catalogAdmin.setKillSwitch(!s.enabled);
    if (r.ok) return refresh();
    toast(t('Could not save. Check your connection.'), 'warn');
  }));
  card.appendChild(ctl);

  /* spend meter against the monthly cap */
  const spent = s.spendSar == null ? null : Number(s.spendSar) || 0, cap = Number(s.capSar) || 0;
  const pct = spent == null || !cap ? 0 : Math.min(100, Math.round(spent / cap * 100));
  const meter = el('div', 'ap-meter');
  const mlab = el('div', 'ap-meter-label');
  const ml = el('span'); ml.textContent = t('Spend this month');
  const mv = el('span'); mv.textContent = `${spent == null ? '—' : Math.round(spent * 100) / 100} / ${cap} SAR`;
  mlab.append(ml, mv);
  const track = el('div', 'bar ' + (pct >= 90 ? 'danger' : pct >= 60 ? 'warn' : 'ok'));
  track.setAttribute('role', 'progressbar'); track.setAttribute('aria-label', t('Spend this month'));
  track.setAttribute('aria-valuemin', '0'); track.setAttribute('aria-valuemax', String(cap)); track.setAttribute('aria-valuenow', String(spent || 0));
  const fill = el('span'); fill.style.width = pct + '%'; track.appendChild(fill);
  meter.append(mlab, track);
  card.appendChild(meter);

  const lastMonthly = (s.runs || []).find(r => r.status !== 'running') || (s.runs || [])[0];
  card.append(apReport(lastMonthly), apDomains(state.domains || { ok: false }, refresh),
    apUnverified(state.unverified || { ok: false }, state.models), apCheckNow(state.models, refresh));
  return card;
}
