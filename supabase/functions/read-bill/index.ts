// Supabase Edge Function: read a bill photo with a vision model.
// Secrets: ANTHROPIC_API_KEY (required), BILL_MODEL (optional, default below).
// Deploy: supabase functions deploy read-bill; supabase secrets set ANTHROPIC_API_KEY=...
import { createClient } from 'npm:@supabase/supabase-js@2';
import { allowedOrigins, corsDecision } from '../_shared/cors.mjs';
import { logEdgeError } from '../_shared/app-errors.mjs';
import { DAILY_CAP, SYSTEM_PROMPT, fingerprint, parseBill, sha256Hex, storeKey, validateImage } from './logic.mjs';

const MAX_BODY = 2_200_000;

// Whole body as text, or null once it passes max bytes. The body is still buffered up to the cap.
async function readCapped(req: Request, max: number): Promise<string | null> {
  const reader = req.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) { await reader.cancel().catch(() => {}); return null; }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { all.set(c, off); off += c.byteLength; }
  return new TextDecoder().decode(all);
}

Deno.serve(async (req) => {
  let admin: any = null;   // hoisted so the outer catch can log; logEdgeError tolerates null
  let corsHeaders: Record<string, string> = {};   // hoisted so the 500 response keeps CORS (json() is scoped to the try)
  try {
    // Origin gate first: foreign/null Origin never reaches OPTIONS, auth or the paid model (D-13/D-14/D-16).
    const cors = corsDecision(req.headers.get('Origin'), allowedOrigins(Deno.env.get('ALLOWED_ORIGINS')));
    if (!cors.ok) return new Response('forbidden', { status: 403 });
    // corsDecision types its header values as possibly undefined; drop them, the Response API wants strings
    const ch = Object.fromEntries(Object.entries(cors.headers).filter(([, v]) => v !== undefined)) as Record<string, string>;
    corsHeaders = ch;
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { ...ch, 'Content-Type': 'application/json' } });
    if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: ch });
    if (req.method !== 'POST') return json(405, { error: 'method' });
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    const url = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!apiKey || !url || !anonKey || !serviceKey) return json(503, { error: 'not configured' });

    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    });
    // Pass the JWT explicitly: with no stored session, getUser() alone can fail with AuthSessionMissing.
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: u } = await userClient.auth.getUser(jwt);
    if (!u?.user) return json(401, { error: 'auth' });
    // Throwaway sign-ups would otherwise multiply the per-user cap: require a confirmed email or phone.
    if (!u.user.email_confirmed_at && !u.user.phone_confirmed_at) return json(403, { error: 'unconfirmed' });
    // Same anti-fake-account rule as qualified_users (schema.sql): account at least 7 days old.
    if (Date.parse(u.user.created_at) > Date.now() - 7 * 24 * 3600 * 1000) return json(403, { error: 'too_new' });
    admin = createClient(url, serviceKey);

    // Count bytes as they arrive: content-length can be absent (chunked) or wrong.
    const raw = await readCapped(req, MAX_BODY);
    if (raw === null) return json(413, { error: 'image' });
    let image;
    try { image = validateImage(JSON.parse(raw).image); } catch { image = null; }
    if (!image) return json(413, { error: 'image' });

    // Insert the attempt first, then count (including it): parallel requests each see themselves,
    // so a burst cannot exceed the cap. Fail closed on any DB error, before the model is called.
    const { data: row, error: insErr } = await admin.from('bill_reads').insert({ user_id: u.user.id }).select('id').single();
    if (insErr || !row) {
      await logEdgeError(admin, 'read-bill', new Error('read-bill: bill_reads insert failed'), 'read-bill');
      return json(503, { error: 'unavailable' });
    }
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { count, error: cntErr } = await admin.from('bill_reads').select('id', { count: 'exact', head: true })
      .eq('user_id', u.user.id).gte('created_at', since);
    if (cntErr || count == null) {
      await logEdgeError(admin, 'read-bill', new Error('read-bill: count failed'), 'read-bill');
      return json(503, { error: 'unavailable' });
    }
    // Global kill switch on spend: all users, last 24h (includes this attempt). Fail closed.
    // 0 is a valid value (stop all reads); only unset or non-numeric falls back to 500.
    const capEnv = (Deno.env.get('BILL_GLOBAL_DAILY_CAP') ?? '').trim();
    const globalCap = capEnv !== '' && Number.isFinite(Number(capEnv)) ? Number(capEnv) : 500;
    const { count: all, error: allErr } = await admin.from('bill_reads').select('id', { count: 'exact', head: true })
      .gte('created_at', since);
    if (allErr || all == null || all > globalCap) {
      await admin.from('bill_reads').delete().eq('id', row.id);
      await logEdgeError(admin, 'read-bill', new Error('read-bill: global count failed or cap reached'), 'read-bill');
      return json(503, { error: 'unavailable' });
    }
    if (count > DAILY_CAP) {
      await admin.from('bill_reads').delete().eq('id', row.id);
      return json(429, { error: 'limit' });
    }

    // An upstream failure read nothing and cost nothing, so it gives the attempt back.
    // An unreadable bill (422) still keeps its row: the model call was paid for.
    const upstreamFailed = async () => {
      await admin.from('bill_reads').delete().eq('id', row.id);
      await logEdgeError(admin, 'read-bill', new Error('read-bill: upstream failed'), 'read-bill');   // never the upstream body
      return json(502, { error: 'upstream' });
    };
    let text = '';
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model: Deno.env.get('BILL_MODEL') ?? 'claude-haiku-5-5',
          max_tokens: 2048,
          temperature: 0,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: [
            { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } },
            { type: 'text', text: 'Read this bill.' },
          ] }],
        }),
      });
      if (!r.ok) return await upstreamFailed();
      text = (await r.json())?.content?.[0]?.text ?? '';
    } catch { return await upstreamFailed(); }

    const bill = parseBill(text);
    if (!bill) return json(422, { error: 'unreadable' });

    // Prove-once: a duplicate fingerprint still prefills but can never back a vote.
    const fp = fingerprint(bill);
    let billReadId: string | null = null;
    if (fp) {
      const { error } = await admin.from('bill_reads')
        .update({ store_key: storeKey(bill.store!.name), city: bill.store!.city, fingerprint: await sha256Hex(fp) }).eq('id', row.id);
      if (!error) billReadId = row.id;           // 23505 on the unique fingerprint => not usable
    }
    const { invoice_no: _omit, ...clean } = bill;
    return json(200, { bill: clean, billReadId });
  } catch (e) {
    await logEdgeError(admin, 'read-bill', e, 'read-bill');
    return new Response(JSON.stringify({ error: 'server' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
