// Origin policy shared by the edge functions. Pure: no Deno/Node APIs, so Node tests can import it.
export const PRODUCTION_ORIGIN = 'https://alibashuaib.github.io';

// Production origin first, then optional dev extras from the ALLOWED_ORIGINS secret (comma-separated, exact match only).
export function allowedOrigins(envValue) {
  const extra = typeof envValue === 'string' ? envValue.split(',').map((s) => s.trim()).filter(Boolean) : [];
  return [PRODUCTION_ORIGIN, ...extra];
}

// CORS alone does not reject a simple cross-origin POST (the browser only hides the response),
// so a not-ok decision must become a 403 before any work happens (Research Pitfall 7).
// No Origin header = server-to-server call (pg_cron + x-cron-secret): passes, auth is the control (D-16).
// file:// pages and sandboxed iframes send the literal Origin "null"; it is simply not in the list, so it is refused (D-14).
export function corsDecision(origin, allowed) {
  if (origin === undefined || origin === null || origin === '') return { ok: true, headers: {} };
  if (!allowed.includes(origin)) return { ok: false, headers: {} };
  return {
    ok: true,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Vary': 'Origin',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
  };
}
