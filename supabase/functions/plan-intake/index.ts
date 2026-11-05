// Supabase Edge Function: draft the maker's schedule and fetch recalls for admin review.
// Secrets: ANTHROPIC_API_KEY, INTAKE_CRON_SECRET (required); INTAKE_MODEL (optional).
// Never writes dealer_plan_items: only plan_drafts and pending recalls.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { allowedOrigins, corsDecision } from '../_shared/cors.mjs';
import { DEFAULT_POLICY, NHTSA_POLICY, safeFetch } from '../_shared/safe-fetch.mjs';
import { resolveHostAddresses } from '../_shared/dns.ts';
import { SYSTEM_PROMPT, diffDraft, htmlToText, parseRecalls, parseSchedule, safeEqual, sha256Hex } from './logic.mjs';

// External fetches go through safeFetch (scheme/host/DNS re-checked per hop, caps, type allowlist, robots).
// DNS rebinding between check and connect is a residual risk; sources are admin-registered.

Deno.serve(async (req) => {
  try {
    // Origin gate first: foreign/null Origin never reaches OPTIONS, auth or the paid model (D-13/D-14/D-16).
    const cors = corsDecision(req.headers.get('Origin'), allowedOrigins(Deno.env.get('ALLOWED_ORIGINS')));
    if (!cors.ok) return new Response('forbidden', { status: 403 });
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors.headers, 'Content-Type': 'application/json' } });
    if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: cors.headers });
    if (req.method !== 'POST') return json(405, { error: 'method' });
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY'), url = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY'), serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const cron = Deno.env.get('INTAKE_CRON_SECRET');
    if (!apiKey || !url || !anonKey || !serviceKey || !cron) return json(503, { error: 'not configured' });
    const admin = createClient(url, serviceKey);

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

    let drafts = 0, recalls = 0, skipped = 0;
    for (const car of cars) {
      // ---- schedule drafts: only when a source's content hash changed ----
      const { data: srcs } = await admin.from('schedule_sources').select('*').eq('car_model_id', car.id);
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
          const { data: live } = await admin.from('dealer_plan_items').select('service,interval_km,interval_months,note,parts').eq('car_model_id', car.id);
          for (const it of items) {
            const cur = (live ?? []).find((x: any) => x.service.toLowerCase() === it.service.toLowerCase());
            const proposed = { interval_km: it.interval_km, interval_months: it.interval_months, note: it.note, parts: it.parts };
            if (!diffDraft(cur, proposed)) continue;
            await admin.from('plan_drafts').delete().eq('car_model_id', car.id).eq('service', cur?.service ?? it.service).eq('status', 'pending');
            const { error } = await admin.from('plan_drafts').insert({
              car_model_id: car.id, source_id: s.id, service: cur?.service ?? it.service, proposed,
              reason: cur ? 'Source differs from the live schedule' : 'New service found in the source',
            });
            if (!error) drafts++;
          }
          await admin.from('schedule_sources').update({ content_hash: hash }).eq('id', s.id);   // only after drafts were written
        } catch { skipped++; }
      }

      // ---- recalls: NHTSA, model-year range of the generation ----
      const years = yearsOf(car.generation);
      if (years.length) {
        const found: any[] = [];
        for (const y of years) {
          const res = await safeFetch(`https://api.nhtsa.gov/recalls/recallsByVehicle?make=${encodeURIComponent(car.make)}&model=${encodeURIComponent(/^\d+$/.test(car.model) ? 'mazda' + car.model : car.model)}&modelYear=${y}`, NHTSA_POLICY, { fetch, resolve: resolveHostAddresses });
          if (res.ok) { let j = null; try { j = JSON.parse(res.body); } catch {} found.push(...parseRecalls(j, [y])); }
        }
        const merged = new Map<string, any>();
        for (const f of found) { const m = merged.get(f.campaign); if (m) m.years = [...new Set([...m.years, ...f.years])]; else merged.set(f.campaign, f); }
        for (const f of merged.values()) {
          const { data: ex } = await admin.from('recalls').select('campaign').eq('campaign', f.campaign).eq('car_model_id', car.id).maybeSingle();
          if (ex) continue;                                // never reset an approved/rejected status
          const { error } = await admin.from('recalls').insert({ ...f, car_model_id: car.id });
          if (!error) recalls++;
        }
      }
    }
    return json(200, { drafts, recalls, skipped });
  } catch { return json(500, { error: 'server' }); }
});

// "BM/BN · 2014–18", "BP · 2019+" -> model years (open-ended capped at the current year).
function yearsOf(gen: string): number[] {
  const m = String(gen ?? '').match(/(\d{4})\s*([-–]\s*(\d{2,4})|\+)/);
  if (!m) return [];
  const a = Number(m[1]);
  let b = new Date().getFullYear();
  if (m[3]) b = m[3].length === 2 ? Number(String(a).slice(0, 2) + m[3]) : Number(m[3]);
  return Array.from({ length: Math.max(0, Math.min(b - a + 1, 15)) }, (_, i) => a + i);
}
