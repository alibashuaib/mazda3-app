/* ==== Autopilot stage runners — discover, extract, recalls, preview ====
   Pure orchestration. ALL I/O comes in through `deps` so tests drive it with fakes:
     deps.fetch(url, policy)  -> safeFetch result (bound to the DNS resolver by index.ts); the only way to read a URL
     deps.llm(request)        -> parsed Anthropic /v1/messages response (throws on HTTP failure)
     deps.db.*                -> thin RPC / read wrappers (see index.ts)
     deps.cfg                 -> {prices (incl. usd_sar), gccDomains, banned, maxUses, discoverModel, extractModel}
   Every paid call goes through paid(): reserve (cap + kill switch, atomic in SQL) -> llm -> settle.
   A runner returns {ok:true, notes} or {stop:'capped'|'stopped'|'ended'}; nothing here writes live tables
   or proposals (publish is the SQL function autopilot_publish_run). */
import { DEFAULT_POLICY, NHTSA_POLICY } from '../_shared/safe-fetch.mjs';
import { htmlToText, parseRecalls, sha256Hex } from '../plan-intake/logic.mjs';
import { buildSearchRequest, estimatePreview, extractSearchUrls, worstCaseEstimate } from './logic.mjs';
import { buildExtractPrompt, parseExtraction, validateItem } from './extract.mjs';

export const MAX_CANDIDATES = 4;   // sources read per car per run: bounds extract cost (D-01)
export const MAX_RESENDS = 2;      // pause_turn resends per search pass
export const DISCOVER_MAX_TOKENS = 1024;
export const EXTRACT_MAX_TOKENS = 4096;
const TEXT_LIMIT = 60000;          // htmlToText default; validators run on this exact text
const hostOf = u => { try { return new URL(u).hostname.toLowerCase(); } catch (e) { return ''; } };
const bump = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };

// Cap/kill answers end the run (staged findings dropped, nothing published). 'run_ended' = already over.
async function stopRun(job, deps, reason) {
  if (reason === 'run_ended') return { stop: 'ended' };
  const status = reason === 'killed' ? 'stopped' : 'capped';
  await deps.db.endRun(job.run_id, status);
  return { stop: status };
}

// reserve -> call -> settle. Settle's over flag means the call cost more than reserved: stop the run.
async function paid(job, deps, model, request, estSar) {
  const r = await deps.db.reserve(job.run_id, estSar);
  if (!r || !r.ok) return stopRun(job, deps, r && r.reason);
  let response;
  try {
    response = await deps.llm(request);
  } catch (e) {
    // Failed call: settle at zero usage so the reservation stops counting against the monthly cap.
    await deps.db.settle(r.reservation_id, model, {}).catch(() => {});
    throw e;
  }
  const s = await deps.db.settle(r.reservation_id, model, response && response.usage);
  if (!s || s.over) return stopRun(job, deps, 'cap');
  return { response };
}

const estimateFor = (deps, model, request, maxSearches) =>
  worstCaseEstimate({ model, inputChars: JSON.stringify(request).length, maxTokens: request.max_tokens, maxSearches }, deps.cfg.prices).sar;

export async function runDiscover(job, deps) {
  const { cfg, db } = deps;
  const car = await db.loadCar(job.car_model_id);
  const searchCfg = { model: cfg.discoverModel, max_tokens: DISCOVER_MAX_TOKENS, max_uses: cfg.maxUses, gcc_domains: cfg.gccDomains, banned: cfg.banned };
  let found = [];
  for (const pass of [1, 2]) {
    let request = buildSearchRequest(pass, car, searchCfg);
    if (!request) continue;                                   // pass 1 with no GCC domains configured
    for (let n = 0; n <= MAX_RESENDS; n++) {
      const out = await paid(job, deps, cfg.discoverModel, request, estimateFor(deps, cfg.discoverModel, request, cfg.maxUses));
      if (out.stop) return out;
      const got = extractSearchUrls(out.response, cfg.banned);
      found = found.concat(got.urls);
      if (!got.pause_turn) break;
      request = { ...request, messages: [...request.messages, { role: 'assistant', content: out.response.content }] };
    }
    if (found.length) break;                                  // pass 2 only when pass 1 found nothing
  }
  // D-06/D-07: unseen domains are held (listed as skipped), banned never kept, approved kept.
  const candidates = [], skipped = [], hosts = new Map();
  for (const url of [...new Set(found)]) {
    const host = hostOf(url);
    if (!hosts.has(host)) hosts.set(host, await db.seeDomain(host));
    const st = hosts.get(host);
    if (st === 'approved') { if (candidates.length < MAX_CANDIDATES) candidates.push(url); }
    else if (st === 'pending') skipped.push(`${host}: held (unseen domain)`);
  }
  return { ok: true, notes: { candidates, skipped } };
}

export async function runExtract(job, deps) {
  const { cfg, db } = deps;
  const car = await db.loadCar(job.car_model_id);
  const liveServices = await db.loadLive(job.car_model_id);
  const candidates = await db.getCandidates(job);
  const system = buildExtractPrompt(liveServices.map(s => s.service));
  const dropped = {}, skipped = [], rows = new Map(), toHash = [];
  let unchanged = 0;
  for (const url of candidates) {
    const res = await deps.fetch(url, DEFAULT_POLICY);
    if (!res.ok) { skipped.push(`${url}: ${res.error}`); continue; }
    // safeFetch follows redirects; the text we read must come from the host we were allowed to cite
    if (hostOf(res.finalUrl || url) !== hostOf(url)) { skipped.push(`${url}: redirected to other host`); continue; }
    if (res.kind !== 'text') { skipped.push(`${url}: ${res.kind}`); continue; }   // pdf skipped by owner default
    const text = htmlToText(res.body, TEXT_LIMIT);
    const hash = await sha256Hex(text);
    if (hash === await db.getSourceHash(job.car_model_id, url)) { unchanged++; continue; }   // ENG-08: no LLM cost
    const request = {
      model: cfg.extractModel, max_tokens: EXTRACT_MAX_TOKENS, temperature: 0, system,
      messages: [{ role: 'user', content: `Source ${url}\n<document>\n${text}\n</document>` }],
    };
    const out = await paid(job, deps, cfg.extractModel, request, estimateFor(deps, cfg.extractModel, request, 0));
    if (out.stop) return out;
    const block = (out.response.content || []).find(b => b && b.type === 'text');
    const items = parseExtraction(block && block.text);
    if (!items) { skipped.push(`${url}: unreadable`); continue; }   // fail closed, hash not saved so it is retried
    for (const item of items) {
      const v = validateItem(item, { fetchedText: text, liveServices, car, otherGenerations: car.otherGenerations });
      if (!v.ok) { bump(dropped, v.dropped[0]); continue; }
      for (const d of v.dropped) bump(dropped, d);
      if (rows.has(v.service)) { bump(dropped, 'duplicate_service'); continue; }
      rows.set(v.service, {
        target_key: v.service, after: v.after, verified: v.dropped.length === 0, reason: '',
        evidence: v.evidence.map(quote => ({ url, quote, tier: 'official', content_hash: hash })),
      });
    }
    toHash.push([url, hash]);
  }
  await db.stageFindings(job.run_id, job.car_model_id, 'schedule_item', [...rows.values()]);
  for (const [url, hash] of toHash) await db.setSourceHash(job.car_model_id, url, hash);   // only after staging succeeded
  return { ok: true, notes: { dropped, skipped, unchanged: candidates.length > 0 && unchanged === candidates.length } };
}

// "BM/BN · 2014–18", "BP · 2019+" -> model years (open-ended capped at the current year).
export function yearsOf(gen, nowYear = new Date().getFullYear()) {
  const m = String(gen ?? '').match(/(\d{4})\s*([-–]\s*(\d{2,4})|\+)/);
  if (!m) return [];
  const a = Number(m[1]);
  let b = nowYear;
  if (m[3]) b = m[3].length === 2 ? Number(String(a).slice(0, 2) + m[3]) : Number(m[3]);
  return Array.from({ length: Math.max(0, Math.min(b - a + 1, 15)) }, (_, i) => a + i);
}

// SCH-04: NHTSA is free (no reserve), still through safeFetch with the NHTSA policy.
export async function runRecalls(job, deps) {
  const car = await deps.db.loadCar(job.car_model_id);
  const years = yearsOf(car.generation);
  const merged = new Map(), dropped = {};
  let okFetches = 0;
  for (const y of years) {
    const model = /^\d+$/.test(car.model) ? 'mazda' + car.model : car.model;
    const url = `https://api.nhtsa.gov/recalls/recallsByVehicle?make=${encodeURIComponent(car.make)}&model=${encodeURIComponent(model)}&modelYear=${y}`;
    const res = await deps.fetch(url, NHTSA_POLICY);
    if (!res.ok) continue;
    if (hostOf(res.finalUrl || url) !== hostOf(url)) continue;   // redirected off the host recorded as evidence
    okFetches++;
    let j = null; try { j = JSON.parse(res.body); } catch (e) { /* unparseable body = no recalls */ }
    for (const f of parseRecalls(j, [y])) {
      const m = merged.get(f.campaign);
      if (m) m.years = [...new Set([...m.years, ...f.years])]; else merged.set(f.campaign, { ...f, url });
    }
  }
  if (years.length && !okFetches) throw new Error('nhtsa unavailable');   // retried by the job queue
  const rows = [];
  for (const f of merged.values()) {
    if (!f.component || !f.summary) { bump(dropped, 'recall_incomplete'); continue; }
    rows.push({
      target_key: f.campaign, verified: true, reason: '',
      after: { component: f.component, summary: f.summary, remedy: f.remedy, years: f.years.sort() },
      evidence: [{ url: f.url, quote: f.summary.slice(0, 300), tier: 'official' }],
    });
  }
  await deps.db.stageFindings(job.run_id, job.car_model_id, 'recall', rows);
  return { ok: true, notes: { dropped } };
}

// D-03: free. Fetch + hash compare only; zero search / LLM calls. A never-checked car has no known sources,
// so nothing can be skipped as unchanged and the estimate is the full worst case (basis 'worst-case').
// ponytail: typical-case, not a ceiling. A run can make more calls (pause_turn resends, the second search pass,
// new candidates found by discover). Spend stays safe because every call reserves against the cap first;
// count MAX_RESENDS and new candidates here if the owner wants a true upper bound.
export async function runPreview(carId, deps) {
  const { cfg, db } = deps;
  const car = await db.loadCar(carId);
  const known = await db.knownSources(carId);
  const probe = buildSearchRequest(cfg.gccDomains.length ? 1 : 2, car, { model: cfg.discoverModel, max_tokens: DISCOVER_MAX_TOKENS, max_uses: cfg.maxUses, gcc_domains: cfg.gccDomains, banned: cfg.banned });
  const est = {
    discover: { model: cfg.discoverModel, inputChars: JSON.stringify(probe || {}).length, maxTokens: DISCOVER_MAX_TOKENS, maxSearches: cfg.maxUses },
    extract: { model: cfg.extractModel, inputChars: TEXT_LIMIT + 4000, maxTokens: EXTRACT_MAX_TOKENS, maxSearches: 0 },
  };
  const hashes = {}, sources = [];
  for (const url of known) {
    const res = await deps.fetch(url, DEFAULT_POLICY);
    if (!res.ok || res.kind !== 'text') continue;
    sources.push({ url, hash: await sha256Hex(htmlToText(res.body, TEXT_LIMIT)) });
    hashes[url] = await db.getSourceHash(carId, url);
  }
  const basis = known.length ? 'known-sources' : 'worst-case';
  const unknown = Array.from({ length: MAX_CANDIDATES }, (_, i) => ({ url: 'unknown:' + i, hash: 'x' }));
  const out = estimatePreview({ sources: known.length ? sources : unknown, hashes, prices: cfg.prices, cfg: est });
  return { ...out, basis };
}
