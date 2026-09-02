/* ============================================================
   Garage — printable A4 Reports page, plus the spending-history builders
   Budget's page also reuses.
   Plain script, like app.js — not require()d directly by any test, only
   exercised through the boot harness.
   ============================================================ */
'use strict';

/* ============================================================
   PAGE 5 — REPORTS (printable A4)
   ============================================================ */
let reportType = 'service'; // remembered across renders in the session
function renderReports() {
  const v = el('div', 'rpt-view');
  v.appendChild(pageIntro('Reports', 'Generate a clean, printable A4 report — then Print or Save as PDF.'));

  const toolbar = el('div', 'rpt-toolbar');
  const seg = el('div', 'seg');
  seg.style.flexWrap = 'wrap';
  const types = [['service', 'Service history'], ['purchases', 'Purchases'], ['summary', 'Full summary']];
  types.forEach(([k, label]) => {
    const b = el('button', k === reportType ? 'on' : '', html`${t(label)}`);
    b.onclick = () => { reportType = k; segSelect(b); paint(); };
    seg.appendChild(b);
  });
  const printBtn = el('button', 'btn primary', html`<svg viewBox="0 0 24 24"><path d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6z"/></svg>${t('Print / Save PDF')}`);
  printBtn.onclick = () => window.print();
  toolbar.append(seg, printBtn);
  v.appendChild(toolbar);

  const wrap = el('div', 'rpt-paper-wrap');
  const paper = el('div', 'rpt-paper');
  wrap.appendChild(paper);
  v.appendChild(wrap);
  function paint() { paper.innerHTML = reportHTML(reportType); }
  paint();
  return v;
}

function reportHTML(type) {
  return type === 'purchases' ? reportPurchases() : type === 'summary' ? reportSummary() : reportService();
}
function reportHeader(title) {
  const c = session.current().car;
  const name = c.nickname || [c.year, c.make, c.model].filter(Boolean).join(' ') || 'Vehicle';
  const initials = ((c.make ? c.make[0] : 'M') + (c.model ? c.model[0] : '3')).toUpperCase();
  return html`
    <div class="rpt-head">
      <div class="rpt-brand">
        <div class="rpt-badge">${initials}</div>
        <div><h2>${name}</h2><p>${[c.engine, c.transmission, c.color].filter(Boolean).join(' · ')}</p></div>
      </div>
      <div class="rpt-meta">
        <div class="rpt-title">${title}</div>
        <div>${t('Generated')} ${fmtDate(today(), { day: 'numeric', month: 'long', year: 'numeric' })}</div>
        <div>${t('Odometer ')}${fmt(c.odometer)} km${c.plate ? html` · ${c.plate}` : ''}</div>
        ${c.vin ? html`<div>VIN ${c.vin}</div>` : ''}
      </div>
    </div>`;
}
function reportFooter() {
  return html`<div class="rpt-foot"><span>${t('Garage · Mazda 3 care app')}</span><span>${t('Report generated')} ${fmtDate(today(), { day: '2-digit', month: 'short', year: 'numeric' })}</span></div>`;
}
function reportService() {
  const hist = [...session.current().history].sort((a, b) => b.date.localeCompare(a.date) || b.odometer - a.odometer);
  const total = hist.reduce((a, e) => a + Number(e.cost || 0), 0);
  const body = !hist.length
    ? html`<div class="rpt-empty">${t('No service history recorded yet.')}</div>`
    : html`<div class="rpt-cards">
        <div class="rpt-stat"><div class="n">${hist.length}</div><div class="l">${t('Services logged')}</div></div>
        <div class="rpt-stat"><div class="n">${sar(total)}</div><div class="l">${t('Total spent (SAR)')}</div></div>
        <div class="rpt-stat"><div class="n">${fmt(session.current().car.odometer)}</div><div class="l">${t('Current odometer (km)')}</div></div>
      </div>
      <div class="rpt-section-title">${t('Work history')}</div>
      <table class="rpt-table">
        <thead><tr><th>${t('Date')}</th><th>${t('Service')}</th><th>${t('Category')}</th><th class="num">${t('Odometer')}</th><th class="num">${t('Cost')}</th><th>${t('Notes')}</th></tr></thead>
        <tbody>${hist.map(e => html`<tr>
          <td>${fmtDate(e.date, { day: '2-digit', month: 'short', year: 'numeric' })}</td>
          <td>${t(e.name)}</td><td>${e.cat ? t(e.cat) : '—'}</td>
          <td class="num">${fmt(e.odometer)} km</td>
          <td class="num">${e.cost > 0 ? sar(e.cost) + ' SAR' : '—'}</td>
          <td>${e.note || ''}</td></tr>`)}</tbody>
        <tfoot><tr><td colspan="4">${t('Total')}</td><td class="num">${sar(total)} SAR</td><td></td></tr></tfoot>
      </table>`;
  return html`${reportHeader(t('Service History Report'))}${body}${reportFooter()}`;
}
function reportPurchases() {
  const sp = [...session.current().spending].sort((a, b) => b.date.localeCompare(a.date));
  const total = sp.reduce((a, e) => a + Number(e.amount || 0), 0);
  const byCat = {};
  sp.forEach(e => { byCat[e.cat] = (byCat[e.cat] || 0) + Number(e.amount || 0); });
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const body = !sp.length
    ? html`<div class="rpt-empty">${t('No purchases or spending recorded yet.')}</div>`
    : html`<div class="rpt-cards">
        <div class="rpt-stat"><div class="n">${sp.length}</div><div class="l">${t('Entries')}</div></div>
        <div class="rpt-stat"><div class="n">${sar(total)}</div><div class="l">${t('Total spent (SAR)')}</div></div>
        <div class="rpt-stat"><div class="n">${cats.length}</div><div class="l">${t('Categories')}</div></div>
      </div>
      <div class="rpt-section-title">${t('By category')}</div>
      <table class="rpt-table"><thead><tr><th>${t('Category')}</th><th class="num">${t('Amount')}</th><th class="num">${t('Share')}</th></tr></thead>
        <tbody>${cats.map(([k, val]) => html`<tr><td>${t(k)}</td><td class="num">${sar(val)} SAR</td><td class="num">${Math.round(val / (total || 1) * 100)}%</td></tr>`)}</tbody></table>
      <div class="rpt-section-title">${t('All purchases')}</div>
      <table class="rpt-table">
        <thead><tr><th>${t('Date')}</th><th>${t('Item')}</th><th>${t('Category')}</th><th class="num">${t('Odometer')}</th><th class="num">${t('Amount')}</th></tr></thead>
        <tbody>${sp.map(e => html`<tr>
          <td>${fmtDate(e.date, { day: '2-digit', month: 'short', year: 'numeric' })}</td>
          <td>${e.desc}</td><td>${t(e.cat)}</td>
          <td class="num">${e.odometer ? fmt(e.odometer) + ' km' : '—'}</td>
          <td class="num">${sar(e.amount)} SAR</td></tr>`)}</tbody>
        <tfoot><tr><td colspan="4">${t('Total')}</td><td class="num">${sar(total)} SAR</td></tr></tfoot>
      </table>`;
  return html`${reportHeader(t('Purchases & Spending Report'))}${body}${reportFooter()}`;
}
function reportSummary() {
  const ranked = servicesRanked();
  const overdue = ranked.filter(r => r.st.level === 'danger');
  const soon = ranked.filter(r => r.st.level === 'warn');
  const due = [...overdue, ...soon];
  const dueCost = due.reduce((a, r) => a + (r.s.cost || 0), 0);
  const hs = healthScore();
  const spent = yearSpend(today().getFullYear());
  const histTotal = session.current().history.reduce((a, e) => a + Number(e.cost || 0), 0);
  const dueRows = due.length
    ? due.map(({ s, st }) => html`<tr><td>${t(s.name)}</td><td>${st.level === 'danger' ? t('Overdue') : t('Due soon')}</td><td class="num">${st.kmLeft <= 0 ? fmt(-st.kmLeft) + ' ' + t('km over') : fmt(st.kmLeft) + ' ' + t('km left')}</td><td class="num">${sar(s.cost)} SAR</td></tr>`)
    : html`<tr><td colspan="4" style="text-align:center;color:#8b93a3;padding:16px">${t('Everything is up to date 🎉')}</td></tr>`;
  return html`${reportHeader(t('Vehicle Summary Report'))}
    <div class="rpt-cards">
      <div class="rpt-stat"><div class="n">${hs}</div><div class="l">${t('Health score')}</div></div>
      <div class="rpt-stat"><div class="n">${soon.length}</div><div class="l">${t('Due soon')}</div></div>
      <div class="rpt-stat"><div class="n">${overdue.length}</div><div class="l">${t('Overdue')}</div></div>
    </div>
    <div class="rpt-cards" style="margin-top:12px">
      <div class="rpt-stat"><div class="n">${sar(spent)}</div><div class="l">${t('Spent in')} ${today().getFullYear()} (SAR)</div></div>
      <div class="rpt-stat"><div class="n">${sar(histTotal)}</div><div class="l">${t('Lifetime service cost')}</div></div>
      <div class="rpt-stat"><div class="n">${session.current().history.length}</div><div class="l">${t('Services logged')}</div></div>
    </div>
    <div class="rpt-section-title">${raw(t('Upcoming &amp; overdue services'))}</div>
    <table class="rpt-table">
      <thead><tr><th>${t('Service')}</th><th>${t('Status')}</th><th class="num">${t('Distance')}</th><th class="num">${t('Est. cost')}</th></tr></thead>
      <tbody>${dueRows}</tbody>
      ${due.length ? html`<tfoot><tr><td colspan="3">${t('Estimated total')}</td><td class="num">${sar(dueCost)} SAR</td></tr></tfoot>` : ''}
    </table>${reportFooter()}`;
}

function monthlyBars() {
  const wrap = el('div', 'spend-bars');
  const months = [];
  for (let i = 5; i >= 0; i--) { const d = new Date(today().getFullYear(), today().getMonth() - i, 1); months.push(d); }
  const totals = months.map(m => {
    const key = m.getFullYear() + '-' + String(m.getMonth() + 1).padStart(2, '0'); // local month, no TZ shift
    return session.current().spending.filter(e => e.date.startsWith(key)).reduce((a, e) => a + Number(e.amount), 0);
  });
  const max = Math.max(1, ...totals);
  months.forEach((m, i) => {
    const isNow = i === months.length - 1;
    const sb = el('div', 'sb' + (isNow ? ' now' : ''));
    const h = Math.max(4, (totals[i] / max) * 100);
    sb.innerHTML = html`<div class="col" style="height:${h}%"></div><div class="m">${fmtDate(m, { month: 'short' })}</div>`;
    sb.title = `${sar(totals[i])} SAR`;
    wrap.appendChild(sb);
  });
  return wrap;
}

function spendEntry(e) {
  const emoji = { Maintenance: '🔧', Tires: '🛞', Parts: '📦', Fuel: '⛽', Electrical: '🔋', Insurance: '📄', Other: '💠' }[e.cat] || '💠';
  const it = el('div', 'card entry');
  it.innerHTML = html`
    <div class="e-ic">${emoji}</div>
    <div class="e-main"><h3>${e.desc}${e.photo ? ' 🧾' : ''}</h3><p>${t(e.cat)} · ${fmtDate(e.date, { day: 'numeric', month: 'short', year: 'numeric' })}</p></div>
    <div class="e-amt">${sar(e.amount)} <span class="muted" style="font-size:10px">SAR</span></div>`;
  it.onclick = () => openAddSpending(e);
  return it;
}
