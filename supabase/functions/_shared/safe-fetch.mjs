/* safeFetch: the one guarded fetch for scraped/external URLs in Edge Functions.
   Pure and dependency-injected (deps.fetch, deps.resolve) so Node tests run it with fakes; no runtime-specific imports.
   Never throws: resolves { ok:true, kind, body, finalUrl } or { ok:false, error }.
   error is one of blocked | redirect | type | size | timeout | status | robots | failed.

   Body contract: kind 'text' / 'json' carry the raw UTF-8 decoded string (HTML-to-text conversion stays in the
   caller); kind 'pdf' carries the base64 of the exact bytes.

   Residual risk (DNS rebinding): we resolve, then fetch resolves again, so a hostile DNS server can answer
   differently the second time. Re-checking on every hop narrows the window but does not close it. */
import { isPrivateIp, isSafeUrl } from './net-guard.mjs';

export const DEFAULT_POLICY = {
  maxHops: 3,
  deadlineMs: 20000,
  maxTextBytes: 2000000,
  maxPdfBytes: 8000000,
  allowedTypes: ['text/html', 'application/xhtml+xml', 'text/plain', 'application/pdf'],
  respectRobots: true,
  userAgent: 'CarCareCatalogueBot/1.0 (maintenance schedule research; admin-registered sources only)',
};

// NHTSA is a fixed public government JSON API, not scraping: owner-accepted (W-06) to skip robots.txt.
export const NHTSA_POLICY = { ...DEFAULT_POLICY, allowedTypes: ['application/json'], respectRobots: false, deadlineMs: 15000 };

const KIND = { 'application/pdf': 'pdf', 'application/json': 'json' };
const ROBOTS_MAX = 500000;

class Fail { constructor(error) { this.error = error; } }

export async function safeFetch(url, policy = DEFAULT_POLICY, deps = {}) {
  const p = { ...DEFAULT_POLICY, ...policy };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), p.deadlineMs);
  const aborted = new Promise((_, rej) => ctl.signal.addEventListener('abort', () => rej(new Fail('timeout'))));
  aborted.catch(() => {});                                    // handled: only raced, may never be awaited
  const race = (pr) => Promise.race([pr, aborted]);
  const robotsCache = new Map();

  // One guarded request chain: validates scheme/host/port/DNS on every hop, follows <= maxHops redirects.
  async function chain(start, wantRobots) {
    let cur = start;
    const seen = new Set();
    for (let hop = 0; ; hop++) {
      if (!isSafeUrl(cur)) throw new Fail('blocked');
      const host = new URL(cur).hostname;
      let addrs;
      try { addrs = await race(Promise.resolve(deps.resolve(host))); } catch (e) { throw e instanceof Fail ? e : new Fail('blocked'); }
      if (!Array.isArray(addrs) || !addrs.length || addrs.some(isPrivateIp)) throw new Fail('blocked');
      if (wantRobots && !(await robotsAllows(cur))) throw new Fail('robots');
      const res = await race(deps.fetch(cur, { redirect: 'manual', signal: ctl.signal, headers: { 'User-Agent': p.userAgent } }));
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        try { await res.body?.cancel(); } catch {}
        if (!loc || hop >= p.maxHops) throw new Fail('redirect');
        seen.add(cur);
        try { cur = new URL(loc, cur).toString(); } catch { throw new Fail('redirect'); }
        if (seen.has(cur)) throw new Fail('redirect');        // loop
        continue;
      }
      return { res, finalUrl: cur };
    }
  }

  async function readCapped(res, cap) {
    if (Number(res.headers.get('content-length') ?? 0) > cap) { try { await res.body?.cancel(); } catch {} throw new Fail('size'); }
    const reader = res.body.getReader();
    const chunks = []; let n = 0;
    for (;;) {
      const { done, value } = await race(reader.read());
      if (done) break;
      n += value.length;
      if (n > cap) { try { await reader.cancel(); } catch {} throw new Fail('size'); }
      chunks.push(value);
    }
    const buf = new Uint8Array(n); let o = 0;
    for (const c of chunks) { buf.set(c, o); o += c.length; }
    return buf;
  }

  async function robotsAllows(pageUrl) {
    const u = new URL(pageUrl);
    if (!robotsCache.has(u.origin)) {
      robotsCache.set(u.origin, (async () => {
        let r;
        try { r = await chain(u.origin + '/robots.txt', false); } catch (e) { if (e.error === 'timeout') throw e; throw new Fail('robots'); }
        if (r.res.status >= 400 && r.res.status < 500) { try { await r.res.body?.cancel(); } catch {} return ''; }   // RFC 9309: 4xx = no restrictions
        if (!r.res.ok) { try { await r.res.body?.cancel(); } catch {} throw new Fail('robots'); }                    // 5xx = assume disallowed
        try { return new TextDecoder().decode(await readCapped(r.res, ROBOTS_MAX)); } catch (e) { if (e.error === 'timeout') throw e; throw new Fail('robots'); }
      })());
    }
    return robotsPermit(await robotsCache.get(u.origin), u.pathname + u.search, p.userAgent);
  }

  try {
    const { res, finalUrl } = await chain(url, p.respectRobots);
    if (!res.ok) { try { await res.body?.cancel(); } catch {} throw new Fail('status'); }
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!p.allowedTypes.includes(type)) { try { await res.body?.cancel(); } catch {} throw new Fail('type'); }
    const kind = KIND[type] || 'text';
    const buf = await readCapped(res, kind === 'pdf' ? p.maxPdfBytes : p.maxTextBytes);
    let body;
    if (kind === 'pdf') { let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000)); body = btoa(bin); }
    else body = new TextDecoder().decode(buf);
    return { ok: true, kind, body, finalUrl };
  } catch (e) {
    if (e instanceof Fail) return { ok: false, error: e.error };
    return { ok: false, error: ctl.signal.aborted ? 'timeout' : 'failed' };
  } finally { clearTimeout(timer); }
}

/* robots.txt: longest matching rule wins, Allow wins ties; supports * and trailing $. Most specific
   User-agent group wins over "*". */
function robotsPermit(txt, path, ua) {
  const me = String(ua).split('/')[0].trim().toLowerCase();
  const groups = []; let cur = null, lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const m = raw.replace(/#.*/, '').match(/^\s*([A-Za-z-]+)\s*:\s*(.*?)\s*$/);
    if (!m) continue;
    const k = m[1].toLowerCase();
    if (k === 'user-agent') {
      if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(m[2].toLowerCase()); lastWasAgent = true;
    } else if ((k === 'allow' || k === 'disallow') && cur) {
      cur.rules.push([k === 'allow', m[2]]); lastWasAgent = false;
    } else lastWasAgent = false;
  }
  const mine = groups.filter(g => g.agents.some(a => a !== '*' && me.includes(a)));
  const use = mine.length ? mine : groups.filter(g => g.agents.includes('*'));
  let best = -1, allow = true, seen = 0;
  const p = path.slice(0, MAX_PATH);
  for (const g of use) for (const [ok, pat] of g.rules) {
    if (!pat || pat.length > MAX_PATTERN) continue;         // empty Disallow = allow all; oversized rule ignored
    if (++seen > MAX_RULES) return allow;                   // attacker-controlled file: bound the work
    if (globMatch(pat, p) && (pat.length > best || (pat.length === best && ok))) { best = pat.length; allow = ok; }
  }
  return allow;
}

const MAX_PATTERN = 512, MAX_RULES = 500, MAX_PATH = 1024;

/* Linear-backtracking glob (no RegExp, so no ReDoS): '*' matches any run, trailing '$' anchors the end,
   otherwise the pattern is a prefix match. Greedy two-pointer: remember only the last '*'. */
function globMatch(pat, s) {
  const anchored = pat.endsWith('$');
  let g = (anchored ? pat.slice(0, -1) : pat + '*').replace(/\*+/g, '*');
  let i = 0, j = 0, star = -1, mark = 0;
  while (i < s.length) {
    if (j < g.length && g[j] === '*') { star = j++; mark = i; }
    else if (j < g.length && g[j] === s[i]) { i++; j++; }
    else if (star >= 0) { j = star + 1; i = ++mark; }
    else return false;
  }
  while (j < g.length && g[j] === '*') j++;
  return j === g.length;
}
