/* ============================================================
   Error log — silent client crash reports into app_errors.
   Dual-mode like bills.js. report() never rejects.

   The anon key is public, so the throttles here only protect normal use;
   the server trigger (app_errors_before_insert, 500/hour) is the real cap.
   Only source/message/stack/route/app_version are ever sent: callers pass
   no records, and buildRow ignores every other field. No chained select on
   the insert, so anon never needs SELECT on the table.
   ============================================================ */
'use strict';

(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const api = factory();
  if (isNode) module.exports = api;
  else root.errorLog = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  const SESSION_LIMIT = 30, HOUR_LIMIT = 20, BUFFER_MAX = 20;
  const MESSAGE_MAX = 500, STACK_MAX = 2000, ROUTE_MAX = 120, VERSION_MAX = 40;
  const HOUR_MS = 3600000, HOUR_KEY = 'garage.errlog.hour';

  const fresh = () => ({ client: null, appVersion: 'unknown', route: null, now: Date.now });
  let env = fresh();
  let sent = 0, seen = new Set(), buffer = [], hour = null;

  // message/stack are untrusted free text: strip URL queries/fragments, auth
  // params, emails and opaque token shapes before anything leaves the device.
  const scrub = text => String(text == null ? '' : text)
    .replace(/(https?:\/\/[^\s?#"')]*)[?#][^\s"')]*/gi, '$1')
    .replace(/\b(access_token|refresh_token|provider_token|code)=[^\s&"')]*/gi, '$1=[redacted]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+/g, '[redacted]')
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, '[redacted]')
    .replace(/\bsb_[A-Za-z0-9_-]{8,}/g, '[redacted]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, '[redacted]')
    .replace(/[A-Za-z0-9+/_-]{32,}={0,2}/g, '[redacted]');
  const clip = (v, n) => scrub(v).slice(0, n);
  // Routes are page names only; anything carrying params or tokens is dropped.
  const safeRoute = r => { const m = String(r == null ? '' : r).match(/^#\/?[A-Za-z0-9_-]{0,40}/); const s = m ? m[0] : ''; return /token/i.test(s) ? '' : s; };

  function buildRow(input, ctx) {
    const i = input || {}, c = ctx || {};
    const row = { source: 'client', message: clip(i.message, MESSAGE_MAX) || 'unknown error' };
    row.stack = i.stack ? clip(i.stack, STACK_MAX) : null;
    row.route = safeRoute(i.route) || null;
    row.app_version = clip(c.appVersion || 'unknown', VERSION_MAX);
    return row;
  }

  // Persisted copy is best-effort; the in-memory counter is authoritative.
  function loadHour() {
    if (hour) return hour;
    hour = { start: env.now(), count: 0 };
    try {
      const p = JSON.parse(localStorage.getItem(HOUR_KEY));
      if (p && env.now() - p.start < HOUR_MS && p.count > 0) hour = { start: p.start, count: p.count };
    } catch (e) {}
    return hour;
  }
  function saveHour() { try { localStorage.setItem(HOUR_KEY, JSON.stringify(hour)); } catch (e) {} }

  function send(input) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return Promise.resolve({ ok: false, error: 'offline' });
    const row = buildRow(input, env);
    if (sent >= SESSION_LIMIT || seen.has(row.message)) return Promise.resolve({ ok: false, error: 'limit' });
    const h = loadHour();
    if (env.now() - h.start >= HOUR_MS) { h.start = env.now(); h.count = 0; }
    if (h.count >= HOUR_LIMIT) return Promise.resolve({ ok: false, error: 'throttled' });
    sent++; seen.add(row.message); h.count++; saveHour();
    return Promise.resolve().then(() => env.client.from('app_errors').insert(row))
      .then(res => (res && res.error ? { ok: false, error: 'failed' } : { ok: true }))
      .catch(() => ({ ok: false, error: 'failed' }));
  }

  function report(input) {
    try {
      const i = input || {};
      const withRoute = Object.assign({}, i, { route: i.route || (typeof env.route === 'function' ? env.route() : null) });
      if (!env.client) {
        if (buffer.length < BUFFER_MAX) buffer.push(withRoute);
        return Promise.resolve({ ok: false, error: 'unavailable' });
      }
      return send(withRoute);
    } catch (e) { return Promise.resolve({ ok: false, error: 'failed' }); }
  }

  function configure(next) {
    env = Object.assign({}, env, next || {});
    if (env.client && buffer.length) { const q = buffer; buffer = []; q.forEach(send); }
  }
  function reset() { env = fresh(); sent = 0; seen = new Set(); buffer = []; hour = null; try { localStorage.removeItem(HOUR_KEY); } catch (e) {} }

  return { report, configure, reset, scrub, buildRow, safeRoute };
});
