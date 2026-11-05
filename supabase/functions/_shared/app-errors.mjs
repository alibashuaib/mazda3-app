/* Edge-function error logger (D-03, D-05). Pure apart from the injected client; no Deno APIs. */
export const MESSAGE_MAX = 500;
export const STACK_MAX = 2000;
const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;

// Redact token shapes so a message that echoes a header or key never reaches the table.
export function scrub(text) {
  return String(text ?? '')
    .replace(/Bearer\s+[A-Za-z0-9._~+\/=-]+/gi, 'Bearer [redacted]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, '[redacted-jwt]')
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, '[redacted-key]');
}

// Allowlisted columns only: source, message, stack, route. Never a body, response or payload.
export function normaliseEdgeError(source, err, route) {
  const e = err instanceof Error ? err : null;
  const row = {
    source: SLUG.test(String(source)) ? String(source) : 'unknown-source',
    message: scrub(e ? e.message : err).slice(0, MESSAGE_MAX),
    stack: scrub(e && e.stack ? e.stack : '').slice(0, STACK_MAX),
  };
  if (route != null) row.route = scrub(route).slice(0, 200);
  return row;
}

export async function logEdgeError(client, source, err, route) {
  // Logging must never change the HTTP response, so every failure here is swallowed.
  try {
    if (!client) return;
    await client.from('app_errors').insert(normaliseEdgeError(source, err, route));
  } catch (e) { /* intentionally ignored */ }
}
