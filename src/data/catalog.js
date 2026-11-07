/* ============================================================
   Garage — Mazda SkyActiv catalogue. Static data plus the builders
   that stamp fresh ids onto it. No app state is read here.
   Dual-mode, like storage.js.
   ============================================================ */
'use strict';
(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const dep = isNode ? require('../core/helpers.js') : root;
  const api = factory(dep);
  if (isNode) module.exports = api;
  else Object.assign(root, api);
})(typeof self !== 'undefined' ? self : globalThis, function (dep) {

/* ============================================================
   Mazda SkyActiv catalogue — a data-driven profile per model.
   The service schedule is shared (SkyActiv-G is near-identical across
   models); only oil capacity and part numbers vary. Adding a car builds
   a fresh profile from here — light, offline, and cloud-ready.
   ============================================================ */
const DEFAULT_COLOR = 'Meteor Gray Mica (Code 42A)';
const MAZDA_PAINTS = {
  'Soul Red Metallic (Code 41V)': '#9c1f1a',
  'Soul Red Crystal Metallic (Code 46V)': '#8a1526',
  'Copper Red Mica (Code 32V)': '#7c2620',
  'Zeal Red Mica (Code 41G)': '#8f2020',
  'Artisan Red Premium (Code 51F)': '#54161b',
  'Snowflake White Pearl Mica (Code 25D)': '#f1efe8',
  'Crystal White Pearl Mica (Code 34K)': '#f2f0eb',
  'Rhodium White Premium (Code 51K)': '#e8e5da',
  'Wind Chill Pearl (Code 48K)': '#f1f1ed',
  'Jet Black Mica (Code 41W)': '#15161a',
  'Brilliant Black Clearcoat (Code A3F)': '#111214',
  'Deep Crystal Blue Mica (Code 42M)': '#17233d',
  'Blue Reflex Mica (Code 42B)': '#2f6fae',
  'Dynamic Blue Mica (Code 44J)': '#1760a0',
  'Eternal Blue Mica (Code 45B)': '#315c72',
  'Ingot Blue Metallic (Code 48B)': '#2c3f47',
  'Navy Blue Mica': '#172638',
  'Stormy Blue Mica (Code 35J)': '#344957',
  'Meteor Gray Mica (Code 42A)': '#59626e',
  'Machine Gray Metallic (Code 46G)': '#45484b',
  'Polymetal Gray Metallic (Code 47C)': '#6d7a80',
  'Aero Gray Metallic (Code 52C)': '#8d9495',
  'Dolphin Gray Mica (Code 39T)': '#5f6568',
  'Metropolitan Gray Mica (Code 36C)': '#5b6064',
  'Titanium Flash Mica (Code 42S)': '#5b5148',
  'Liquid Silver Metallic (Code 38P)': '#b9bec5',
  'Sonic Silver Metallic (Code 45P)': '#7f8386',
  'Platinum Quartz Metallic (Code 47S)': '#b6ad95',
  'Ceramic Metallic (Code 47A)': '#c5c6c2',
  'Zircon Sand Metallic (Code 48T)': '#8a8068',
  'Melting Copper Metallic (Code 52H)': '#a15c3c',
  'Cypress (Code 52T)': '#2f5a41',
  'Sky Blue Mica (Code 41B)': '#6b9fc4'
};
const paints = (...names) => names;
// Country codes (KSA, UAE, KW, QA, BH, OM) where the model is sold new or is a
// relevant used car. Source: official Mazda GCC model pages (2026). UAE follows the
// Saudi list. Old models (2015 and older) are Saudi-only, so they stay in the Saudi
// and UAE lists. Empty = hidden everywhere.
// { id, markets, model, generation, engines: [[code, oilLitresWithFilter], …] }
const CAR_MODELS = [
  { id: 'mazda2', markets: ['OM'], model: '2', gen: 'DJ · 2015+', engines: [['1.5L SkyActiv-G', 3.6]], colors: paints('Soul Red Crystal Metallic (Code 46V)', 'Snowflake White Pearl Mica (Code 25D)', 'Jet Black Mica (Code 41W)', 'Deep Crystal Blue Mica (Code 42M)', 'Dynamic Blue Mica (Code 44J)', 'Machine Gray Metallic (Code 46G)', 'Ceramic Metallic (Code 47A)', 'Platinum Quartz Metallic (Code 47S)') },
  { id: 'mazda3bm', markets: ['KSA','UAE'], model: '3', gen: 'BM/BN · 2014–18', engines: [['2.0L SkyActiv-G', 4.2], ['1.6L MZR', 3.9]], colors: paints(DEFAULT_COLOR, 'Soul Red Metallic (Code 41V)', 'Snowflake White Pearl Mica (Code 25D)', 'Jet Black Mica (Code 41W)', 'Deep Crystal Blue Mica (Code 42M)', 'Blue Reflex Mica (Code 42B)', 'Liquid Silver Metallic (Code 38P)', 'Titanium Flash Mica (Code 42S)') },
  { id: 'mazda3bp', markets: ['KSA','UAE','KW','QA','BH','OM'], model: '3', gen: 'BP · 2019+', engines: [['2.0L SkyActiv-G', 4.2], ['1.5L SkyActiv-G', 3.6], ['2.5L SkyActiv-G', 4.5]], colors: paints('Machine Gray Metallic (Code 46G)', 'Soul Red Crystal Metallic (Code 46V)', 'Snowflake White Pearl Mica (Code 25D)', 'Jet Black Mica (Code 41W)', 'Deep Crystal Blue Mica (Code 42M)', 'Polymetal Gray Metallic (Code 47C)', 'Platinum Quartz Metallic (Code 47S)', 'Ceramic Metallic (Code 47A)') },
  { id: 'mazda6', markets: ['KSA', 'UAE', 'KW', 'QA', 'BH', 'OM'], model: '6', gen: 'GJ/GL · 2013+', engines: [['2.5L SkyActiv-G', 4.5], ['2.0L SkyActiv-G', 4.3]], colors: paints('Machine Gray Metallic (Code 46G)', 'Soul Red Metallic (Code 41V)', 'Soul Red Crystal Metallic (Code 46V)', 'Snowflake White Pearl Mica (Code 25D)', 'Jet Black Mica (Code 41W)', 'Deep Crystal Blue Mica (Code 42M)', 'Blue Reflex Mica (Code 42B)', 'Sonic Silver Metallic (Code 45P)', 'Titanium Flash Mica (Code 42S)') },
  { id: 'cx3', markets: ['QA','BH','OM'], model: 'CX-3', gen: 'DK · 2015+', engines: [['2.0L SkyActiv-G', 4.2]], colors: paints('Machine Gray Metallic (Code 46G)', 'Soul Red Crystal Metallic (Code 46V)', 'Snowflake White Pearl Mica (Code 25D)', 'Jet Black Mica (Code 41W)', 'Deep Crystal Blue Mica (Code 42M)', 'Dynamic Blue Mica (Code 44J)', 'Ceramic Metallic (Code 47A)', 'Titanium Flash Mica (Code 42S)', 'Polymetal Gray Metallic (Code 47C)') },
  { id: 'cx30', markets: ['KSA','UAE','KW','QA','BH','OM'], model: 'CX-30', gen: 'DM · 2019+', engines: [['2.0L SkyActiv-G', 4.2], ['2.5L SkyActiv-G', 4.5]], colors: paints('Machine Gray Metallic (Code 46G)', 'Soul Red Crystal Metallic (Code 46V)', 'Snowflake White Pearl Mica (Code 25D)', 'Jet Black Mica (Code 41W)', 'Deep Crystal Blue Mica (Code 42M)', 'Polymetal Gray Metallic (Code 47C)', 'Platinum Quartz Metallic (Code 47S)', 'Ceramic Metallic (Code 47A)', 'Aero Gray Metallic (Code 52C)') },
  { id: 'cx5ke', markets: ['KSA','UAE'], model: 'CX-5', gen: 'KE · 2012–16', engines: [['2.0L SkyActiv-G', 4.2], ['2.5L SkyActiv-G', 4.8]], colors: paints(DEFAULT_COLOR, 'Soul Red Metallic (Code 41V)', 'Crystal White Pearl Mica (Code 34K)', 'Jet Black Mica (Code 41W)', 'Blue Reflex Mica (Code 42B)', 'Sky Blue Mica (Code 41B)', 'Stormy Blue Mica (Code 35J)', 'Liquid Silver Metallic (Code 38P)', 'Metropolitan Gray Mica (Code 36C)', 'Zeal Red Mica (Code 41G)') },
  { id: 'cx5kf', markets: ['KSA','UAE','KW','QA','BH','OM'], model: 'CX-5', gen: 'KF · 2017+', engines: [['2.5L SkyActiv-G', 4.8], ['2.0L SkyActiv-G', 4.2]], colors: paints('Machine Gray Metallic (Code 46G)', 'Soul Red Crystal Metallic (Code 46V)', 'Snowflake White Pearl Mica (Code 25D)', 'Rhodium White Premium (Code 51K)', 'Jet Black Mica (Code 41W)', 'Deep Crystal Blue Mica (Code 42M)', 'Eternal Blue Mica (Code 45B)', 'Sonic Silver Metallic (Code 45P)', 'Polymetal Gray Metallic (Code 47C)', 'Zircon Sand Metallic (Code 48T)') },
  { id: 'cx5gen3', markets: ['KSA','UAE','KW','QA','BH','OM'], model: 'CX-5', gen: '3rd gen · 2026+', engines: [['2.5L e-SkyActiv-G M Hybrid', 4.8]], colors: paints('Navy Blue Mica', 'Soul Red Crystal Metallic (Code 46V)', 'Rhodium White Premium (Code 51K)', 'Machine Gray Metallic (Code 46G)', 'Jet Black Mica (Code 41W)', 'Aero Gray Metallic (Code 52C)') },
  { id: 'cx9tb', markets: ['KSA','UAE'], model: 'CX-9', gen: 'TB · 2007–15', engines: [['3.5L MZI V6', 5.2, 6], ['3.7L MZI V6', 5.2, 6]], colors: paints('Dolphin Gray Mica (Code 39T)', 'Brilliant Black Clearcoat (Code A3F)', 'Crystal White Pearl Mica (Code 34K)', 'Copper Red Mica (Code 32V)', 'Liquid Silver Metallic (Code 38P)', 'Metropolitan Gray Mica (Code 36C)', 'Stormy Blue Mica (Code 35J)') },
  { id: 'cx9', markets: ['KSA','UAE','KW','QA','BH','OM'], model: 'CX-9', gen: 'TC · 2016+', engines: [['2.5L Turbo SkyActiv-G', 5.4]], colors: paints('Machine Gray Metallic (Code 46G)', 'Soul Red Crystal Metallic (Code 46V)', 'Snowflake White Pearl Mica (Code 25D)', 'Jet Black Mica (Code 41W)', 'Deep Crystal Blue Mica (Code 42M)', 'Sonic Silver Metallic (Code 45P)', 'Titanium Flash Mica (Code 42S)', 'Polymetal Gray Metallic (Code 47C)') },
  { id: 'cx50', markets: [], model: 'CX-50', gen: '2022+', engines: [['2.5L SkyActiv-G', 4.8], ['2.5L Turbo SkyActiv-G', 5.4]], colors: paints('Machine Gray Metallic (Code 46G)', 'Soul Red Crystal Metallic (Code 46V)', 'Wind Chill Pearl (Code 48K)', 'Jet Black Mica (Code 41W)', 'Ingot Blue Metallic (Code 48B)', 'Polymetal Gray Metallic (Code 47C)', 'Zircon Sand Metallic (Code 48T)', 'Cypress (Code 52T)') },
  { id: 'cx60', markets: ['KSA','UAE','KW','QA','BH','OM'], model: 'CX-60', gen: '2022+', engines: [['2.5L e-SkyActiv-G PHEV', 4.8, 4], ['3.3L e-SkyActiv-G', 5.1, 6], ['3.3L e-SkyActiv-D', 5.1, 6]], colors: paints('Machine Gray Metallic (Code 46G)', 'Soul Red Crystal Metallic (Code 46V)', 'Rhodium White Premium (Code 51K)', 'Jet Black Mica (Code 41W)', 'Deep Crystal Blue Mica (Code 42M)', 'Platinum Quartz Metallic (Code 47S)', 'Sonic Silver Metallic (Code 45P)', 'Artisan Red Premium (Code 51F)') },
  { id: 'cx70', markets: [], model: 'CX-70', gen: '2024+', engines: [['3.3L Turbo e-SkyActiv-G', 5.1, 6], ['2.5L e-SkyActiv-G PHEV', 4.8, 4]], colors: paints('Melting Copper Metallic (Code 52H)', 'Soul Red Crystal Metallic (Code 46V)', 'Rhodium White Premium (Code 51K)', 'Jet Black Mica (Code 41W)', 'Polymetal Gray Metallic (Code 47C)', 'Zircon Sand Metallic (Code 48T)') },
  { id: 'cx80', markets: [], model: 'CX-80', gen: '2024+', engines: [['3.3L e-SkyActiv-D', 5.1, 6], ['2.5L e-SkyActiv-G PHEV', 4.8, 4]], colors: paints('Artisan Red Premium (Code 51F)', 'Soul Red Crystal Metallic (Code 46V)', 'Rhodium White Premium (Code 51K)', 'Machine Gray Metallic (Code 46G)', 'Jet Black Mica (Code 41W)', 'Deep Crystal Blue Mica (Code 42M)', 'Platinum Quartz Metallic (Code 47S)', 'Melting Copper Metallic (Code 52H)') },
  { id: 'cx90', markets: ['KSA','UAE','KW','QA','BH','OM'], model: 'CX-90', gen: '2023+', engines: [['3.3L Turbo e-SkyActiv-G', 5.1, 6], ['2.5L e-SkyActiv-G PHEV', 4.8, 4]], colors: paints('Artisan Red Premium (Code 51F)', 'Soul Red Crystal Metallic (Code 46V)', 'Rhodium White Premium (Code 51K)', 'Machine Gray Metallic (Code 46G)', 'Jet Black Mica (Code 41W)', 'Deep Crystal Blue Mica (Code 42M)', 'Platinum Quartz Metallic (Code 47S)', 'Polymetal Gray Metallic (Code 47C)') }
];

/* Engine identity a service plan actually needs: the model's engine tuple is
   [code, oilL, cylinders?] — cylinders defaults to 4 (every current engine
   but the CX-9 TB's V6 and the CX-60/70/80/90's inline-six). Fuel is read off
   the code itself: 'e-SkyActiv-D' is this app's one consistent diesel marker
   everywhere else in the catalogue, so it doubles as the fuel-type check
   here rather than introducing a second, redundant flag to keep in sync. */
function engineInfo(modelId, engineCode) {
  const m = CAR_MODELS.find(x => x.id === modelId);
  // Saved cars can carry an older label for the same engine: match on displacement ("1.6L …") when the exact code is gone.
  const disp = s => (String(s || '').match(/^\d\.\dL/i) || [''])[0].toUpperCase();
  const found = m && (m.engines.find(e => e[0] === engineCode) || m.engines.find(e => disp(e[0]) && disp(e[0]) === disp(engineCode)));
  return {
    oilL: found ? found[1] : null,
    cylinders: (found && found[2]) || 4,
    fuel: /e-SkyActiv-D/i.test(engineCode || '') ? 'diesel' : 'gasoline'
  };
}
function sparkPlugService(cylinders) {
  const six = cylinders === 6;
  return { id: dep.uid(), name: six ? 'Spark Plugs (x6)' : 'Spark Plugs (x4)', icon: '⚡', cat: 'Engine',
    intervalKm: 120000, intervalMonths: 72, lastKm: 257000, lastDate: '2022-06-01', cost: six ? 510 : 340,
    note: `Iridium NGK ILKAR7L11 — every 120,000 km / 6 yr (Except-Europe schedule). Restores smooth idle & economy.${six ? ' Six-cylinder engine — six plugs, not four.' : ''}` };
}
function engineOilNote(oilL, fuel) {
  return fuel === 'diesel'
    ? `0W-30 low-SAPS (ACEA C3, DPF-safe) full synthetic — ~${oilL} L with filter. Every 7,500 km / 6 mo (severe) for Jeddah heat, dust & city driving. Never use a non-low-SAPS oil — the ash clogs the diesel particulate filter (DPF) over time. No fuel-system cleaner additive needed — this is compression-ignition, not the direct-injection gasoline SkyActiv-G.`
    : `5W-30 (API SP / ILSAC GF-6A) full synthetic — ~${oilL} L with filter. Every 7,500 km / 6 mo (severe) for Jeddah heat, dust & city driving. Add a fuel-system cleaner each oil change — mandatory for the direct-injection SkyActiv-G to keep injectors & intake valves clean.`;
}
/* The oil PART (what you'd actually buy) used to say a flat "(4L)" for every
   model regardless of engine — real capacity ranges 3.6-5.4 L across the
   lineup (CAR_MODELS' own oilL, already verified). Price is scaled off the
   4.2 L reference price so a bigger engine's estimate reflects needing more
   bottles, not the same price for more oil. */
function engineOilPart(modelId, oilL) {
  const scale = p => Math.round(p * oilL / 4.2);
  // Name stays the stable literal every other model's oil part already used
  // — SERVICE_PARTS and CRIT_HIGH (parts.js) match parts by exact name, and
  // a per-model name would silently break that cross-link for every model
  // whose oilL isn't the historical default. The capacity goes in the note
  // (and the price) instead, the same way skyactivServices' own oil note
  // already varies it — just now the actual part you'd buy agrees with it.
  return stampPartFitment({
    id: dep.uid(), name: 'Engine Oil 5W-30', icon: '🛢️', cat: 'Engine',
    options: [
      { tag: 'OEM', brand: 'Shell Helix Ultra SP 5W-30 (dexos1 Gen3)', partNo: '', price: scale(160), store: 'Amazon.sa', note: `API SP / ILSAC GF-6A full synthetic — ~${oilL} L with filter` },
      { tag: 'ALT', brand: 'TotalEnergies Quartz 9000 Future FGC 5W-30', partNo: '', price: scale(150), store: 'noon', note: 'Widely stocked in KSA' },
      { tag: 'ALT', brand: 'Fuchs Titan Supersyn D1 SAE 5W-30', partNo: '', price: scale(145), store: 'Local parts market' }
    ]
  }, modelId);
}
/* Coolant system capacity, sourced from Mazda's own capacities tables
   (owners-manual.mazda.com) per engine family — genuinely varies as much as
   oil does (6.0 L for the 1.5L up to an estimated 11.4 L for the old CX-9's
   V6), so a single "~6.6L" note for every model (which is what the part had
   before this) was never right at either end of the range. The CX-60/70/
   80/90 inline-six (either fuel) has no published capacities table found
   despite searching — marked unverified rather than presented as fact. */
function coolantLitersFor(modelId, engineCode) {
  const code = engineCode || '';
  if (/^1\.5L/.test(code)) return { liters: 6.0, verified: true };
  if (/^2\.0L/.test(code)) return { liters: 6.5, verified: true };
  if (modelId === 'cx9' && /Turbo/.test(code)) return { liters: 9.8, verified: true };  // CX-9 TC's own table — a larger radiator than the same 2.5T elsewhere
  if (/2\.5L Turbo/.test(code)) return { liters: 8.3, verified: true };                  // e.g. CX-50 2.5 Turbo
  if (/^2\.5L/.test(code)) return { liters: 6.6, verified: true };
  if (modelId === 'cx9tb') return { liters: 11.4, verified: false };  // V6 — estimated from a drain-and-fill figure, not a direct system-capacity source
  if (/3\.3L/.test(code)) return { liters: 10.5, verified: false };   // CX-60/70/80/90 inline-six — no published table found; estimated from comparable displacement/body class
  return { liters: 6.5, verified: false };  // BM's 1.6L option, CX-5 3rd-gen hybrid — not individually sourced; same-family estimate
}
function coolantPart(modelId, engineCode) {
  const { liters, verified } = coolantLitersFor(modelId, engineCode);
  const gal = Math.ceil(liters / 3.785);  // dealer sells FL22 by the US gallon; round up so the full fill is covered
  const note = verified
    ? `System holds ~${liters} L, per Mazda's capacities table for this engine. Replace every 5 years in KSA heat.`
    : `System holds an estimated ~${liters} L — no published capacity table found for this engine; confirm on your coolant reservoir or service sheet before buying. Replace every 5 years in KSA heat.`;
  // Same reasoning as engineOilPart: name stays the stable literal so
  // SERVICE_PARTS' 'Engine Coolant (FL22)' cross-link and CRIT_HIGH still
  // match it; the capacity goes in the note.
  return stampPartFitment({
    id: dep.uid(), name: 'Coolant FL22 (long-life)', icon: '🌡️', cat: 'Engine',
    options: [
      { tag: 'OEM', brand: 'Mazda Genuine FL22 Long Life', partNo: '0000-77-508E-20', price: 78.2, store: 'Mazda Dealer (Alireza)', note: note + ` Buy ${gal} gal (1 gal = 3.78 L); price is per gallon from the Mazda KSA dealer price list (SAR incl. VAT).` },
      { tag: 'ALT', brand: 'Total Glacelf Auto Supra', partNo: '', price: 85, store: 'Local parts market', note: 'KSA-available compatible coolant (per 5-yr plan)' },
      { tag: 'ALT', brand: 'Zerex Asian Blue (P-HOAT)', partNo: '', price: 85, store: 'Amazon.sa', note: 'Compatible chemistry' }
    ]
  }, modelId);
}
/* ATF-FZ capacity was two different, contradicting numbers depending on
   which builder created the part: mazda3Parts' own copy said "~3.5 L per
   drain, 7.8 L total"; sharedParts' said "~4.5-4.7 L per drain". Multiple
   independent parts suppliers cite the same ~4.5 L drain / 7.7-8.0 L total
   dry-fill figure across the Mazda3/CX-3/CX-5/CX-50/Mazda6 — i.e. every
   ATF-FZ model shares one 6-speed SkyActiv-Drive, so this genuinely does
   NOT vary per model the way oil and coolant do; the BM's own figure was
   simply the wrong one. One consistent, sourced note for every model now. */
const ATF_DRAIN_NOTE = '~4.5 L per drain (7.7–8.0 L total dry fill). Every 60–80k km; dealer or specialist.';

/* 12V starter/accessory battery — genuinely varies with engine and
   electrical load, the same way oil and coolant do. BM's own part said a
   flat "55Ah" with no orderable code at all; every other model's said
   neither. GCC-market Mazdas are sold with JIS-spec batteries (the
   XXDYYL/R code — e.g. 46B24L — rather than the US BCI group-size system),
   so the code that's actually useful for buying one locally is the JIS
   designation.

   The split isn't really about engine size — it's i-stop (Mazda's
   idle-stop-start). i-stop requires the Q-85 EFB battery, JIS 75D23L
   (~65Ah); only a non-i-stop trim can use the smaller 55D23L (~55-60Ah).
   i-stop has been standard equipment across nearly the whole SkyActiv-G
   lineup (2.0, 2.5, 2.5T, 3.3T) since its rollout, and this is directly
   confirmed for the BM: its own service manual specifies 75D23L, not the
   55D23L this file originally (wrongly) assumed for "non-turbo" engines —
   there's no such split; i-stop, not turbocharging, is what decides it.
   - Mazda2 (1.5L): 46B24L / 45Ah — its own smaller-case i-stop spec,
     confirmed for GCC/Asia-market Mazda2s specifically.
   - Every other current SkyActiv-G engine (2.0, 2.5 NA, 2.5 Turbo, 3.3
     six): 75D23L / 65Ah — Q-85, confirmed directly for the BM and for
     CX-5/CX-30/CX-9/CX-90, and taken as the lineup default since i-stop
     is standard equipment, not an exception.
   The older CX-9 TB's V6 (2007-2015, a pre-i-stop generation entirely)
   has no direct JIS source found — kept as its own estimate. */
function batteryAhFor(modelId, engineCode) {
  const code = engineCode || '';
  if (modelId === 'cx9tb') return { ah: 70, jis: '80D26L', verified: false };  // older V6, pre-i-stop generation — no direct JIS source found; estimated from comparable large-Mazda case size
  if (modelId === 'cx5gen3') return { ah: 72, jis: 'S-95', verified: true };  // all-new 3rd-gen platform (2026+), mild-hybrid — NA spec uses S-95 idle-stop battery, not the older D23L case
  if (/^1\.5L/.test(code)) return { ah: 45, jis: '46B24L', verified: true };  // Mazda2 — its own smaller-case i-stop spec
  return { ah: 65, jis: '75D23L', verified: true };  // every other current SkyActiv-G engine — Q-85 i-stop spec, confirmed for the BM and for CX-5/CX-30/CX-9/CX-90
}
function battery12VPart(modelId, engineCode) {
  const { ah, jis, verified } = batteryAhFor(modelId, engineCode);
  const note = verified ? undefined : `Ah rating and JIS code estimated — no published spec found for this engine; confirm the label on your current battery before buying.`;
  return stampPartFitment({
    id: dep.uid(), name: '12V Battery', icon: '🔋', cat: 'Electrical',
    options: [
      { tag: 'OEM', brand: `Mazda Genuine ${ah}Ah`, partNo: jis, price: Math.round(480 * ah / 60), store: 'Mazda Dealer (Alireza)', note },
      { tag: 'ALT', brand: 'Varta Blue Dynamic', partNo: jis, price: Math.round(360 * ah / 60), store: 'AC Delco / battery shop', note: 'Strong in heat' },
      { tag: 'ALT', brand: 'AC Delco', partNo: jis, price: Math.round(320 * ah / 60), store: 'Local battery shop' }
    ]
  }, modelId);
}
/* The CX-60/70/80/90's 3.3L mild-hybrid engine (either fuel) carries a
   second, separate battery system alongside the normal 12V one: a 48V
   lithium-ion pack (~0.33 kWh, sourced from Mazda's own parts listings for
   the 2024+ CX-90/CX-70). This is not a bigger 12V battery — it is a
   distinct, far more expensive component with its own failure mode, so it
   gets its own part rather than being folded into battery12VPart above.
   The 2.5L PHEV engine option on these same models has an entirely
   different, much larger traction battery costing an order of magnitude
   more (five figures USD) — out of scope here; this part is specifically
   the 3.3L mild-hybrid's 48V pack, and applies only to that engine choice,
   not every engine option on these four models. No aftermarket exists yet
   for a component this new — U.S. forum/shop estimates put a dealer
   replacement (battery + a required refrigerant service) at "at least
   $5,000", so the price here is a sourced floor, not a real quote. */
function mildHybridEngine(engineCode) { return /^3\.3L/.test(engineCode || ''); }
function mildHybridBatteryPart(modelId) {
  return stampPartFitment({
    id: dep.uid(), name: '48V Mild-Hybrid Battery Pack', icon: '⚡', cat: 'Electrical',
    options: [
      { tag: 'OEM', brand: 'Mazda Genuine 48V Li-ion M-Hybrid pack (~0.33 kWh)', partNo: '', price: 18750, store: 'Mazda Dealer (Alireza)', note: 'Dealer-only — no aftermarket exists yet. Figure is a sourced floor ("at least $5,000" incl. a required refrigerant service), not a quote; get the exact number from the dealer before budgeting.' }
    ]
  }, modelId);
}

/* Shared SkyActiv-G schedule (Jeddah "severe" base intervals; dealer "normal"
   values are layered on in normalizeData). Oil quantity varies per engine;
   spark-plug count and the oil spec vary with the engine's cylinder count
   and fuel type — a diesel has neither spark plugs nor a direct-injection
   gasoline fuel-system cleaner need, so its service omits that item
   entirely rather than showing one that doesn't apply. */
function skyactivServices(oilL, engineMeta) {
  const meta = engineMeta || { cylinders: 4, fuel: 'gasoline' };
  const list = [
      { id: dep.uid(), name: 'Engine Oil & Filter', icon: '🛢️', cat: 'Engine',
        intervalKm: 7500, intervalMonths: 6, lastKm: 0, lastDate: '', cost: 305,
        note: engineOilNote(oilL, meta.fuel) },
      { id: dep.uid(), name: 'Tire Rotation & Balance', icon: '🔄', cat: 'Tires',
        intervalKm: 10000, intervalMonths: 12, lastKm: 309000, lastDate: '2026-03-01', cost: 80,
        note: 'Rotate front/rear and rebalance to even out wear.' },
      { id: dep.uid(), name: 'Cabin (A/C) Filter', icon: '❄️', cat: 'Interior',
        intervalKm: 15000, intervalMonths: 12, lastKm: 306000, lastDate: '2026-01-20', cost: 70,
        note: 'Jeddah dust clogs it fast — replace ~yearly / 15,000 km; check before summer A/C season.' },
      { id: dep.uid(), name: 'Engine Air Filter', icon: '🌬️', cat: 'Engine',
        intervalKm: 20000, intervalMonths: 24, lastKm: 301000, lastDate: '2025-08-10', cost: 90,
        note: 'Inspect earlier in sandy conditions.' },
      { id: dep.uid(), name: 'Wheel Alignment', icon: '🎯', cat: 'Tires',
        intervalKm: 20000, intervalMonths: 24, lastKm: 301000, lastDate: '2025-08-10', cost: 120,
        note: 'Also after any pothole hit or new tires.' },
      { id: dep.uid(), name: 'Brake Fluid', icon: '🩸', cat: 'Brakes',
        intervalKm: 40000, intervalMonths: 24, lastKm: 289000, lastDate: '2024-09-01', cost: 150,
        note: 'DOT 3/4 (~1 L). Absorbs moisture over time — flush every 2 years.' },
      { id: dep.uid(), name: 'Automatic Transmission Fluid', icon: '⚙️', cat: 'Drivetrain',
        intervalKm: 60000, intervalMonths: 48, lastKm: 261000, lastDate: '2023-05-01', cost: 480,
        note: 'Mazda Genuine ATF-FZ only — ~3.5 L per drain (7.8 L total). Every 60–80k km; dealer or specialist.' },
      { id: dep.uid(), name: 'Engine Coolant (FL22)', icon: '🌡️', cat: 'Engine',
        intervalKm: 120000, intervalMonths: 60, lastKm: 291000, lastDate: '2023-08-01', cost: 220,
        note: 'Mazda FL22 long-life (HOAT), ~6.6 L. Replace every 5 years in KSA heat.' },
      { id: dep.uid(), name: 'Throttle Body & MAF Cleaning', icon: '🧴', cat: 'Engine',
        intervalKm: 15000, intervalMonths: 12, lastKm: 309000, lastDate: '2025-10-01', cost: 60,
        note: 'Clean throttle body & MAF sensor — Jeddah dust fouls them; restores idle & economy. (A known SkyActiv-G MAF weak point.)' },
      { id: dep.uid(), name: 'Fuel Filter', icon: '⛽', cat: 'Engine',
        intervalKm: 80000, intervalMonths: 72, lastKm: 241000, lastDate: '2021-05-01', cost: 180,
        note: 'In-tank filter; replace on high mileage.' },
      { id: dep.uid(), name: 'Drive (Serpentine) Belt', icon: '🔗', cat: 'Engine',
        intervalKm: 90000, intervalMonths: 72, lastKm: 251000, lastDate: '2021-11-01', cost: 200,
        note: 'Inspect for cracks/squeal; replace before it fails.' },
      { id: dep.uid(), name: 'Battery Check', icon: '🔋', cat: 'Electrical',
        intervalKm: 30000, intervalMonths: 12, lastKm: 311000, lastDate: '2025-10-01', cost: 0,
        note: 'Load-test yearly; Jeddah heat shortens battery life — plan to replace every 2–3 years.' },
      { id: dep.uid(), name: 'Brake Inspection & Caliper Lube', icon: '🛑', cat: 'Brakes',
        intervalKm: 10000, intervalMonths: 12, lastKm: 309000, lastDate: '2025-10-01', cost: 50,
        note: 'Inspect pads/discs & lubricate caliper slide pins — part of the 5-year Jeddah routine; prevents sticking calipers in the heat.' },
      { id: dep.uid(), name: 'Suspension & Steering Inspection', icon: '🔧', cat: 'Suspension',
        intervalKm: 20000, intervalMonths: 24, lastKm: 301000, lastDate: '2025-08-10', cost: 0,
        note: 'Check shocks, control arms, ball joints, sway-bar links, tie rods & coil springs — common SkyActiv wear points on rough roads.' }
  ];
  if (meta.fuel !== 'diesel') list.push(sparkPlugService(meta.cylinders));
  return list;
}

const UNIVERSAL_PART_NAMES = new Set([
  'Brake Fluid (DOT 4)',
  'Windshield Washer Fluid (~2L)'
]);
const ATF_FZ_MODEL_IDS = ['mazda2', 'mazda3bm', 'mazda3bp', 'mazda6', 'cx3', 'cx30', 'cx5ke', 'cx5kf', 'cx9', 'cx50'];
const LEGACY_GENERIC_SIGNATURES = {
  'Engine Oil 5W-30': 'Shell Helix Ultra SP 5W-30',
  'Oil Filter': 'Mazda Genuine (SkyActiv-G — commonly shared)',
  'Fuel System Cleaner (additive)': 'Liqui Moly / Techron DI cleaner',
  'Engine Air Filter': 'Mazda Genuine (verify for your model)',
  'Cabin A/C Filter': 'Mazda Genuine (verify for your model)',
  'Spark Plugs (each)': 'Mazda / NGK Iridium (verify for your engine)',
  'Front Brake Pads': 'Mazda Genuine (verify for your model)',
  'Rear Brake Pads': 'Mazda Genuine (verify for your model)',
  'Serpentine Belt': 'Mazda Genuine (verify for your model)',
  '12V Battery': 'Mazda Genuine',
  'Wiper Blades (pair)': 'Bosch Aerotwin'
};

function modelUsesAtfFz(modelId) { return ATF_FZ_MODEL_IDS.includes(modelId); }
function stampPartFitment(part, modelId) {
  if (UNIVERSAL_PART_NAMES.has(part.name)) part.fitment = { shareable: true, modelIds: [] };
  else if (part.name === 'ATF FZ (per liter)') part.fitment = { shareable: false, modelIds: ATF_FZ_MODEL_IDS.slice() };
  else part.fitment = { shareable: false, modelIds: modelId ? [modelId] : [] };
  return part;
}
function stampPartsFitment(parts, modelId) {
  return parts
    .filter(p => p.name !== 'ATF FZ (per liter)' || modelUsesAtfFz(modelId))
    .map(p => stampPartFitment(p, modelId));
}
function ensurePartFitment(part, modelId) {
  const fit = part && part.fitment;
  if (fit && typeof fit.shareable === 'boolean' && Array.isArray(fit.modelIds)) return part;
  return stampPartFitment(part, modelId);
}
function partFitsCar(part, car) {
  if (!part || !car) return false;
  const fit = part.fitment;
  if (!fit || typeof fit.shareable !== 'boolean' || !Array.isArray(fit.modelIds)) return false;
  return fit.shareable || fit.modelIds.includes(car.modelId);
}
function isLegacyUnverifiedPart(part, modelId) {
  if (!part || part.fitment) return false;
  const signature = LEGACY_GENERIC_SIGNATURES[part.name];
  const brand = part.options && part.options[0] && part.options[0].brand;
  return !!signature && String(brand || '').startsWith(signature);
}

/* OEM numbers confirmed against the PartSouq catalogue and price-checked against
   miata-mazda.com (SAR incl. VAT, rounded) — [partNo, price, enginePrefix?], keyed by model
   then part name. The price is always the miata-mazda.com one; where PartSouq's price was
   more than 30% lower (cx5 cabin, cx5ke belt, cx9 air/belt) the owner chose miata anyway.
   An optional engine prefix limits the entry to engines whose name starts with it; a part
   can carry a list of such entries when each engine takes a different number.
   cx3 / cx9 plugs, cx5 2.5L belt and cx9tb cabin / front pads were found by part-number search
   on PartSouq (plus Mazda's CX-3 owner's manual for the plug), not a VIN diagram. */
const OEM_CHECKED = {
  // 1.6L is the Z-family MZR engine (as in the Mazda 2 DE), which takes B6Y1-14-302A; PartSouq
  // lists PE01-14-302 as its substitute. Not checked on a BM 1.6 VIN diagram.
  mazda3bm: { 'Oil Filter': [['PE01-14-302B', 29, '2.0L'], ['B6Y1-14-302A', 26, '1.6L']] },
  // miata-mazda.com has no Mazda 2 DJ, so the air filter and belt carry PartSouq's price.
  mazda2: { 'Oil Filter': ['PE01-14-302B', 29], 'Engine Air Filter': ['P501-13-3A0', 56, null, 'PartSouq'], 'Serpentine Belt': ['P51D-15-909', 67, null, 'PartSouq'] },
  mazda6: {
    'Oil Filter': ['PE01-14-302B', 29], 'Engine Air Filter': ['PE07-13-3A0A', 60],
    'Front Brake Pads': ['G4YA-33-28ZA', 378], 'Rear Brake Pads': ['GMY0-26-43ZB', 411]
  },
  cx3: {
    'Oil Filter': ['PE01-14-302B', 29], 'Engine Air Filter': ['PEHH-13-3A0', 85], 'Cabin A/C Filter': ['D09W-61-J6X', 97], 'Spark Plugs (each)': ['PE5R-18-110', 91],
    'Front Brake Pads': ['B6YS-33-28ZA', 374], 'Rear Brake Pads': ['DAY3-26-48ZA', 229]
  },
  cx5ke: {
    'Oil Filter': ['PE01-14-302B', 29], 'Engine Air Filter': ['PE07-13-3A0A', 89], 'Spark Plugs (each)': ['PE5R-18-110', 91],
    'Front Brake Pads': ['K0Y1-33-28ZA', 386], 'Rear Brake Pads': ['KAY0-26-48Z', 242],
    'Cabin A/C Filter': ['KD45-61-J6X', 103], 'Serpentine Belt': [['PE08-15-909C', 115, '2.0L'], ['PY01-15-909A', 144, '2.5L']]
  },
  cx5kf: {
    'Oil Filter': ['PE01-14-302B', 29], 'Engine Air Filter': ['PE07-13-3A0A', 89], 'Spark Plugs (each)': ['PE5R-18-110', 91],
    'Front Brake Pads': ['K0Y1-33-28ZA', 386], 'Rear Brake Pads': ['KAY0-26-48Z', 242],
    'Cabin A/C Filter': ['KD45-61-J6X', 103], 'Serpentine Belt': ['PY01-15-909A', 144, '2.5L'] // 2.0L not checked
  },
  // Checked on the 3.7L catalogue. CA02-14-302 supersedes YF09-14-302A (CX-9 from 2007);
  // CY01-13-Z40B supersedes Z40A and CY01-15-908D is listed for 3.5L and 3.7L (mazdapartsnow).
  cx9tb: {
    'Oil Filter': ['CA02-14-302', 26], 'Engine Air Filter': ['CY01-13-Z40B', 97], 'Serpentine Belt': ['CY01-15-908D', 121],
    'Cabin A/C Filter': ['L2Y6-61-P11', 97], 'Front Brake Pads': ['L2Y6-33-28ZB', 374], 'Rear Brake Pads': ['L2Y8-26-43ZA', 302]
  },
  cx9: {
    'Oil Filter': ['PY8W-14-302', 29], 'Cabin A/C Filter': ['TK48-61-J6X', 103], 'Front Brake Pads': ['TKY8-33-28Z', 374], 'Rear Brake Pads': ['TKY8-26-48ZA', 374],
    'Spark Plugs (each)': ['PY8V-18-110', 91],
    'Engine Air Filter': ['PY8W-13-3A0', 103], 'Serpentine Belt': ['PY01-15-909A', 144]
  }
};
/* Mazda KSA dealer prices (mazda.com.sa/ppl, SAR incl. VAT, rounded, 2026-11-07). These are the
   dealer's genuine-part prices, so they replace every OEM price for the parts listed, also where
   the OEM number came from PartSouq. The dealer list names parts but gives no numbers. A value can
   be a list of [price, enginePrefix] when the dealer lists engines separately or only one engine is
   known to match. Page per model: mazda3bm = Mazda 3 1.6L / 2.0L; mazda3bp = New Mazda 3 2.0
   (also used for 1.5L / 2.5L); mazda6 = Mazda 6 Standard; cx5ke / cx5kf = CX-5; cx9 = CX-9 2.5L;
   cx9tb = CX-9 3.7L (plug and belt kept to 3.7L, 3.5L fitment unconfirmed); cx60 = CX-60 (3.3L)
   and CX-60 2.5L; cx90 = CX-90 (one page for both engines). Left out on purpose: coolant (the list
   does not say how much the price buys); the CX-30 (23) and CX-90 (42.55) belts (look like a
   different, small belt); the CX-5 KE belts (one dealer price, two engine-specific numbers); and
   cars with no dealer page (mazda2, cx5gen3, cx50, cx70, cx80). */
const DEALER_CX5 = { 'Oil Filter': 30, 'Engine Air Filter': 114, 'Cabin A/C Filter': 129, 'Spark Plugs (each)': 104, 'Front Brake Pads': 397, 'Rear Brake Pads': 293 };
const DEALER_PRICE = {
  mazda3bm: {
    'Oil Filter': [[26, '1.6L'], [30, '2.0L']], 'Engine Air Filter': [[94, '1.6L'], [114, '2.0L']],
    'Cabin A/C Filter': 129, 'Spark Plugs (each)': [[23, '1.6L'], [104, '2.0L']],
    'Front Brake Pads': 397, 'Rear Brake Pads': 334, 'Serpentine Belt': [[150, '1.6L'], [127, '2.0L']]
  },
  mazda3bp: { 'Oil Filter': 30, 'Engine Air Filter': 114, 'Cabin A/C Filter': 132, 'Spark Plugs (each)': 104, 'Front Brake Pads': 437, 'Rear Brake Pads': 414, 'Serpentine Belt': 127 },
  mazda6: { 'Oil Filter': 30, 'Engine Air Filter': 114, 'Cabin A/C Filter': 129, 'Spark Plugs (each)': 104, 'Front Brake Pads': 437, 'Rear Brake Pads': 449, 'Serpentine Belt': 127 },
  cx3: { 'Oil Filter': 30, 'Engine Air Filter': 114, 'Cabin A/C Filter': 132, 'Spark Plugs (each)': 104, 'Front Brake Pads': 397, 'Rear Brake Pads': 322, 'Serpentine Belt': 127 },
  cx30: { 'Oil Filter': 30, 'Engine Air Filter': 114, 'Cabin A/C Filter': 132, 'Spark Plugs (each)': 104, 'Front Brake Pads': 495, 'Rear Brake Pads': 414 },
  cx5ke: DEALER_CX5,
  cx5kf: Object.assign({ 'Serpentine Belt': [[127, '2.0L']] }, DEALER_CX5),
  cx9: { 'Oil Filter': 33, 'Engine Air Filter': 121, 'Cabin A/C Filter': 140, 'Spark Plugs (each)': 104, 'Front Brake Pads': 449, 'Rear Brake Pads': 403, 'Serpentine Belt': 127 },
  cx9tb: {
    'Oil Filter': 30, 'Engine Air Filter': 121, 'Cabin A/C Filter': 129, 'Spark Plugs (each)': [[33, '3.7L']],
    'Front Brake Pads': 391, 'Rear Brake Pads': 391, 'Serpentine Belt': [[132, '3.7L']]
  },
  cx60: {
    'Oil Filter': 35, 'Engine Air Filter': 132, 'Cabin A/C Filter': 140, 'Spark Plugs (each)': 115,
    'Front Brake Pads': [[518, '3.3L'], [610, '2.5L']], 'Rear Brake Pads': 799, 'Serpentine Belt': [[101, '3.3L'], [127, '2.5L']]
  },
  cx90: { 'Oil Filter': 35, 'Engine Air Filter': 132, 'Cabin A/C Filter': 140, 'Spark Plugs (each)': 115, 'Front Brake Pads': 518, 'Rear Brake Pads': 736 }
};
/* Front wiper lengths in inches [driver, passenger] (left-hand drive), from aftermarket
   size charts (wipersizechart.com, UK wiper retailers). No OEM wiper price could be
   checked, so the aftermarket option carries the size instead. cx5gen3 is from one source
   (oximo.pl, CX-5 2025-09+).
   Mazda 2 DJ is left out: the catalogue has one DJ entry for 2015+, and the 2022+ facelift
   (24" + 16") differs from 2015-21 (17" passenger), so no single pair is right for it. */
const WIPER_IN = {
  mazda3bm: [24, 18], mazda3bp: [26, 17], mazda6: [24, 18], cx3: [22, 19], cx30: [26, 16],
  cx5ke: [24, 18], cx5kf: [24, 18], cx5gen3: [26, 17], cx9tb: [26, 17], cx9: [24, 18], cx50: [26, 15], cx60: [26, 16],
  cx70: [26, 17], cx80: [26, 16], cx90: [26, 17]
};
/* Cheapest Amazon.sa price (SAR, 2026-11-07) for a single Bosch Aerotwin hook-fit (AP/AR…U)
   front blade, by inches; a pair is priced as two singles. No 15" listing, so cx50 keeps 95. */
const BOSCH_SINGLE_SAR = { 16: 87, 17: 84, 18: 83, 19: 103, 22: 96, 24: 150, 26: 89 };

/* Generic SkyActiv-G consumables — every model starts with these until its own
   OEM numbers are filled in. Numbers vary by model, so verify before buying.

   stampPartsFitment already locks every non-universal part to `modelId` (and
   already drops ATF FZ for a model that doesn't use it) — a trailing
   `.filter(p => p.fitment.shareable || p.name === 'ATF FZ (per liter)')` used
   to run on top of that and threw away everything else: Engine Oil, Oil
   Filter, Fuel System Cleaner, both air filters, spark plugs, both brake
   pads, the serpentine belt, the battery and the wipers. Verified: every
   model had only 3-4 parts total (cx90: Brake Fluid, Coolant, Washer
   Fluid). Every model — including the BM, which used to have its own
   separate hardcoded catalogue — now gets the same full 15-part starter
   list this comment always said was the intent, with placeholder ("verify
   for your model") brand/part numbers until real OEM data is filled in. */
function sharedParts(modelId, engineCode) {
  const P = (name, icon, cat, options) => ({ id: dep.uid(), name, icon, cat, options });
  const D = 'Mazda Dealer (Alireza)', A = 'Amazon.sa';
  // Callers that predate engineCode (existing tests, the sharedParts backfill
  // in normalize.js) still get a correct oil/coolant capacity by falling
  // back to this model's first listed engine, rather than silently reverting
  // to a generic guess.
  const m = CAR_MODELS.find(x => x.id === modelId);
  const code = engineCode || (m && m.engines[0] && m.engines[0][0]) || '';
  const oilL = engineInfo(modelId, code).oilL || 4.2;
  const checked = OEM_CHECKED[modelId] || {};
  const parts = [
    P('Oil Filter', '🧽', 'Engine', [
      { tag: 'OEM', brand: 'Mazda Genuine (SkyActiv-G — commonly shared)', partNo: 'PE01-14-302B', price: 45, store: D, note: 'One filter fits most SkyActiv-G engines — verify' },
      { tag: 'ALT', brand: 'Denso 150-2010', partNo: '150-2010', price: 28, store: A }]),
    P('Fuel System Cleaner (additive)', '🧴', 'Engine', [
      { tag: 'ALT', brand: 'Liqui Moly / Techron DI cleaner', partNo: '', price: 45, store: A, note: 'Mandatory for direct-injection SkyActiv-G' }]),
    P('Engine Air Filter', '🌬️', 'Engine', [
      { tag: 'OEM', brand: 'Mazda Genuine (verify for your model)', partNo: '', price: 90, store: D },
      { tag: 'ALT', brand: 'Blue Print / WIX', partNo: '', price: 45, store: A }]),
    P('Cabin A/C Filter', '❄️', 'Interior', [
      { tag: 'OEM', brand: 'Mazda Genuine (verify for your model)', partNo: '', price: 80, store: D },
      { tag: 'ALT', brand: 'Denso Carbon Cabin', partNo: '', price: 45, store: A }]),
    P('Spark Plugs (each)', '⚡', 'Engine', [
      { tag: 'OEM', brand: 'Mazda / NGK Iridium (verify for your engine)', partNo: '', price: 70, store: D },
      { tag: 'ALT', brand: 'NGK / Denso Iridium', partNo: '', price: 50, store: A }]),
    P('Front Brake Pads', '🛑', 'Brakes', [
      { tag: 'OEM', brand: 'Mazda Genuine (verify for your model)', partNo: '', price: 300, store: D },
      { tag: 'ALT', brand: 'Akebono Ceramic', partNo: '', price: 200, store: A }]),
    P('Rear Brake Pads', '🛑', 'Brakes', [
      { tag: 'OEM', brand: 'Mazda Genuine (verify for your model)', partNo: '', price: 260, store: D },
      { tag: 'ALT', brand: 'Akebono Ceramic', partNo: '', price: 170, store: A }]),
    P('Brake Fluid (DOT 4)', '🩸', 'Brakes', [
      { tag: 'OEM', brand: 'Motul DOT 3 & 4', partNo: '', price: 35, store: A, note: '~1 L for a full flush' }]),
    P('ATF FZ (per liter)', '⚙️', 'Drivetrain', [
      { tag: 'OEM', brand: 'Mazda Genuine ATF-FZ (only)', partNo: 'K020-W0-052E4', price: 60, store: D, note: ATF_DRAIN_NOTE }]),
    P('Serpentine Belt', '🔗', 'Engine', [
      { tag: 'OEM', brand: 'Mazda Genuine (verify for your model)', partNo: '', price: 150, store: D },
      { tag: 'ALT', brand: 'Gates Micro-V', partNo: '', price: 90, store: A }]),
    P('Wiper Blades (pair)', '🌧️', 'Exterior', [
      { tag: 'ALT', brand: 'Bosch Aerotwin', partNo: '', price: 95, store: A }]),
    P('Windshield Washer Fluid (~2L)', '💦', 'Exterior', [
      { tag: 'ALT', brand: 'Ready-mix washer fluid', partNo: '', price: 15, store: 'noon' }])
  ];
  parts.forEach(p => {
    const e = checked[p.name], c = e && (Array.isArray(e[0]) ? e : [e]).find(x => !x[2] || code.startsWith(x[2]));
    const o = c && p.options.find(x => x.tag === 'OEM');
    if (o) Object.assign(o, { brand: 'Mazda Genuine', partNo: c[0], price: c[1], note: c[3] === 'PartSouq'
      ? 'OEM no. and price from PartSouq (USD converted to SAR)'
      : 'OEM no. from PartSouq catalogue; price checked on miata-mazda.com (SAR incl. VAT)' });
    const d = (DEALER_PRICE[modelId] || {})[p.name];
    const price = Array.isArray(d) ? (d.find(x => code.startsWith(x[1])) || [])[0] : d;
    const po = price && p.options.find(x => x.tag === 'OEM');
    if (po) Object.assign(po, { price, note: po.partNo
      ? 'OEM no. from PartSouq catalogue; price from the Mazda KSA dealer price list (SAR incl. VAT)'
      : 'Price from the Mazda KSA dealer price list (SAR incl. VAT); no part number listed' });
    // Remembers which price came from the catalogue, so normalizeData can refresh a saved car's
    // OEM option later without overwriting a price the owner typed in.
    p.options.forEach(x => { if (x.tag === 'OEM') x.catPrice = x.price; });
  });
  const w = WIPER_IN[modelId];
  const wPrice = w && BOSCH_SINGLE_SAR[w[0]] && BOSCH_SINGLE_SAR[w[1]] ? BOSCH_SINGLE_SAR[w[0]] + BOSCH_SINGLE_SAR[w[1]] : 95;
  if (w) Object.assign(parts.find(p => p.name === 'Wiper Blades (pair)').options[0], { brand: `Bosch Aerotwin ${w[0]}" + ${w[1]}"`, price: wPrice, note: `Driver ${w[0]}" (${Math.round(w[0] * 25.4)} mm) + passenger ${w[1]}" (${Math.round(w[1] * 25.4)} mm), from aftermarket size charts — check your blades before buying` });
  return stampPartsFitment(parts, modelId).concat([engineOilPart(modelId, oilL), coolantPart(modelId, code), battery12VPart(modelId, code)]);
}

/* Every hatch/sedan takes a passenger-car tire the same way; only the
   CX-line's height and load actually change what fits. */
/* How many catalogue models carry this same part (same name and same OEM part numbers).
   Quantity is ignored on purpose: a part shared by two cars is shared even when each car needs a different amount. */
let _sharedMap = null;
function partSig(name, options) { return name + '|' + (options || []).map(o => o.partNo || '').sort().join(';'); }
function sharedAcrossModels(part) {
  if (!_sharedMap) {
    _sharedMap = new Map();
    CAR_MODELS.forEach(m => m.engines.forEach(e => {
      partsForModel(m.id, e[0]).forEach(p => {
        const k = partSig(p.name, p.options);
        if (!_sharedMap.has(k)) _sharedMap.set(k, new Set());
        _sharedMap.get(k).add(m.id);
      });
    }));
  }
  const s = _sharedMap.get(partSig(part.name, part.options));
  return s ? s.size : 1;
}
/* Cold tire pressure [front, rear] in psi, for the models whose figure the
   sources agree on (tirepressure.com, Firestone, dealer pages). Not in this table
   (conflicting or no source): mazda2, cx5ke, cx5kf, cx5gen3, cx9tb, cx80, cx90 —
   those keep the generic 36 psi tip until confirmed. Always confirm on the door-jamb sticker. */
const TIRE_PSI = {
  mazda3bm: ['36', '36'], mazda3bp: ['36', '36'], mazda6: ['35', '35'], cx3: ['36', '33'],
  cx30: ['36–38', '36'], cx9: ['34', '34'], cx50: ['35–36', '35–36'], cx60: ['36', '36'], cx70: ['36', '36']
};
function tireShapeFor(modelId) { return /^cx/.test(modelId || '') ? 'suv' : 'sedan'; }

/* OEM factory tire size per model (most common trim — a top trim on 1-2"
   larger wheels is common and changes this; always confirm on the door-jamb
   sticker before ordering). Locked per car, unlike every other shared
   consumable, because this is the one part where the wrong size does not
   just under-perform — it may not legally or safely fit. */
const OEM_TIRE_SIZE = {
  mazda2: '185/65R15',
  mazda3bm: '205/60R16',
  mazda3bp: '205/60R16',
  mazda6: '215/45R18',
  cx3: '215/50R18',
  cx30: '215/55R18',
  cx5ke: '225/65R17',
  cx5kf: '225/65R17',
  cx5gen3: '225/65R17',
  cx9tb: '245/60R18',
  cx9: '255/60R18',
  cx50: '225/65R17',
  cx60: '235/60R18',
  cx70: '265/55R19',
  cx80: '235/55R19',
  cx90: '255/60R18'
};
/* Community-recommended lines for KSA conditions, by body shape — sustained
   summer asphalt heat ages rubber faster than a cooler climate would, so a
   touring/highway tread wins over an aggressive one even on an SUV built
   mostly for daily highway driving. Prices are rough per-tire estimates. */
const TIRE_BRAND_PICKS = {
  sedan: [
    { tag: 'OEM', brand: 'As fitted — Bridgestone / Yokohama / Toyo (varies by build batch)', price: 350, note: 'Match the size, not necessarily the brand — Mazda sources sedan OEM tires from more than one maker.' },
    { tag: 'ALT', brand: 'Michelin Primacy 4 ST', price: 480, note: 'Community default for daily highway driving — strong wet grip, long tread life.' },
    { tag: 'ALT', brand: 'Yokohama BluEarth-XT AE61', price: 380, note: 'Popular value pick locally for Mazda 3/6 — solid heat resistance for the price.' }
  ],
  suv: [
    { tag: 'OEM', brand: 'As fitted — Bridgestone / Yokohama / Toyo (varies by build batch)', price: 420, note: 'Match the size, not necessarily the brand — Mazda sources SUV OEM tires from more than one maker.' },
    { tag: 'ALT', brand: 'Michelin Primacy SUV+ / Latitude Tour HP', price: 560, note: 'The touring choice most recommended for CX-5/CX-9 daily driving — quiet, handles the extra weight well.' },
    { tag: 'ALT', brand: 'Yokohama Geolandar CV G058', price: 480, note: 'Comfort-focused highway tread, a frequent local pick for its ride quality.' }
  ]
};
function tiresPart(modelId) {
  const size = OEM_TIRE_SIZE[modelId] || '';
  const store = 'Multiple KSA tire shops';
  return stampPartFitment({
    id: dep.uid(), name: size ? `Tires (${size}, each)` : 'Tires', icon: '🛞', cat: 'Tires',
    options: TIRE_BRAND_PICKS[tireShapeFor(modelId)].map(p => ({ tag: p.tag, brand: p.brand, partNo: size, price: p.price, store, note: p.note }))
  }, modelId);
}

function partsForModel(modelId, engineCode) {
  const base = sharedParts(modelId, engineCode);
  const extra = [tiresPart(modelId)];
  if (mildHybridEngine(engineCode)) extra.push(mildHybridBatteryPart(modelId));
  return base.concat(extra);
}

/* Dealer "normal" intervals from the Haji Husein Alireza (Mazda KSA) sheet —
   the shorter values already in the app are the Jeddah "severe" schedule.
   [normalKm, normalMonths] keyed by built-in service name. */
const NORMAL_SCHED = {
  'Engine Oil & Filter': [10000, 12],
  'Cabin (A/C) Filter': [20000, 12],
  'Engine Air Filter': [40000, 24],
  'Fuel Filter': [120000, 72]
};
/* Community gearbox (ATF) guidance — the dealer sheet omits transmission service.
   Source: Mazda CX-5 group + info guide. */
const ATF_NOTE = 'Community rec. (Mazda CX-5 group + info guide): renew ATF every 60–80k km per gearbox condition. Mazda Genuine ATF-FZ only (K020-W0-052E4), ~4.5–4.7 L per drain — buy 5×1 L. Replace the pan filter (FZ01-21-500) and reseal the pan with silicone (Dirko HT / Reinzosil / Mopar — better than dealer sealant), applied cleanly. Go easy on the gearbox for the first ~800 km. Check the fluid level to spec. No additives.';
function atfFilterPart(modelId) {
  return stampPartFitment({ id: dep.uid(), name: 'Transmission Fluid Filter', icon: '🧽', cat: 'Drivetrain', partsouq: 'FZ0121500', options: [
    { tag: 'OEM', brand: 'Mazda Genuine ATF pan filter', partNo: 'FZ01-21-500', price: 138, store: 'Mazda Dealer (Alireza)', note: 'Renew with every ATF change (community rec.)' }
  ] }, modelId);
}
function atfSealantPart(modelId) {
  return stampPartFitment({ id: dep.uid(), name: 'Transmission Pan Sealant', icon: '🧴', cat: 'Drivetrain', options: [
    { tag: 'ALT', brand: 'Elring Dirko HT (+315°C)', partNo: '', price: 55, store: 'Amazon.sa', note: 'Community pick — better than dealer sealant' },
    { tag: 'ALT', brand: 'Victor Reinz Reinzosil', partNo: '', price: 50, store: 'Amazon.sa' },
    { tag: 'ALT', brand: 'Mopar RTV Engine Sealant', partNo: '', price: 45, store: 'Local parts market' }
  ] }, modelId);
}
function fuelSystemCleanerPart(modelId) {
  return stampPartFitment({ id: dep.uid(), name: 'Fuel System Cleaner (additive)', icon: '🧪', cat: 'Engine', options: [
    { tag: 'OEM', brand: 'Dealer-applied treatment', partNo: '', price: 45, store: 'Mazda Dealer (Alireza)', note: 'Added at every oil change per dealer sheet' },
    { tag: 'ALT', brand: 'Chevron Techron Concentrate Plus', partNo: '', price: 55, store: 'Amazon.sa' },
    { tag: 'ALT', brand: 'Liqui Moly Fuel System Cleaner', partNo: '', price: 40, store: 'noon' }
  ] }, modelId);
}

  /* Stable key for one catalogue entry: model + engine. The server's
     car_models.id is the same string, so a garage car and its shared plan
     meet without a lookup table. */
  function catalogId(modelId, engineName) {
    return modelId + ':' + String(engineName || '').toLowerCase()
      .replace(/[^a-z0-9.]+/g, '-').replace(/^-|-$/g, '');
  }

  // Models a buyer in this country can pick. Unknown country = every model.
  function modelsForMarket(code) {
    return code ? CAR_MODELS.filter(m => m.markets.includes(code)) : CAR_MODELS.slice();
  }

  return {
    DEFAULT_COLOR, MAZDA_PAINTS, CAR_MODELS, modelsForMarket, NORMAL_SCHED, ATF_NOTE, catalogId,
    skyactivServices, sharedParts, partsForModel,
    ensurePartFitment, partFitsCar, isLegacyUnverifiedPart, modelUsesAtfFz,
    atfFilterPart, atfSealantPart, fuelSystemCleanerPart,
    tireShapeFor, tiresPart, OEM_TIRE_SIZE, TIRE_PSI,
    engineInfo, sparkPlugService, engineOilNote,
    engineOilPart, coolantPart, coolantLitersFor,
    sharedAcrossModels, batteryAhFor, battery12VPart, mildHybridEngine, mildHybridBatteryPart
  };
});
