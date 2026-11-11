// Supabase Edge Function: monthly catalogue autopilot worker.
// Actions: work (cron secret) drains the job queue; preview and run (admin JWT) are owner-triggered.
// Secrets: ANTHROPIC_API_KEY, INTAKE_CRON_SECRET (required); INTAKE_MODEL (optional, extraction model).
// Never writes proposals or live tables: findings are staged through autopilot_stage_findings and
// published by the SQL function autopilot_publish_run.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { allowedOrigins, corsDecision } from '../_shared/cors.mjs';
import { DEFAULT_POLICY, safeFetch } from '../_shared/safe-fetch.mjs';
import { resolveHostAddresses } from '../_shared/dns.ts';
import { logEdgeError } from '../_shared/app-errors.mjs';
import { safeEqual } from '../plan-intake/logic.mjs';
import { runCommunity, runDiscover, runExtract, runModels, runParts, runPreview, runRecalls } from './flow.mjs';

const STAGES: Record<string, (job: any, deps: any) => Promise<any>> = { discover: runDiscover, extract: runExtract, recalls: runRecalls, parts: runParts, community: runCommunity, models: runModels };

const BUDGET_MS = 100_000;   // stop claiming new jobs after this; the 5-minute cron poke picks up the rest.
// A claimed job may run longer than this (several LLM calls); SQL only reclaims a running job after 15 minutes (autopilot_claim_job).
const LLM_TIMEOUT_MS = 90_000;   // under BUDGET_MS, so one slow call cannot run past the claim window

Deno.serve(async (req) => {
  let admin: any = null;
  let corsHeaders: Record<string, string> = {};
  try {
    // Origin gate first, same shape as plan-intake.
    const cors = corsDecision(req.headers.get('Origin'), allowedOrigins(Deno.env.get('ALLOWED_ORIGINS')));
    if (!cors.ok) return new Response('forbidden', { status: 403 });
    // corsDecision types its header values as possibly undefined; drop them, the Response API wants strings
    const ch = Object.fromEntries(Object.entries(cors.headers).filter(([, v]) => v !== undefined)) as Record<string, string>;
    corsHeaders = ch;
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...ch, 'Content-Type': 'application/json' } });
    if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: ch });
    if (req.method !== 'POST') return json(405, { error: 'method' });
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY'), url = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY'), serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const cron = Deno.env.get('INTAKE_CRON_SECRET');
    if (!apiKey || !url || !anonKey || !serviceKey || !cron) return json(503, { error: 'not configured' });
    admin = createClient(url, serviceKey);

    const body = await req.json().catch(() => ({}));
    const action = body?.action;
    if (action !== 'work' && action !== 'preview' && action !== 'run') return json(400, { error: 'action' });
    const secret = req.headers.get('x-cron-secret');
    if (action === 'work' && !(secret && await safeEqual(secret, cron))) {
      return json(401, { error: 'auth' });
    }
    if (action !== 'work') {                                   // preview / run: admin JWT only
      const userClient = createClient(url, anonKey, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
      const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
      const { data: u } = await userClient.auth.getUser(jwt);
      if (!u?.user) return json(401, { error: 'auth' });
      const { data: p } = await admin.from('profiles').select('role').eq('user_id', u.user.id).maybeSingle();
      if (p?.role !== 'admin') return json(403, { error: 'admin only' });
    }

    const deps = await buildDeps(admin, apiKey);
    const car = body?.car_model_id;
    if (action === 'preview' || action === 'run') {
      if (typeof car !== 'string') return json(400, { error: 'car_model_id' });
      const { data: known } = await admin.from('car_models').select('id').eq('id', car).maybeSingle();
      if (!known) return json(404, { error: 'unknown car' });  // checked here, not inside carRow, which would 500
    }
    if (action === 'preview') return json(200, await runPreview(car, deps));   // free: fetches + hash compare only
    if (action === 'run') {
      // Monthly cap reached: refuse with 429 so the admin shows "cap reached" (the cap is also enforced per call in autopilot_reserve).
      if (!(Number(await rpc(admin, 'autopilot_budget_left', {})) > 0)) return json(429, { error: 'limit' });
      const started = await rpc(admin, 'autopilot_start_run', { p_kind: 'manual', p_car: car });
      if (!started?.ok) return json(409, started ?? { error: 'start' });
      return json(200, await work(admin, deps, started.run_id));
    }
    return json(200, await work(admin, deps));
  } catch (e) {
    await logEdgeError(admin, 'autopilot', e, 'autopilot');
    return new Response(JSON.stringify({ error: 'server' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});

async function rpc(admin: any, fn: string, args: Record<string, unknown>) {
  const { data, error } = await admin.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data;
}

// runId: a manual run drains only its own jobs; the cron poke (no runId) drains the queue.
async function work(admin: any, deps: any, runId: number | null = null) {
  const t0 = Date.now();
  let done = 0, failed = 0;
  while (Date.now() - t0 < BUDGET_MS) {
    const job = await rpc(admin, 'autopilot_claim_job', { p_run: runId });
    if (!job) break;
    try {
      let notes: unknown = null;
      // WR-01: a refused publish (jobs_pending) must fail and retry, not mark the job done with the run left running
      if (job.stage === 'publish') {
        const pub = await rpc(admin, 'autopilot_publish_run', { p_run: job.run_id });
        if (!pub?.ok && pub?.reason !== 'not_running') throw new Error('publish refused: ' + pub?.reason);
      }
      else {
        // an unmapped stage fails loudly rather than running the wrong job
        const run = STAGES[job.stage];
        if (!run) throw new Error('unknown stage ' + job.stage);
        // the flow returns { stop } when the run ended, else { ok, notes }; the union is not narrowed by TS here
        const out = (await run(job, deps)) as { stop?: string; notes?: unknown };
        if (out.stop) continue;                                // run ended (capped / stopped): queue already closed in SQL
        notes = out.notes;
      }
      await rpc(admin, 'autopilot_finish_job', { p_id: job.id, p_ok: true, p_err: null, p_notes: notes });
      done++;
    } catch (e) {
      failed++;
      await logEdgeError(admin, 'autopilot', e, 'autopilot');
      await rpc(admin, 'autopilot_finish_job', { p_id: job.id, p_ok: false, p_err: String((e as Error)?.message ?? e), p_notes: null }).catch(() => {});
    }
  }
  return { done, failed };
}

async function buildDeps(admin: any, apiKey: string) {
  const { data: c } = await admin.from('autopilot_config').select('*').eq('id', 1).single();
  const { data: bannedRows } = await admin.from('source_domains').select('host').eq('status', 'banned');
  const cfg = {
    prices: { ...(c?.prices ?? {}), usd_sar: Number(c?.usd_sar) },
    gccDomains: c?.gcc_domains ?? [],
    banned: (bannedRows ?? []).map((r: any) => r.host),
    maxUses: c?.search_max_uses ?? 3,
    discoverModel: 'claude-haiku-5-5',
    extractModel: Deno.env.get('INTAKE_MODEL') ?? 'claude-sonnet-5-5',
    minPct: Number(c?.min_pct ?? 0.1),
    minSar: Number(c?.min_sar ?? 5),
    optionalFloorSar: Number(c?.optional_floor_sar ?? 8),
    dealerPriceUrls: c?.dealer_price_urls ?? {},
  };
  const carRow = async (id: string) => {
    const { data: r } = await admin.from('car_models').select('id,make,model,generation,engine').eq('id', id).single();
    const { data: others } = await admin.from('car_models').select('generation').eq('model', r.model).neq('id', id);
    return { ...r, name: `${r.make} ${r.model} ${r.generation} ${r.engine}`, otherGenerations: (others ?? []).map((o: any) => o.generation) };
  };
  return {
    cfg,
    // every external page read goes through safeFetch (SSRF guard, robots, caps)
    fetch: (u: string, policy: unknown) => safeFetch(u, (policy as any) ?? DEFAULT_POLICY, { fetch, resolve: resolveHostAddresses }),
    llm: async (request: unknown) => {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(LLM_TIMEOUT_MS),   // a hung call would hold the job claim and its reservation
      });
      if (!r.ok) throw new Error(`anthropic ${r.status}`);
      return r.json();
    },
    db: {
      reserve: (run: number, sar: number) => rpc(admin, 'autopilot_reserve', { p_run: run, p_est_sar: sar }),
      settle: (id: number, model: string, usage: unknown) => rpc(admin, 'autopilot_settle', { p_reservation: id, p_model: model, p_usage: usage ?? {} }),
      endRun: (run: number, status: string) => rpc(admin, 'autopilot_end_run', { p_run: run, p_status: status }),
      // CR-01: a host the SQL grammar rejects (underscore, IPv6 literal, ...) must not raise and fail the whole run.
      // Same grammar as autopilot_see_domain; 'invalid' is neither approved nor pending, so callers drop it.
      seeDomain: (host: string) => /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(host) && host.length <= 253
        ? rpc(admin, 'autopilot_see_domain', { p_host: host })
        : Promise.resolve('invalid'),
      getSourceHash: (car: string, u: string) => rpc(admin, 'autopilot_get_source_hash', { p_car: car, p_url: u }),
      stageSourceHash: (run: number, car: string, u: string, h: string) => rpc(admin, 'autopilot_stage_hash', { p_run: run, p_car: car, p_url: u, p_hash: h }),
      stageFindings: (run: number, car: string, kind: string, rows: unknown) => rpc(admin, 'autopilot_stage_findings', { p_run: run, p_car: car, p_kind: kind, p_rows: rows }),
      budgetLeft: () => rpc(admin, 'autopilot_budget_left', {}),
      userAgreement: (car: string) => rpc(admin, 'autopilot_user_agreement', { p_car: car }),
      loadLiveParts: async (car: string) => {
        const { data } = await admin.from('catalogue_parts').select('car_model_id,part_name,slot,brand,part_no,price,price_basis,note').eq('car_model_id', car);
        return data ?? [];
      },
      loadCar: carRow,
      // Read-only: every car_models row (any status) so a pending proposal is not re-proposed.
      loadAllModels: async () => {
        const { data } = await admin.from('car_models').select('id,model,generation,engine,status');
        return data ?? [];
      },
      // Read-only: rows already staged this run (runCommunity restages the union with runParts rows).
      stagedFindings: async (run: number, car: string, kind: string) => {
        const { data } = await admin.from('autopilot_findings').select('target_key,after,evidence,reason,verified').eq('run_id', run).eq('car_model_id', car).eq('kind', kind);
        return data ?? [];
      },
      loadLive: async (car: string) => {
        const { data } = await admin.from('dealer_plan_items').select('service,interval_km,interval_months,severe_km,severe_months,note,parts').eq('car_model_id', car);
        return data ?? [];
      },
      // Candidates come from this car's discover job in the same run (read-only).
      getCandidates: async (job: any) => {
        const { data } = await admin.from('autopilot_jobs').select('notes').eq('run_id', job.run_id).eq('car_model_id', job.car_model_id).eq('stage', 'discover').maybeSingle();
        return Array.isArray(data?.notes?.candidates) ? data.notes.candidates : [];
      },
      // Read-only list of URLs checked before (hashes themselves only via get/set RPCs). Empty => worst-case preview.
      knownSources: async (car: string) => {
        const { data } = await admin.from('autopilot_sources').select('url').eq('car_model_id', car);
        return (data ?? []).map((r: any) => r.url);
      },
    },
  };
}
