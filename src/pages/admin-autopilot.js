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
const apSkipText = v => typeof v === 'string' ? v : v && typeof v === 'object'
  ? ([v.url || v.host, v.reason].filter(Boolean).join(' — ') || JSON.stringify(v)) : String(v);

function apReport(run) {
  const box = el('div');
  const h = el('h4'); h.textContent = t('Last run report'); box.appendChild(h);
  const rep = run && run.report;
  if (!run || !rep) { apLine(box, t('No run report yet')); return box; }
  apLine(box, `${String(run.started_at || '').slice(0, 10)} · ${run.kind} · ${run.status}`);
  Object.entries(rep.proposals || {}).forEach(([kind, c]) => {
    const n = c && typeof c === 'object' ? c : {};
    apLine(box, `${kind}: ${Number(n.inserted) || 0} ${t('new')}, ${Number(n.noop) || 0} ${t('unchanged')}`);
  });
  apLine(box, `${t('Cost')}: ${Number(rep.cost_sar) || 0} SAR · ${t('Searches')}: ${Number(rep.searches) || 0} · ${t('LLM calls')}: ${Number(rep.llm_calls) || 0}`);
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
  const box = el('div');
  const h = el('h4'); h.textContent = t('Source domains'); box.appendChild(h);
  if (!res.ok) { apLine(box, t('Could not load.')); return box; }
  if (!res.rows.length) { apLine(box, t('No domains yet')); return box; }
  res.rows.forEach(d => {
    const row = el('div', 'field-row');
    const name = el('strong'); name.setAttribute('dir', 'ltr'); name.textContent = d.host;
    const st = el('span', 'pill ' + (d.status === 'pending' ? 'warn' : d.status === 'banned' ? 'danger' : 'ok'));
    st.textContent = t(d.status === 'pending' ? 'Pending' : d.status === 'banned' ? 'Banned' : 'Approved');
    row.append(name, st);
    if (d.status !== 'approved') row.appendChild(apButton(t('Approve'), 'btn ghost', async () => {
      const r = await catalogAdmin.approveDomain(d.host);
      if (r.ok) return refresh();
      toast(t('Could not save. Check your connection.'), 'warn');
    }));
    if (d.status !== 'banned') {
      const ban = el('button', 'btn ghost reject'); ban.type = 'button'; ban.textContent = t('Ban');
      ban.setAttribute('aria-label', t('Ban {host}').replace('{host}', d.host));
      ban.onclick = () => apBanConfirm(d.host, refresh);
      row.appendChild(ban);
    }
    box.appendChild(row);
  });
  return box;
}

function apUnverified(res, models) {
  const box = el('div');
  const h = el('h4'); h.textContent = t('Unverified items'); box.appendChild(h);
  if (!res.ok) { apLine(box, t('Could not load.')); return box; }
  if (!res.rows.length) { apLine(box, t('Everything was re-verified recently')); return box; }
  res.rows.forEach(r => apLine(box, `${proposalCarLabel(models, r.car_model_id)} · ${r.target_key} · ${t('missed runs')}: ${Number(r.missed_runs) || 0}`));
  return box;
}

/* Check now: free preview first, then an explicit Confirm run (T-03-28). */
function apCheckNow(models, refresh) {
  const box = el('div');
  const h = el('h4'); h.textContent = t('Check now'); box.appendChild(h);
  const sel = el('select'); sel.setAttribute('aria-label', t('Car'));
  (models || []).forEach(m => { const o = el('option'); o.value = m.id; o.textContent = `${m.model} ${m.generation}`; sel.appendChild(o); });
  if (models && models.length) sel.value = models[0].id;
  const out = el('div');
  const note = msg => { out.textContent = ''; apLine(out, msg); };
  const preview = apButton(t('Preview'), 'btn ghost', async () => {
    if (!sel.value) return;
    const r = await catalogAdmin.checkCar(sel.value, 'preview');
    if (!r.ok) return note(t('Could not preview. Try again.'));
    const e = r.estimate || r;
    out.textContent = '';
    apLine(out, `${t('Estimated cost')}: ${Math.round((Number(e.sar) || 0) * 100) / 100} SAR · ${t('Searches')}: ${Number(e.searches) || 0} · ${t('LLM calls')}: ${Number(e.llm_calls) || 0} · ${t('Skipped as unchanged')}: ${(e.skipped || []).length}`);
    out.appendChild(apButton(t('Confirm run'), 'btn primary', async () => {
      const g = await catalogAdmin.checkCar(sel.value, 'run');
      if (g.ok) { toast(t('Run started')); return refresh(); }
      note(t(g.error === 'limit' ? 'Monthly cost cap reached.' : 'Could not start the run.'));
    }));
  });
  box.append(sel, preview, out);
  return box;
}

/* state: { status, domains, unverified, models } from the data functions; refresh() reloads the admin body. */
function adminAutopilot(state, refresh) {
  const card = el('div', 'card');
  card.style.cssText = 'padding:16px;margin-bottom:12px';
  const h = el('h3'); h.textContent = t('Monthly autopilot'); card.appendChild(h);
  const s = state.status || { ok: false };
  if (!s.ok) { apLine(card, t('Could not load.')); return card; }
  const row = el('div', 'field-row');
  const lab = el('span'); lab.textContent = s.enabled ? t('Autopilot is on') : t('Autopilot is paused');
  row.append(lab, apButton(s.enabled ? t('Turn off') : t('Turn on'), 'btn ghost', async () => {
    const r = await catalogAdmin.setKillSwitch(!s.enabled);
    if (r.ok) return refresh();
    toast(t('Could not save. Check your connection.'), 'warn');
  }));
  card.appendChild(row);
  apLine(card, t('Turning it off stops the run at the next paid call.'));
  apLine(card, `${t('Spend this month')}: ${s.spendSar == null ? '—' : Math.round(s.spendSar * 100) / 100} / ${s.capSar} SAR`);
  const lastMonthly = (s.runs || []).find(r => r.status !== 'running') || (s.runs || [])[0];
  card.append(apReport(lastMonthly), apDomains(state.domains || { ok: false }, refresh),
    apUnverified(state.unverified || { ok: false }, state.models), apCheckNow(state.models, refresh));
  return card;
}
