/* Pure unit/currency conversion for the catalogue autopilot (CORE-07).
 * The LLM returns the ORIGINAL figure with its unit; this code converts, never
 * the model. Storage is canonical: distance in km, money in SAR per single
 * unit, VAT stated. Plain ES module, no Deno/Node APIs. */
const KM_PER_MILE = 1.609344;

export function milesToKm(mi) {
  const n = Number(mi);
  if (!Number.isFinite(n)) throw new Error('bad distance');
  return Math.round(n * KM_PER_MILE);
}

export function toKm(value, unit) {
  const u = String(unit || '').toLowerCase();
  if (u === 'km') return Math.round(Number(value));
  if (u === 'mi' || u === 'miles') return milesToKm(value);
  throw new Error('unknown distance unit');
}

/* amount without VAT, rounded to 2 decimals */
export function exVat(amount, vatIncluded, rate = 0.15) {
  const n = Number(amount);
  if (!Number.isFinite(n)) throw new Error('bad amount');
  return Math.round((vatIncluded ? n / (1 + rate) : n) * 100) / 100;
}

/* price of one unit when sold as a pack */
export function perUnitSar(price, packQty) {
  const p = Number(price), q = typeof packQty === 'number' ? packQty : NaN;
  if (!Number.isFinite(p) || !Number.isFinite(q) || q < 1) throw new Error('bad pack quantity');
  return Math.round((p / q) * 100) / 100;
}
