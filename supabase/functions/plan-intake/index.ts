// Supabase Edge Function: draft the maker's schedule for admin review.
// Recalls are NOT handled here: the autopilot function owns them (proposals, approval gate).
// Secrets: ANTHROPIC_API_KEY, INTAKE_CRON_SECRET (required); INTAKE_MODEL (optional).
// Never writes dealer_plan_items: only plan_drafts.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { allowedOrigins, corsDecision } from '../_shared/cors.mjs';
import { DEFAULT_POLICY, safeFetch } from '../_shared/safe-fetch.mjs';
import { resolveHostAddresses } from '../_shared/dns.ts';
import { logEdgeError } from '../_shared/app-errors.mjs';
import { SYSTEM_PROMPT, applyCarWrites, htmlToText, parseSchedule, planCarWrites, safeEqual, sha256Hex } from './logic.mjs';

// External fetches go through safeFetch (scheme/host/DNS re-checked per hop, caps, type allowlist, robots).
// DNS rebinding between check and connect is a residual risk; sources are admin-registered.

Deno.serve(async (req) => {
  // Hoisted so the outer catch can log (admin may still be null) and answer with CORS headers (json() is scoped to the try).
  let admin: any = null;
  let corsHeaders: Record<string, string> = {};
  try {
    // Origin gate first: foreign/null Origin never reaches OPTIONS, auth or the paid model (D-13/D-14/D-16).
    const cors = corsDecision(req.headers.get('Origin'), allowedOrigins(Deno.env.get('ALLOWED_ORIGINS')));
    if (!cors.ok) return new Response('forbidden', { status: 403 });
    corsHeaders = cors.headers;
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors.headers, 'Content-Type': 'application/json' } });
    if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: cors.headers });
    if (req.method !== 'POST') return json(405, { error: 'method' });
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY'), url = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY'), serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const cron = Deno.env.get('INTAKE_CRON_SECRET');
    if (!apiKey || !url || !anonKey || !serviceKey || !cron) return json(503, { error: 'not configured' });
    admin = createClient(url, serviceKey);

    const secret = req.headers.get('x-cron-secret');
    if (!(secret && await safeEqual(secret, cron))) {                    // otherwise must be an admin's JWT
      const userClient = createClient(url, anonKey, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
      const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
      const { data: u } = await userClient.auth.getUser(jwt);
      if (!u?.user) return json(401, { error: 'auth' });
      const { data: p } = await admin.from('profiles').select('role').eq('user_id', u.user.id).maybeSingle();
      if (p?.role !== 'admin') return json(403, { error: 'admin only' });
    }

    const only = (await req.json().catch(() => ({})))?.car_model_id;
    let q = admin.from('car_models').select('id,make,model,generation').eq('status', 'approved');
    if (typeof only === 'string') q = q.eq('id', only);
    const { data: cars, error: carErr } = await q;
    if (carErr || !cars) return json(503, { error: 'unavailable' });

    let drafts = 0, skipped = 0;
    for (const car of cars) {
      // ---- schedule drafts: only when a source's content hash changed ----
      const { data: srcs } = await admin.from('schedule_sources').select('*').eq('car_model_id', car.id);
      let live = await loadLive(admin, car.id);               // once per car, reused across sources (Pitfall 19)
      for (const s of srcs ?? []) {
        try {
          const res = await safeFetch(s.url, DEFAULT_POLICY, { fetch, resolve: resolveHostAddresses });
          const doc = res.ok ? { kind: res.kind, body: res.kind === 'text' ? htmlToText(res.body) : res.body } : null;
          if (!doc) { skipped++; continue; }
          const hash = await sha256Hex(doc.body);
          await admin.from('schedule_sources').update({ last_checked_at: new Date().toISOString() }).eq('id', s.id);
          if (hash === s.content_hash) continue;
          const content = doc.kind === 'pdf'
            ? [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: doc.body } }, { type: 'text', text: 'Extract the maintenance schedule.' }]
            : [{ type: 'text', text: doc.body }];
          const r = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
            body: JSON.stringify({ model: Deno.env.get('INTAKE_MODEL') ?? 'claude-sonnet-5-5', max_tokens: 4096, temperature: 0, system: SYSTEM_PROMPT, messages: [{ role: 'user', content }] }),
          });
          if (!r.ok) { skipped++; continue; }
          const items = parseSchedule((await r.json())?.content?.[0]?.text ?? '');
          if (!items) {                                   // fail closed: no partial drafts
            await admin.from('schedule_sources').update({ content_hash: hash }).eq('id', s.id);   // same content is not retried; clear content_hash to force
            skipped++; continue;
          }
          // One delete + one insert per source, whatever the item count (FND-10); live rows come from the per-car select above.
          const plan = planCarWrites(car.id, s.id, items, live);
          const { ok, written } = await applyCarWrites(admin, car.id, plan, (e: Error) => logEdgeError(admin, 'plan-intake', e, 'plan-intake'));
          drafts += written;
          if (written) live = await loadLive(admin, car.id);   // refresh only after a write
          if (ok) await admin.from('schedule_sources').update({ content_hash: hash }).eq('id', s.id);   // only after the write succeeded, so a failed write is retried
        } catch (e) { skipped++; await logEdgeError(admin, 'plan-intake', e, 'plan-intake'); }
      }
    }
    return json(200, { drafts, skipped });
  } catch (e) {
    await logEdgeError(admin, 'plan-intake', e, 'plan-intake');
    return new Response(JSON.stringify({ error: 'server' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});

async function loadLive(admin: any, carId: string) {
  const { data } = await admin.from('dealer_plan_items').select('service,interval_km,interval_months,note,parts').eq('car_model_id', carId);
  return data ?? [];
}
