/* ==== Autopilot parts gates — fitment, 2-source part numbers, citation prices, materiality, trim ====
   Pure ES module, no I/O. The LLM is untrusted: these gates (not the prompt) enforce
   D-04 (fitment pinned to car:engine), D-05 (2 independent hosts for a part number),
   D-06 (snippet prices only from API cited_text), D-07 (materiality), D-13 (outlier trim). */
import { clash, nk, normaliseForQuote, quoteHasNumber } from './extract.mjs';
import { registrableHost } from './logic.mjs';
import { yearsOf } from './flow.mjs';

// Mazda-style numbers (PE01-14-302B, K020-W0-052E4). Aftermarket numbers match by brand + normPart text instead.
export const PART_NO_RE = /\b[A-Z0-9]{4}-?[A-Z0-9]{2}-?[A-Z0-9]{3,6}\b/;

export const normPart = s => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// D-07: BOTH >= minPct and >= minSar. No live value (null) => always material (an insert).
export function isMaterial(live, next, { minPct, minSar }) {
  if (live == null) return true;
  const d = Math.abs(next - live);
  return d >= minSar && d / live >= minPct;
}

// D-05: a number needs >= 2 distinct registrable hosts (subdomains count once). Tier 'official' never
// confirms a number alone: the Mazda KSA dealer list has no part numbers. Numbers under 6 chars are ignored.
// cands: [{part_no, host, tier?, quote?}] -> [{key, part_no, hosts, items}]
export function confirmParts(cands) {
  const by = new Map();
  for (const c of cands || []) {
    const key = normPart(c && c.part_no);
    if (key.length < 6) continue;
    if (!by.has(key)) by.set(key, []);
    by.get(key).push(c);
  }
  return [...by].map(([key, items]) => ({
    key, part_no: items[0].part_no, items,
    hosts: [...new Set(items.map(x => registrableHost(x.host)))],
  })).filter(g => g.hosts.length >= 2);
}

const ENGINE_RE = /(?<![\d.])\d\.\d\s*(?:l|litres?|liters?|لتر)(?![a-z])/g;
const YEAR_RE = /(?<![\d-])(?:19|20)\d\d(?![\d-])/g;

// D-04: quote must name the model; a year or engine it names must fit this car. null generation/engine = no check.
// Returns {ok:true} or {ok:false, reason}. car: {model, generation, engine}
export function checkFitment(quote, car) {
  const q = normaliseForQuote(quote), m = nk(car && car.model);
  // whole-token model match, spaces/hyphen optional ("CX-5", "CX5"); "cx5" must not match inside "cx50"
  const modelRe = m && new RegExp(`(?<![a-z0-9])${[...m].join('[\\s-]?')}(?![a-z0-9])`);
  if (!modelRe || !modelRe.test(q)) return { ok: false, reason: 'model_missing' };
  const yrs = (q.match(YEAR_RE) || []).map(Number), own = yearsOf(car.generation);
  if (yrs.length && own.length && !yrs.some(y => own.includes(y))) return { ok: false, reason: 'generation_mismatch' };
  const engs = q.match(ENGINE_RE) || [];
  if (engs.length && car.engine && engs.every(e => clash(e, car.engine))) return { ok: false, reason: 'engine_mismatch' };
  return { ok: true };
}

// D-06: the cited_text itself must hold the price beside SAR/SR/ر.س/ريال. Padding gives quoteHasNumber's
// 3-word floor without letting the model supply any text: the proof is the API's own cited_text.
export function priceFromCitation(citedText, price) {
  const t = String(citedText ?? '');
  return quoteHasNumber('price is ' + t, 'price is ' + t, price, 'sar');
}

// D-13: median of one-price-per-user, drop prices outside median +-30%, recount. Propose only if users >= 3.
export function trimmedMedian(prices) {
  const med = a => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const all = (prices || []).filter(p => Number.isFinite(p));
  if (!all.length) return { users: 0, median: null };
  const m0 = med(all), kept = all.filter(p => Math.abs(p - m0) <= 0.3 * m0);
  return { users: kept.length, median: kept.length ? med(kept) : null };
}

// Slot key for an aftermarket option (catalogue_parts.slot check: alt:[a-z0-9-]{1,40}).
export const altSlot = brand => 'alt:' + String(brand ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

// D-18: part names sharedParts() returns for a model with no catalogue rows. Duplicated because catalog.js is a
// classic script; test/autopilot-parts.test.js checks parity so a rename there fails here.
export const GENERIC_PARTS = Object.freeze([
  'Oil Filter', 'Fuel System Cleaner (additive)', 'Engine Air Filter', 'Cabin A/C Filter', 'Spark Plugs (each)',
  'Front Brake Pads', 'Rear Brake Pads', 'Brake Fluid (DOT 4)', 'Serpentine Belt', 'Wiper Blades (pair)',
  'Windshield Washer Fluid (~2L)', 'Engine Oil 5W-30', 'Coolant FL22 (long-life)', '12V Battery',
]);
