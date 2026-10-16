// Supabase Edge Function: read a bill photo with a vision model.
// Secrets: ANTHROPIC_API_KEY (required), BILL_MODEL (optional, default below).
// Deploy: supabase functions deploy read-bill; supabase secrets set ANTHROPIC_API_KEY=...
import { createClient } from 'npm:@supabase/supabase-js@2';
import { DAILY_CAP, SYSTEM_PROMPT, fingerprint, parseBill, storeKey, validateImage } from './logic.mjs';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'method' });
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return json(503, { error: 'not configured' });

  const url = Deno.env.get('SUPABASE_URL')!;
  const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  // Pass the JWT explicitly: with no stored session, getUser() alone can fail with AuthSessionMissing.
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: u } = await userClient.auth.getUser(jwt);
  if (!u?.user) return json(401, { error: 'auth' });
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count } = await admin.from('bill_reads').select('id', { count: 'exact', head: true })
    .eq('user_id', u.user.id).gte('created_at', since);
  if ((count ?? 0) >= DAILY_CAP) return json(429, { error: 'limit' });

  let image;
  try { image = validateImage((await req.json()).image); } catch { image = null; }
  if (!image) return json(413, { error: 'image' });

  // Count the attempt before spending money, so retries cannot dodge the cap.
  const { data: row } = await admin.from('bill_reads').insert({ user_id: u.user.id }).select('id').single();

  let text = '';
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: Deno.env.get('BILL_MODEL') ?? 'claude-haiku-5-5',
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } },
          { type: 'text', text: 'Read this bill.' },
        ] }],
      }),
    });
    if (!r.ok) return json(502, { error: 'upstream' });
    text = (await r.json())?.content?.[0]?.text ?? '';
  } catch { return json(502, { error: 'upstream' }); }

  const bill = parseBill(text);
  if (!bill) return json(422, { error: 'unreadable' });

  // Prove-once: a duplicate fingerprint still prefills but can never back a vote.
  const fp = fingerprint(bill);
  let billReadId: string | null = null;
  if (fp && row) {
    const { error } = await admin.from('bill_reads')
      .update({ store_key: storeKey(bill.store!.name), city: bill.store!.city, fingerprint: fp }).eq('id', row.id);
    if (!error) billReadId = row.id;           // 23505 on the unique fingerprint => not usable
  }
  const { invoice_no: _omit, ...clean } = bill;
  return json(200, { bill: clean, billReadId });
});
