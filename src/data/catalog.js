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
// { id, model, generation, engines: [[code, oilLitresWithFilter], …] }
const CAR_MODELS = [
  { id: 'mazda2', model: '2', gen: 'DJ · 2015+', engines: [['1.5L SkyActiv-G', 3.6]], colors: paints('Soul Red Crystal Metallic (Code 46V)', 'Snowflake White Pearl Mica (Code 25D)', 'Jet Black Mica (Code 41W)', 'Deep Crystal Blue Mica (Code 42M)', 'Dynamic Blue Mica (Code 44J)', 'Machine Gray Metallic (Code 46G)', 'Ceramic Metallic (Code 47A)', 'Platinum Quartz Metallic (Code 47S)') },
  { id: 'mazda3bm', model: '3', gen: 'BM/BN · 2014–18', engines: [['2.0L SkyActiv-G', 4.2], ['1.6L SkyActiv-G', 3.9]], colors: paints(DEFAULT_COLOR, 'Soul Red Metallic (Code 41V)', 'Snowflake White Pearl Mica (Code 25D)', 'Jet Black Mica (Code 41W)', 'Deep Crystal Blue Mica (Code 42M)', 'Blue Reflex Mica (Code 42B)', 'Liquid Silver Metallic (Code 38P)', 'Titanium Flash Mica (Code 42S)') },
  { id: 'mazda3bp', model: '3', gen: 'BP · 2019+', engines: [['2.0L SkyActiv-G', 4.2], ['1.5L SkyActiv-G', 3.6], ['2.5L SkyActiv-G', 4.5]], colors: paints('Machine Gray Metallic (Code 46G)', 'Soul Red Crystal Metallic (Code 46V)', 'Snowflake White Pearl Mica (Code 25D)', 'Jet Black Mica (Code 41W)', 'Deep Crystal Blue Mica (Code 42M)', 'Polymetal Gray Metallic (Code 47C)', 'Platinum Quartz Metallic (Code 47S)', 'Ceramic Metallic (Code 47A)') },
  { id: 'mazda6', model: '6', gen: 'GJ/GL · 2013+', engines: [['2.5L SkyActiv-G', 4.5], ['2.0L SkyActiv-G', 4.3]], colors: paints('Machine Gray Metallic (Code 46G)', 'Soul Red Metallic (Code 41V)', 'Soul Red Crystal Metallic (Code 46V)', 'Snowflake White Pearl Mica (Code 25D)', 'Jet Black Mica (Code 41W)', 'Deep Crystal Blue Mica (Code 42M)', 'Blue Reflex Mica (Code 42B)', 'Sonic Silver Metallic (Code 45P)', 'Titanium Flash Mica (Code 42S)') },
  { id: 'cx3', model: 'CX-3', gen: 'DK · 2015+', engines: [['2.0L SkyActiv-G', 4.2]], colors: paints('Machine Gray Metallic (Code 46G)', 'Soul Red Crystal Metallic (Code 46V)', 'Snowflake White Pearl Mica (Code 25D)', 'Jet Black Mica (Code 41W)', 'Deep Crystal Blue Mica (Code 42M)', 'Dynamic Blue Mica (Code 44J)', 'Ceramic Metallic (Code 47A)', 'Titanium Flash Mica (Code 42S)', 'Polymetal Gray Metallic (Code 47C)') },
  { id: 'cx30', model: 'CX-30', gen: 'DM · 2019+', engines: [['2.0L SkyActiv-G', 4.2], ['2.5L SkyActiv-G', 4.5]], colors: paints('Machine Gray Metallic (Code 46G)', 'Soul Red Crystal Metallic (Code 46V)', 'Snowflake White Pearl Mica (Code 25D)', 'Jet Black Mica (Code 41W)', 'Deep Crystal Blue Mica (Code 42M)', 'Polymetal Gray Metallic (Code 47C)', 'Platinum Quartz Metallic (Code 47S)', 'Ceramic Metallic (Code 47A)', 'Aero Gray Metallic (Code 52C)') },
  { id: 'cx5ke', model: 'CX-5', gen: 'KE · 2012–16', engines: [['2.0L SkyActiv-G', 4.2], ['2.5L SkyActiv-G', 4.8]], colors: paints(DEFAULT_COLOR, 'Soul Red Metallic (Code 41V)', 'Crystal White Pearl Mica (Code 34K)', 'Jet Black Mica (Code 41W)', 'Blue Reflex Mica (Code 42B)', 'Sky Blue Mica (Code 41B)', 'Stormy Blue Mica (Code 35J)', 'Liquid Silver Metallic (Code 38P)', 'Metropolitan Gray Mica (Code 36C)', 'Zeal Red Mica (Code 41G)') },
  { id: 'cx5kf', model: 'CX-5', gen: 'KF · 2017+', engines: [['2.5L SkyActiv-G', 4.8], ['2.0L SkyActiv-G', 4.2]], colors: paints('Machine Gray Metallic (Code 46G)', 'Soul Red Crystal Metallic (Code 46V)', 'Snowflake White Pearl Mica (Code 25D)', 'Rhodium White Premium (Code 51K)', 'Jet Black Mica (Code 41W)', 'Deep Crystal Blue Mica (Code 42M)', 'Eternal Blue Mica (Code 45B)', 'Sonic Silver Metallic (Code 45P)', 'Polymetal Gray Metallic (Code 47C)', 'Zircon Sand Metallic (Code 48T)') },
  { id: 'cx5gen3', model: 'CX-5', gen: '3rd gen · 2026+', engines: [['2.5L e-SkyActiv-G M Hybrid', 4.8]], colors: paints('Navy Blue Mica', 'Soul Red Crystal Metallic (Code 46V)', 'Rhodium White Premium (Code 51K)', 'Machine Gray Metallic (Code 46G)', 'Jet Black Mica (Code 41W)', 'Aero Gray Metallic (Code 52C)') },
  { id: 'cx9tb', model: 'CX-9', gen: 'TB · 2007–15', engines: [['3.5L MZI V6', 5.2], ['3.7L MZI V6', 5.2]], colors: paints('Dolphin Gray Mica (Code 39T)', 'Brilliant Black Clearcoat (Code A3F)', 'Crystal White Pearl Mica (Code 34K)', 'Copper Red Mica (Code 32V)', 'Liquid Silver Metallic (Code 38P)', 'Metropolitan Gray Mica (Code 36C)', 'Stormy Blue Mica (Code 35J)') },
  { id: 'cx9', model: 'CX-9', gen: 'TC · 2016+', engines: [['2.5L Turbo SkyActiv-G', 5.4]], colors: paints('Machine Gray Metallic (Code 46G)', 'Soul Red Crystal Metallic (Code 46V)', 'Snowflake White Pearl Mica (Code 25D)', 'Jet Black Mica (Code 41W)', 'Deep Crystal Blue Mica (Code 42M)', 'Sonic Silver Metallic (Code 45P)', 'Titanium Flash Mica (Code 42S)', 'Polymetal Gray Metallic (Code 47C)') },
  { id: 'cx50', model: 'CX-50', gen: '2022+', engines: [['2.5L SkyActiv-G', 4.8], ['2.5L Turbo SkyActiv-G', 5.4]], colors: paints('Machine Gray Metallic (Code 46G)', 'Soul Red Crystal Metallic (Code 46V)', 'Wind Chill Pearl (Code 48K)', 'Jet Black Mica (Code 41W)', 'Ingot Blue Metallic (Code 48B)', 'Polymetal Gray Metallic (Code 47C)', 'Zircon Sand Metallic (Code 48T)', 'Cypress (Code 52T)') },
  { id: 'cx60', model: 'CX-60', gen: '2022+', engines: [['2.5L e-SkyActiv-G PHEV', 4.8], ['3.3L e-SkyActiv-G', 5.1], ['3.3L e-SkyActiv-D', 5.1]], colors: paints('Machine Gray Metallic (Code 46G)', 'Soul Red Crystal Metallic (Code 46V)', 'Rhodium White Premium (Code 51K)', 'Jet Black Mica (Code 41W)', 'Deep Crystal Blue Mica (Code 42M)', 'Platinum Quartz Metallic (Code 47S)', 'Sonic Silver Metallic (Code 45P)', 'Artisan Red Premium (Code 51F)') },
  { id: 'cx70', model: 'CX-70', gen: '2024+', engines: [['3.3L Turbo e-SkyActiv-G', 5.1], ['2.5L e-SkyActiv-G PHEV', 4.8]], colors: paints('Melting Copper Metallic (Code 52H)', 'Soul Red Crystal Metallic (Code 46V)', 'Rhodium White Premium (Code 51K)', 'Jet Black Mica (Code 41W)', 'Polymetal Gray Metallic (Code 47C)', 'Zircon Sand Metallic (Code 48T)') },
  { id: 'cx80', model: 'CX-80', gen: '2024+', engines: [['3.3L e-SkyActiv-D', 5.1], ['2.5L e-SkyActiv-G PHEV', 4.8]], colors: paints('Artisan Red Premium (Code 51F)', 'Soul Red Crystal Metallic (Code 46V)', 'Rhodium White Premium (Code 51K)', 'Machine Gray Metallic (Code 46G)', 'Jet Black Mica (Code 41W)', 'Deep Crystal Blue Mica (Code 42M)', 'Platinum Quartz Metallic (Code 47S)', 'Melting Copper Metallic (Code 52H)') },
  { id: 'cx90', model: 'CX-90', gen: '2023+', engines: [['3.3L Turbo e-SkyActiv-G', 5.1], ['2.5L e-SkyActiv-G PHEV', 4.8]], colors: paints('Artisan Red Premium (Code 51F)', 'Soul Red Crystal Metallic (Code 46V)', 'Rhodium White Premium (Code 51K)', 'Machine Gray Metallic (Code 46G)', 'Jet Black Mica (Code 41W)', 'Deep Crystal Blue Mica (Code 42M)', 'Platinum Quartz Metallic (Code 47S)', 'Polymetal Gray Metallic (Code 47C)') }
];

/* Shared SkyActiv-G schedule (Jeddah "severe" base intervals; dealer "normal"
   values are layered on in normalizeData). Oil quantity varies per engine. */
function skyactivServices(oilL) {
  return [
      { id: dep.uid(), name: 'Engine Oil & Filter', icon: '🛢️', cat: 'Engine',
        intervalKm: 7500, intervalMonths: 6, lastKm: 0, lastDate: '', cost: 305,
        note: `5W-30 (API SP / ILSAC GF-6A) full synthetic — ~${oilL} L with filter. Every 7,500 km / 6 mo (severe) for Jeddah heat, dust & city driving. Add a fuel-system cleaner each oil change — mandatory for the direct-injection SkyActiv-G to keep injectors & intake valves clean.` },
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
      { id: dep.uid(), name: 'Spark Plugs (x4)', icon: '⚡', cat: 'Engine',
        intervalKm: 120000, intervalMonths: 72, lastKm: 257000, lastDate: '2022-06-01', cost: 340,
        note: 'Iridium NGK ILKAR7L11 — every 120,000 km / 6 yr (Except-Europe schedule). Restores smooth idle & economy.' },
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
}

const UNIVERSAL_PART_NAMES = new Set([
  'Brake Fluid (DOT 4)',
  'Coolant FL22 (long-life)',
  'Windshield Washer Fluid (~2L)'
]);
const ATF_FZ_MODEL_IDS = ['mazda2', 'mazda3bm', 'mazda3bp', 'mazda6', 'cx3', 'cx30', 'cx5ke', 'cx5kf', 'cx9', 'cx50'];
const LEGACY_GENERIC_SIGNATURES = {
  'Engine Oil 5W-30 (4L)': 'Shell Helix Ultra SP 5W-30',
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
  if (!part || modelId === 'mazda3bm' || part.fitment) return false;
  const signature = LEGACY_GENERIC_SIGNATURES[part.name];
  const brand = part.options && part.options[0] && part.options[0].brand;
  return !!signature && String(brand || '').startsWith(signature);
}

/* Full parts catalogue for the Mazda 3 (BM · 2.0). Other models start from the
   shared consumables and gain their own OEM numbers over time. */
function mazda3Parts() {
  return stampPartsFitment([
      { id: dep.uid(), name: 'Engine Oil 5W-30 (4L)', icon: '🛢️', cat: 'Engine',
        options: [
          { tag: 'OEM', brand: 'Shell Helix Ultra SP 5W-30 (dexos1 Gen3)', partNo: '', price: 160, store: 'Amazon.sa', note: 'API SP / ILSAC GF-6A full synthetic — 4.2 L with filter, 4.0 L without' },
          { tag: 'ALT', brand: 'TotalEnergies Quartz 9000 Future FGC 5W-30', partNo: '', price: 150, store: 'noon', note: 'Widely stocked in KSA' },
          { tag: 'ALT', brand: 'Fuchs Titan Supersyn D1 SAE 5W-30', partNo: '', price: 145, store: 'Local parts market' }
        ] },
      { id: dep.uid(), name: 'Oil Filter', icon: '🧽', cat: 'Engine', partsouq: 'PE0114302A',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (verified for your VIN)', partNo: 'PE01-14-302A', price: 45, store: 'Mazda Dealer (Alireza)' },
          { tag: 'ALT', brand: 'Mazda Genuine PE01-14-302A', partNo: 'PE0114302A', price: 22, store: 'PartSouq ↗', note: 'Genuine, ships to KSA' },
          { tag: 'ALT', brand: 'Denso 150-2010', partNo: '150-2010', price: 28, store: 'Amazon.sa' },
          { tag: 'ALT', brand: 'Bosch 3330', partNo: '3330', price: 25, store: 'Local parts market' }
        ] },
      { id: dep.uid(), name: 'Engine Air Filter', icon: '🌬️', cat: 'Engine', partsouq: 'PE07133A0A',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (verified for your VIN)', partNo: 'PE07-13-3A0A', price: 95, store: 'Mazda Dealer (Alireza)' },
          { tag: 'ALT', brand: 'Blue Print ADM52264', partNo: 'ADM52264', price: 25, store: 'PartSouq ↗', note: 'In stock · 4–5 days' },
          { tag: 'ALT', brand: 'WIX WA9774', partNo: 'WA9774', price: 25, store: 'PartSouq ↗' },
          { tag: 'ALT', brand: 'Denso Air Filter', partNo: '', price: 55, store: 'Amazon.sa' }
        ] },
      { id: dep.uid(), name: 'Cabin A/C Filter', icon: '❄️', cat: 'Interior', partsouq: 'KD4561J6X',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (verified for your VIN)', partNo: 'KD45-61-J6X', price: 80, store: 'Mazda Dealer (Alireza)' },
          { tag: 'ALT', brand: 'Filtron K1316', partNo: 'K1316', price: 29, store: 'PartSouq ↗' },
          { tag: 'ALT', brand: 'Denso Carbon Cabin', partNo: '', price: 45, store: 'Amazon.sa', note: 'Activated carbon, odor control' }
        ] },
      { id: dep.uid(), name: 'Spark Plugs (each)', icon: '⚡', cat: 'Engine', partsouq: 'PE5R18110',
        options: [
          { tag: 'OEM', brand: 'Mazda / NGK ILKAR7L11 (verified for your VIN)', partNo: 'PE5R-18-110', price: 70, store: 'Mazda Dealer (Alireza)' },
          { tag: 'ALT', brand: 'Mazda Genuine PE5R-18-110', partNo: 'PE5R18110', price: 84, store: 'PartSouq ↗', note: 'Genuine, ships to KSA' },
          { tag: 'ALT', brand: 'NGK Iridium ILKAR7L11', partNo: '94124', price: 55, store: 'Amazon.sa' },
          { tag: 'ALT', brand: 'Denso Iridium TT', partNo: '', price: 48, store: 'noon' }
        ] },
      { id: dep.uid(), name: 'Front Brake Pads', icon: '🛑', cat: 'Brakes', partsouq: 'B4Y03328ZB',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (verified for your VIN)', partNo: 'B4Y0-33-28ZB', price: 320, store: 'Mazda Dealer (Alireza)' },
          { tag: 'ALT', brand: 'Asimco KD3043', partNo: 'KD3043', price: 57, store: 'PartSouq ↗', note: 'In stock · 4–5 days' },
          { tag: 'ALT', brand: 'Akebono Ceramic', partNo: '', price: 210, store: 'Amazon.sa', note: 'Low dust, quiet' },
          { tag: 'ALT', brand: 'Bosch QuietCast', partNo: '', price: 180, store: 'Local parts market' }
        ] },
      { id: dep.uid(), name: 'Rear Brake Pads', icon: '🛑', cat: 'Brakes', partsouq: 'B4Y02648ZB',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (verified for your VIN)', partNo: 'B4Y0-26-48ZB', price: 260, store: 'Mazda Dealer (Alireza)' },
          { tag: 'ALT', brand: 'Akebono Ceramic', partNo: '', price: 170, store: 'Amazon.sa' }
        ] },
      { id: dep.uid(), name: 'Wiper Blades (pair)', icon: '🌧️', cat: 'Exterior',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine', partNo: '', price: 150, store: 'Mazda Dealer (Alireza)' },
          { tag: 'ALT', brand: 'Bosch Aerotwin', partNo: '', price: 95, store: 'Amazon.sa' },
          { tag: 'ALT', brand: 'Valeo First', partNo: '', price: 70, store: 'noon' }
        ] },
      { id: dep.uid(), name: '12V Battery', icon: '🔋', cat: 'Electrical',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine 55Ah', partNo: '', price: 480, store: 'Mazda Dealer (Alireza)' },
          { tag: 'ALT', brand: 'Varta Blue Dynamic', partNo: '', price: 360, store: 'AC Delco / battery shop', note: 'Strong in heat' },
          { tag: 'ALT', brand: 'AC Delco', partNo: '', price: 320, store: 'Local battery shop' }
        ] },
      { id: dep.uid(), name: 'Serpentine Belt', icon: '🔗', cat: 'Engine', partsouq: 'PE0815909B',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (verified for your VIN)', partNo: 'PE08-15-909B', price: 150, store: 'Mazda Dealer (Alireza)' },
          { tag: 'ALT', brand: 'Gates Micro-V', partNo: '', price: 90, store: 'Amazon.sa' },
          { tag: 'ALT', brand: 'Dayco', partNo: '', price: 80, store: 'Local parts market' }
        ] },
      { id: dep.uid(), name: 'Coolant FL22 (long-life)', icon: '🌡️', cat: 'Engine',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine FL22 Long Life', partNo: '0000-77-508E-20', price: 130, store: 'Mazda Dealer (Alireza)', note: 'System holds ~6.6 L' },
          { tag: 'ALT', brand: 'Total Glacelf Auto Supra', partNo: '', price: 85, store: 'Local parts market', note: 'KSA-available compatible coolant (per 5-yr plan)' },
          { tag: 'ALT', brand: 'Zerex Asian Blue (P-HOAT)', partNo: '', price: 85, store: 'Amazon.sa', note: 'Compatible chemistry' }
        ] },
      { id: dep.uid(), name: 'ATF FZ (per liter)', icon: '⚙️', cat: 'Drivetrain',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine ATF-FZ (only)', partNo: '0000-77-112E-01', price: 60, store: 'Mazda Dealer (Alireza)', note: '~3.5 L per drain, 7.8 L total' },
          { tag: 'ALT', brand: 'Idemitsu Type FZ', partNo: '', price: 42, store: 'Amazon.sa', note: 'OE supplier equivalent' }
        ] },
      { id: dep.uid(), name: 'Brake Fluid (DOT 4)', icon: '🩸', cat: 'Brakes',
        options: [
          { tag: 'OEM', brand: 'Motul DOT 3 & 4', partNo: '', price: 35, store: 'Amazon.sa', note: 'Need ~1 L for a full flush' },
          { tag: 'ALT', brand: 'ACDelco DOT 4', partNo: '', price: 28, store: 'Local parts market' }
        ] },
      { id: dep.uid(), name: 'Windshield Washer Fluid (~2L)', icon: '💦', cat: 'Exterior',
        options: [
          { tag: 'ALT', brand: 'Ready-mix washer fluid (anti-streak)', partNo: '', price: 15, store: 'noon', note: 'Top up as needed' }
        ] },
      /* ---- Suspension wear parts (verified for your VIN) ---- */
      { id: dep.uid(), name: 'Front Shock Absorber (each)', icon: '🌀', cat: 'Suspension', partsouq: 'BHS234700A',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine — R: BHS2-34-700A · L: BHS2-34-900A', partNo: 'BHS2-34-700A', price: 286, store: 'Mazda Dealer (Alireza)', note: 'Bouncy ride / clunks = replace in pairs' },
          { tag: 'ALT', brand: 'KYB 3340035', partNo: '3340035', price: 323, store: 'PartSouq ↗', note: 'OEM-grade · in stock' },
          { tag: 'ALT', brand: 'Orient ORMZ3340035', partNo: 'ORMZ3340035', price: 103, store: 'PartSouq ↗', note: 'Budget · in stock' }
        ] },
      { id: dep.uid(), name: 'Rear Shock Absorber (each)', icon: '🌀', cat: 'Suspension', partsouq: 'B45A28910B',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (verified for your VIN)', partNo: 'B45A-28-910B', price: 313, store: 'Mazda Dealer (Alireza)', note: 'Replace in pairs' },
          { tag: 'ALT', brand: 'Aftermarket (Orient) ORMZ3430041', partNo: 'ORMZ3430041', price: 46, store: 'PartSouq ↗', note: 'Budget · in stock' }
        ] },
      { id: dep.uid(), name: 'Front Lower Control Arm (each)', icon: '🦴', cat: 'Suspension', partsouq: 'B60S34300',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine — R: B60S-34-300 · L: B60S-34-350', partNo: 'B60S-34-300', price: 417, store: 'Mazda Dealer (Alireza)', note: 'Incl. ball joint & bushing' },
          { tag: 'ALT', brand: 'Schnieder MZS2201914', partNo: 'MZS2201914', price: 173, store: 'PartSouq ↗', note: 'Complete arm · in stock' },
          { tag: 'ALT', brand: 'Febest Ball Joint 0520KE', partNo: '0520KE', price: 41, store: 'PartSouq ↗', note: 'Ball joint only' }
        ] },
      { id: dep.uid(), name: 'Front Strut Mount Bearing (each)', icon: '⭕', cat: 'Suspension', partsouq: 'KR273438X',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (verified for your VIN)', partNo: 'KR27-34-38X', price: 60, store: 'Mazda Dealer (Alireza)', note: 'Creak/knock when turning = replace with struts' }
        ] },
      { id: dep.uid(), name: 'Rear Wheel Hub Bearing (each)', icon: '⭕', cat: 'Suspension', partsouq: 'B45A2615X',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine — hub + bearing', partNo: 'B45A-26-15X', price: 340, store: 'Mazda Dealer (Alireza)', note: 'Humming/whine from rear = replace' }
        ] },
      { id: dep.uid(), name: 'Stabilizer (Sway Bar) Link', icon: '🔗', cat: 'Suspension', partsouq: 'KD3128170',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine — R: KD31-28-170 · L: KD31-28-190', partNo: 'KD31-28-170', price: 90, store: 'Mazda Dealer (Alireza)', note: 'Rattle/clunk over bumps = worn links' }
        ] },
      /* ---- Electrical wear parts (verified for your VIN) ---- */
      { id: dep.uid(), name: 'Ignition Coil (each)', icon: '⚡', cat: 'Electrical', partsouq: 'PE2018100A',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (verified for your VIN)', partNo: 'PE20-18-100A', price: 545, store: 'Mazda Dealer (Alireza)', note: 'Misfire / rough idle / flashing CEL = replace' },
          { tag: 'ALT', brand: 'Febest 05640002', partNo: '05640002', price: 158, store: 'PartSouq ↗', note: 'In stock' }
        ] },
      { id: dep.uid(), name: 'Alternator', icon: '🔌', cat: 'Electrical', partsouq: 'PE0118300',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (verified for your VIN)', partNo: 'PE01-18-300', price: 1026, store: 'Mazda Dealer (Alireza)', note: 'Battery/charge warning light = check' },
          { tag: 'ALT', brand: 'Schnieder MZS1100125', partNo: 'MZS1100125', price: 362, store: 'PartSouq ↗' }
        ] },
      { id: dep.uid(), name: 'Starter Motor', icon: '🔌', cat: 'Electrical', partsouq: 'PE0718400',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (verified for your VIN)', partNo: 'PE07-18-400', price: 527, store: 'Mazda Dealer (Alireza)', note: 'Slow / clicking crank = replace' }
        ] },
      /* ---- Brakes: discs / rotors (verified for your VIN) ---- */
      { id: dep.uid(), name: 'Front Brake Disc (each)', icon: '💿', cat: 'Brakes', partsouq: 'B45G33251A',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (verified for your VIN)', partNo: 'B45G-33-251A', price: 271, store: 'Mazda Dealer (Alireza)', note: 'Vibration under braking / lip on edge = replace in pairs' },
          { tag: 'ALT', brand: 'Hi-Q SD4440', partNo: 'SD4440', price: 133, store: 'PartSouq ↗', note: 'In stock' }
        ] },
      { id: dep.uid(), name: 'Rear Brake Disc (each)', icon: '💿', cat: 'Brakes', partsouq: 'B45G26251A',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (verified for your VIN)', partNo: 'B45G-26-251A', price: 163, store: 'Mazda Dealer (Alireza)', note: 'Replace in pairs with pads' }
        ] },
      /* ---- Cooling / engine wear (verified for your VIN) ---- */
      { id: dep.uid(), name: 'Water Pump', icon: '💧', cat: 'Engine', partsouq: 'PE0115010B',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (verified for your VIN)', partNo: 'PE01-15-010B', price: 257, store: 'Mazda Dealer (Alireza)', note: 'Coolant leak / whine / overheating = replace' },
          { tag: 'ALT', brand: 'GMB GWMZ79AH', partNo: 'GWMZ79AH', price: 198, store: 'PartSouq ↗', note: 'OE supplier · in stock' },
          { tag: 'ALT', brand: 'GMB (OE) PE01-15-010B', partNo: 'PE0115010B', price: 128, store: 'PartSouq ↗', note: 'OE supplier' }
        ] },
      { id: dep.uid(), name: 'Thermostat', icon: '🌡️', cat: 'Engine', partsouq: 'PE0115171',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (2.0 SkyActiv-G)', partNo: 'PE01-15-171', price: 55, store: 'Mazda Dealer (Alireza)', note: 'Overheating or slow warm-up = replace' }
        ] },
      { id: dep.uid(), name: 'A/F (Oxygen) Sensor — upstream', icon: '📡', cat: 'Engine', partsouq: 'PE01188G1A',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (verified for your VIN)', partNo: 'PE01-18-8G1A', price: 529, store: 'Mazda Dealer (Alireza)', note: 'CEL / rough idle / high fuel use = replace' }
        ] },
      /* ---- Drivetrain: CV axle joint (verified for your VIN) ---- */
      { id: dep.uid(), name: 'Front CV Axle Joint (outer)', icon: '🦴', cat: 'Drivetrain', partsouq: 'FTC322510',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine — R outer FTC3-22-510', partNo: 'FTC3-22-510', price: 1001, store: 'Mazda Dealer (Alireza)', note: 'Clicking when turning = worn outer CV joint' },
          { tag: 'ALT', brand: 'Aftermarket complete axle', partNo: '', price: 260, store: 'Local parts market', note: 'Full axle often cheaper than OEM joint' }
        ] },
      /* ---- Known failure-prone parts on the BM Mazda 3 (researched) ---- */
      { id: dep.uid(), name: 'MAF (Mass Air Flow) Sensor', icon: '📡', cat: 'Engine', partsouq: 'PE0113215',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (verified for your VIN)', partNo: 'PE01-13-215', price: 534, store: 'Mazda Dealer (Alireza)', note: 'Common failure: hesitation / stalling / CEL — clean first, then replace' }
        ] },
      { id: dep.uid(), name: 'A/C Condenser', icon: '❄️', cat: 'A/C', partsouq: 'GHR161480B',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (verified for your VIN)', partNo: 'GHR1-61-480B', price: 794, store: 'Mazda Dealer (Alireza)', note: 'Known leak — Mazda extended the warranty on 2016–17. Weak A/C = check' },
          { tag: 'ALT', brand: 'Aftermarket condenser', partNo: '', price: 300, store: 'Local parts market', note: 'Widely available' }
        ] },
      { id: dep.uid(), name: 'Front Coil Spring (each)', icon: '🌀', cat: 'Suspension', partsouq: 'B45M34011A',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine — front B45M-34-011A', partNo: 'B45M-34-011A', price: 192, store: 'Mazda Dealer (Alireza)', note: 'Coil springs crack/break on Mazda 3 (esp. rear) — sag or clunk = replace in pairs' }
        ] },
      { id: dep.uid(), name: 'Front Wheel Hub Bearing (each)', icon: '⭕', cat: 'Suspension', partsouq: 'B45A3304X',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (verified for your VIN)', partNo: 'B45A-33-04X', price: 583, store: 'Mazda Dealer (Alireza)', note: 'Humming/growling that rises with speed = replace' }
        ] },
      /* ---- More common replaceables (verified for your VIN) ---- */
      { id: dep.uid(), name: 'Radiator', icon: '🧊', cat: 'Engine', partsouq: 'PE2015200',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (verified for your VIN)', partNo: 'PE20-15-200', price: 989, store: 'Mazda Dealer (Alireza)', note: 'Leak / overheating / coolant residue = replace' },
          { tag: 'ALT', brand: 'Aftermarket radiator', partNo: '', price: 280, store: 'Local parts market', note: 'Widely available' }
        ] },
      { id: dep.uid(), name: 'Engine Mount (No.4, right)', icon: '🧱', cat: 'Engine', partsouq: 'GHR939070B',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (verified for your VIN)', partNo: 'GHR9-39-070B', price: 217, store: 'Mazda Dealer (Alireza)', note: 'Vibration/clunk on start, idle or acceleration = worn mount' },
          { tag: 'ALT', brand: 'Febest MZMGJLH', partNo: 'MZMGJLH', price: 230, store: 'PartSouq ↗' }
        ] },
      { id: dep.uid(), name: 'Front Brake Caliper (each)', icon: '🗜️', cat: 'Brakes', partsouq: 'B4Y73398ZB',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine — R: B4Y7-33-98ZB · L: B4Y7-33-99ZB', partNo: 'B4Y7-33-98ZB', price: 491, store: 'Mazda Dealer (Alireza)', note: 'Sticking/leaking = pulling or uneven pad wear' },
          { tag: 'ALT', brand: 'Febest rebuild kit 0575BMF', partNo: '0575BMF', price: 30, store: 'PartSouq ↗', note: 'Seals only — cheaper than full caliper' }
        ] },
      { id: dep.uid(), name: 'Blower Motor (A/C fan)', icon: '💨', cat: 'A/C', partsouq: 'KD4561B10',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (verified for your VIN)', partNo: 'KD45-61-B10', price: 700, store: 'Mazda Dealer (Alireza)', note: 'No / weak / noisy airflow from vents = replace' }
        ] },
      { id: dep.uid(), name: 'Headlight Unit (each)', icon: '💡', cat: 'Exterior', partsouq: 'BHW3510K0A',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine — R: BHW3-51-0K0A · L: BHW3-51-0L0A', partNo: 'BHW3-51-0K0A', price: 902, store: 'Mazda Dealer (Alireza)', note: 'Cracked/fogged lens or dead unit' },
          { tag: 'ALT', brand: 'Aftermarket headlight unit', partNo: '', price: 450, store: 'Local parts market' }
        ] },
      /* ---- Added parts (2016 BM · 2.0 SkyActiv-G — OEM numbers via genuine catalogs; verify on PartSouq) ---- */
      { id: dep.uid(), name: 'A/C Compressor', icon: '❄️', cat: 'A/C', partsouq: 'BHS261450',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine', partNo: 'BHS2-61-450', price: 1450, store: 'Mazda Dealer (Alireza)', note: 'Weak/no cold air or noisy clutch = replace' },
          { tag: 'ALT', brand: 'Aftermarket / reman compressor', partNo: '', price: 620, store: 'Local parts market' }
        ] },
      { id: dep.uid(), name: 'Rear Coil Spring (each)', icon: '🌀', cat: 'Suspension', partsouq: 'BHN528011A',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine', partNo: 'BHN5-28-011A', price: 185, store: 'Mazda Dealer (Alireza)', note: 'Rear springs crack/sag on the BM Mazda 3 — replace in pairs' }
        ] },
      { id: dep.uid(), name: 'Valve Cover Gasket', icon: '🛢️', cat: 'Engine', partsouq: 'PE0110235',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (2.0 SkyActiv-G)', partNo: 'PE01-10-235', price: 90, store: 'Mazda Dealer (Alireza)', note: 'Oil seep around the valve cover = replace' },
          { tag: 'ALT', brand: 'Aftermarket gasket', partNo: '', price: 45, store: 'Amazon.sa' }
        ] },
      /* ---- Wear & failure-prone + consumables (2016 BM · 2.0 SkyActiv-G — verify numbers on PartSouq) ---- */
      { id: dep.uid(), name: 'PCV Valve', icon: '🫧', cat: 'Engine', partsouq: 'PE0113890',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (SkyActiv-G)', partNo: 'PE01-13-890', price: 70, store: 'Mazda Dealer (Alireza)', note: 'Rough idle / oil consumption = replace' },
          { tag: 'ALT', brand: 'Aftermarket PCV valve', partNo: '', price: 35, store: 'Amazon.sa' }
        ] },
      { id: dep.uid(), name: 'Crankshaft Position Sensor', icon: '📡', cat: 'Electrical', partsouq: 'PE0118221',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine', partNo: 'PE01-18-221', price: 150, store: 'Mazda Dealer (Alireza)', note: 'No-start / stalling / CEL = replace' },
          { tag: 'ALT', brand: 'Denso / aftermarket', partNo: '', price: 80, store: 'Amazon.sa' }
        ] },
      { id: dep.uid(), name: 'Camshaft Position Sensor', icon: '📡', cat: 'Electrical', partsouq: 'PE0118230',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine', partNo: 'PE01-18-230', price: 150, store: 'Mazda Dealer (Alireza)', note: 'Rough running / CEL = replace' },
          { tag: 'ALT', brand: 'Denso / aftermarket', partNo: '', price: 80, store: 'Amazon.sa' }
        ] },
      { id: dep.uid(), name: 'Oxygen Sensor — downstream (rear)', icon: '📡', cat: 'Engine', partsouq: 'PEDE1886Z',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine', partNo: 'PEDE-18-86Z', price: 360, store: 'Mazda Dealer (Alireza)', note: 'After the catalytic converter — emissions CEL = replace' },
          { tag: 'ALT', brand: 'Denso / NTK O2 sensor', partNo: '', price: 170, store: 'Amazon.sa' }
        ] },
      { id: dep.uid(), name: 'Fuel Pump Assembly (in-tank)', icon: '⛽', cat: 'Engine', partsouq: 'PE181335X',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (incl. sender)', partNo: 'PE18-13-35X', price: 620, store: 'Mazda Dealer (Alireza)', note: 'Cranks-no-start / weak pressure = replace' },
          { tag: 'ALT', brand: 'Aftermarket pump module', partNo: '', price: 280, store: 'Local parts market' }
        ] },
      { id: dep.uid(), name: 'Drive Belt Tensioner', icon: '🔗', cat: 'Engine', partsouq: 'PE0315980A',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine', partNo: 'PE03-15-980A', price: 180, store: 'Mazda Dealer (Alireza)', note: 'Belt squeal/rattle = worn tensioner; replace with the belt' },
          { tag: 'ALT', brand: 'Gates / Dayco tensioner', partNo: '', price: 110, store: 'Amazon.sa' }
        ] },
      { id: dep.uid(), name: 'Front Engine Mount', icon: '🧱', cat: 'Engine', partsouq: 'BCKA39060A',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine', partNo: 'BCKA-39-060A', price: 240, store: 'Mazda Dealer (Alireza)', note: 'Vibration/clunk on start & accel = worn mount. Verify no. by transmission/build.' },
          { tag: 'ALT', brand: 'Aftermarket mount', partNo: '', price: 120, store: 'Local parts market' }
        ] },
      { id: dep.uid(), name: 'Transmission Mount', icon: '🧱', cat: 'Drivetrain', partsouq: 'BBR339070A',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine', partNo: 'BBR3-39-070A', price: 300, store: 'Mazda Dealer (Alireza)', note: 'Clunk on gear engagement = worn mount. Verify no. by transmission/build.' },
          { tag: 'ALT', brand: 'Aftermarket mount', partNo: '', price: 150, store: 'Local parts market' }
        ] },
      { id: dep.uid(), name: 'Brake Master Cylinder', icon: '🛑', cat: 'Brakes', partsouq: 'BHY24340Z',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine', partNo: 'BHY2-43-40Z', price: 520, store: 'Mazda Dealer (Alireza)', note: 'Sinking pedal / internal leak = replace' },
          { tag: 'ALT', brand: 'Centric / aftermarket', partNo: '', price: 260, store: 'Amazon.sa' }
        ] },
      { id: dep.uid(), name: 'Rear Brake Caliper (each)', icon: '🗜️', cat: 'Brakes', partsouq: 'B4Y72698ZC',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine — R: B4Y7-26-98ZC · L: BJY7-26-99Z', partNo: 'B4Y7-26-98ZC', price: 430, store: 'Mazda Dealer (Alireza)', note: 'Sticking/leaking = drag, pulling or uneven pad wear' },
          { tag: 'ALT', brand: 'Caliper rebuild kit (seals)', partNo: '', price: 35, store: 'PartSouq ↗', note: 'Cheaper than a full caliper' }
        ] },
      { id: dep.uid(), name: 'Outer Tie Rod End (each)', icon: '🔩', cat: 'Suspension', partsouq: 'GHT232290A',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine', partNo: 'GHT2-32-290A', price: 120, store: 'Mazda Dealer (Alireza)', note: 'Play/clunk in steering or uneven tire wear = replace' },
          { tag: 'ALT', brand: '555 / CTR tie rod end', partNo: '', price: 45, store: 'Local parts market' }
        ] },
      { id: dep.uid(), name: 'Headlight Bulbs (H11 low · 9005 high)', icon: '💡', cat: 'Exterior',
        options: [
          { tag: 'OEM', brand: 'Philips / Osram halogen (H11 + 9005/HB3)', partNo: 'H11 · 9005', price: 60, store: 'Amazon.sa', note: 'Consumable — dim/burnt-out beam. Halogen trims; verify your housing.' },
          { tag: 'ALT', brand: 'LED conversion kit (H11 + 9005)', partNo: '', price: 120, store: 'noon' }
        ] },
      /* ---- High-mileage wear & service consumables (2016 BM · verify numbers on PartSouq) ---- */
      { id: dep.uid(), name: 'Timing Chain Kit', icon: '⛓️', cat: 'Engine', partsouq: 'PE0112500A',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine — chain PE01-12-201 · tensioner PE01-12-500A', partNo: 'PE01-12-500A', price: 850, store: 'Mazda Dealer (Alireza)', note: 'Rattle on cold start / stretched chain at high km = replace kit' },
          { tag: 'ALT', brand: 'Aftermarket chain kit (chain, tensioner, guides)', partNo: '', price: 350, store: 'Local parts market' }
        ] },
      { id: dep.uid(), name: 'Radiator Hoses (upper & lower)', icon: '💧', cat: 'Engine',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine upper + lower hose', partNo: '', price: 200, store: 'Mazda Dealer (Alireza)', note: 'Rubber hardens/cracks in Jeddah heat — verify exact numbers for 2.0 on PartSouq' },
          { tag: 'ALT', brand: 'Gates / aftermarket hose', partNo: '', price: 90, store: 'Local parts market' }
        ] },
      { id: dep.uid(), name: 'Oil Drain Plug Gasket (14mm crush washer)', icon: '⭕', cat: 'Engine', partsouq: '995641400',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine crush washer', partNo: '9956-41-400', price: 5, store: 'Mazda Dealer (Alireza)', note: 'Consumable — renew at every oil change to avoid seepage' }
        ] },
      { id: dep.uid(), name: 'Front Sway Bar Bushing', icon: '🔘', cat: 'Suspension', partsouq: 'B60P34156',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine', partNo: 'B60P-34-156', price: 30, store: 'Mazda Dealer (Alireza)', note: 'Clunk/rattle over bumps = worn bushing; replace in pairs' },
          { tag: 'ALT', brand: 'Moog / polyurethane bushing', partNo: '', price: 20, store: 'Amazon.sa' }
        ] },
      { id: dep.uid(), name: 'Blower Motor Resistor', icon: '🎛️', cat: 'A/C', partsouq: 'KD4561B15',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine', partNo: 'KD45-61-B15', price: 180, store: 'Mazda Dealer (Alireza)', note: 'Fan works only on some speeds = failed resistor' },
          { tag: 'ALT', brand: 'Aftermarket resistor', partNo: '', price: 70, store: 'Amazon.sa' }
        ] },
      { id: dep.uid(), name: 'Tail / Brake Light Bulbs', icon: '💡', cat: 'Exterior',
        options: [
          { tag: 'OEM', brand: 'Philips / Osram (brake, tail, reverse, signal)', partNo: '', price: 25, store: 'Amazon.sa', note: 'Consumable — replace burnt-out bulbs; halogen trims' }
        ] },
      /* ---- More common-failure parts (2016 BM · verify numbers on PartSouq) ---- */
      { id: dep.uid(), name: 'EVAP Purge Valve (canister solenoid)', icon: '🫧', cat: 'Engine', partsouq: 'PE0118751',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine', partNo: 'PE01-18-751', price: 130, store: 'Mazda Dealer (Alireza)', note: 'EVAP CEL (P0441/P0455) or rough idle = replace' },
          { tag: 'ALT', brand: 'Aftermarket purge solenoid', partNo: '', price: 60, store: 'Amazon.sa' }
        ] },
      { id: dep.uid(), name: 'Knock Sensor', icon: '📡', cat: 'Engine', partsouq: 'PE0118921',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine', partNo: 'PE01-18-921', price: 160, store: 'Mazda Dealer (Alireza)', note: 'CEL / reduced power / pinging = check' }
        ] },
      { id: dep.uid(), name: 'Front CV Axle (complete, each)', icon: '🦴', cat: 'Drivetrain', partsouq: 'FT0C2550X',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine — R: FT0C-25-50X', partNo: 'FT0C-25-50X', price: 780, store: 'Mazda Dealer (Alireza)', note: 'Clicking on turns / torn CV boot = worn axle' },
          { tag: 'ALT', brand: 'Aftermarket complete axle', partNo: '', price: 260, store: 'Local parts market' }
        ] },
      { id: dep.uid(), name: 'Front ABS Wheel Speed Sensor', icon: '📡', cat: 'Electrical', partsouq: 'BJS74370XA',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine', partNo: 'BJS7-43-70XA', price: 220, store: 'Mazda Dealer (Alireza)', note: 'ABS / traction / brake warning light on = replace' },
          { tag: 'ALT', brand: 'Aftermarket sensor', partNo: '', price: 90, store: 'Amazon.sa' }
        ] },
      { id: dep.uid(), name: 'Engine Coolant Temp Sensor (ECT)', icon: '🌡️', cat: 'Engine', partsouq: 'SH0118840',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine', partNo: 'SH01-18-840', price: 110, store: 'Mazda Dealer (Alireza)', note: 'CEL / wrong temp reading / fan or fuel-trim issues = replace' },
          { tag: 'ALT', brand: 'Aftermarket sensor', partNo: '', price: 45, store: 'Amazon.sa' }
        ] },
      { id: dep.uid(), name: 'Intake Manifold Gasket', icon: '🛢️', cat: 'Engine', partsouq: 'PE0113111',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (per port)', partNo: 'PE01-13-111', price: 25, store: 'Mazda Dealer (Alireza)', note: 'Vacuum leak / rough idle — renew when servicing the intake' },
          { tag: 'ALT', brand: 'Aftermarket gasket set', partNo: '', price: 15, store: 'Amazon.sa' }
        ] }
  ], 'mazda3bm');
}

/* Generic SkyActiv-G consumables — every model starts with these until its own
   OEM numbers are filled in. Numbers vary by model, so verify before buying. */
function sharedParts(modelId) {
  const P = (name, icon, cat, options) => ({ id: dep.uid(), name, icon, cat, options });
  const D = 'Mazda Dealer (Alireza)', A = 'Amazon.sa';
  return stampPartsFitment([
    P('Engine Oil 5W-30 (4L)', '🛢️', 'Engine', [
      { tag: 'OEM', brand: 'Shell Helix Ultra SP 5W-30 (dexos1 Gen3)', partNo: '', price: 160, store: A, note: 'API SP / ILSAC GF-6A full synthetic' },
      { tag: 'ALT', brand: 'TotalEnergies Quartz 9000 5W-30', partNo: '', price: 150, store: 'noon' }]),
    P('Oil Filter', '🧽', 'Engine', [
      { tag: 'OEM', brand: 'Mazda Genuine (SkyActiv-G — commonly shared)', partNo: 'PE01-14-302A', price: 45, store: D, note: 'One filter fits most SkyActiv-G engines — verify' },
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
    P('Coolant FL22 (long-life)', '🌡️', 'Engine', [
      { tag: 'OEM', brand: 'Mazda Genuine FL22 Long Life', partNo: '0000-77-508E-20', price: 130, store: D }]),
    P('ATF FZ (per liter)', '⚙️', 'Drivetrain', [
      { tag: 'OEM', brand: 'Mazda Genuine ATF-FZ (only)', partNo: 'K020-W0-052E4', price: 60, store: D, note: '~4.5–4.7 L per drain' }]),
    P('Serpentine Belt', '🔗', 'Engine', [
      { tag: 'OEM', brand: 'Mazda Genuine (verify for your model)', partNo: '', price: 150, store: D },
      { tag: 'ALT', brand: 'Gates Micro-V', partNo: '', price: 90, store: A }]),
    P('12V Battery', '🔋', 'Electrical', [
      { tag: 'OEM', brand: 'Mazda Genuine', partNo: '', price: 480, store: D },
      { tag: 'ALT', brand: 'Varta Blue Dynamic', partNo: '', price: 360, store: 'Battery shop', note: 'Strong in heat' }]),
    P('Wiper Blades (pair)', '🌧️', 'Exterior', [
      { tag: 'ALT', brand: 'Bosch Aerotwin', partNo: '', price: 95, store: A }]),
    P('Windshield Washer Fluid (~2L)', '💦', 'Exterior', [
      { tag: 'ALT', brand: 'Ready-mix washer fluid', partNo: '', price: 15, store: 'noon' }])
  ], modelId).filter(p => p.fitment.shareable || p.name === 'ATF FZ (per liter)');
}

function partsForModel(modelId) {
  return modelId === 'mazda3bm' ? mazda3Parts() : sharedParts(modelId);
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

/* Every hatch/sedan uses passenger-car touring tires the same way a Mazda2
   does; only the CX-line's height and load actually change what the tire
   community recommends. Mirrors the shape split dashboard.js already uses
   for the studio card, so "which bucket is this car in" has one answer. */
function tireShapeFor(modelId) { return /^cx/.test(modelId || '') ? 'suv' : 'sedan'; }

/* Community-sourced guidance for KSA conditions specifically: summer
   asphalt routinely exceeds 60°C, which ages rubber and degrades wet grip
   faster than the tire's tread-wear rating alone suggests, and most driving
   here is long, hot highway stretches rather than off-road — so a touring
   or highway-terrain tread beats an aggressive all-terrain one for daily use
   even on an SUV. Prices are rough per-tire street estimates, not a fitted
   quote — always confirm the exact size for the trim (see the door-jamb
   sticker) before ordering. */
const TIRE_GUIDE = {
  sedan: {
    label: 'Sedans & hatchbacks (2 · 3 · 6)',
    whenToReplace: [
      'Tread at or below 3-4mm (not the legal 1.6mm minimum) — KSA heat and highway speeds punish worn tread faster than cooler climates.',
      '5-6 years from the manufacture date on the sidewall (4-digit DOT code, e.g. 2321 = week 23 of 2021) regardless of tread — rubber dries out and cracks from heat even with low mileage.',
      'Visible sidewall cracking, bulges, or a puncture in the shoulder/sidewall — do not patch these, replace the tire.',
      'Uneven wear across the tread (inner/outer edge, cupping) — get an alignment check at the same time or the new tires wear the same way.'
    ],
    picks: [
      { brand: 'Michelin', line: 'Primacy 4 ST', why: 'Touring all-season, strong wet grip and long tread life — the community\'s default recommendation for daily highway driving.' },
      { brand: 'Bridgestone', line: 'Turanza T005 / EL400', why: 'Comfort-oriented touring tire, well-stocked locally, good balance of quiet ride and summer-heat durability.' },
      { brand: 'Yokohama', line: 'BluEarth-XT AE61', why: 'Popular value pick among Mazda 3/6 owners locally — solid heat resistance for the price.' },
      { brand: 'Continental', line: 'UltraContact UC6', why: 'Good option if the priority is fuel economy and low road noise on long Riyadh-Jeddah style highway runs.' }
    ]
  },
  suv: {
    label: 'CX-line crossovers & SUVs',
    whenToReplace: [
      'Tread at or below 4mm — SUVs carry more weight, so a worn tire loses stability (especially in braking and crosswind) sooner than on a sedan.',
      '5-6 years from the DOT date code, same as sedans — an SUV\'s extra weight is harder on aged, hardened rubber, not easier.',
      'Any sidewall damage — an SUV\'s taller sidewall flexes more and hides a bulge or bubble until it fails, so check it by hand, not just by eye.',
      'Uneven front/rear wear if the vehicle is AWD — replace in a full set (or the two least-worn tires as a matched axle pair) so the AWD system is not fighting different rolling diameters.'
    ],
    picks: [
      { brand: 'Michelin', line: 'Primacy SUV+ / Latitude Tour HP', why: 'The touring choice most recommended for CX-5/CX-9 daily driving — quiet, long-wearing, handles the extra weight well.' },
      { brand: 'Bridgestone', line: 'Dueler H/L 400 / Alenza', why: 'Highway-terrain tread built for crossover weight, common OEM-equivalent choice for the CX-line locally.' },
      { brand: 'Yokohama', line: 'Geolandar CV G058', why: 'Comfort-focused highway tread, a frequent pick in the local CX-5/CX-60 community for its ride quality.' },
      { brand: 'General', line: 'Grabber HTS60', why: 'Budget-friendly highway-terrain option if occasional light gravel/desert-camp tracks are part of the use case — not for serious off-road.' }
    ]
  }
};

  return {
    DEFAULT_COLOR, MAZDA_PAINTS, CAR_MODELS, NORMAL_SCHED, ATF_NOTE,
    skyactivServices, mazda3Parts, sharedParts, partsForModel,
    ensurePartFitment, partFitsCar, isLegacyUnverifiedPart, modelUsesAtfFz,
    atfFilterPart, atfSealantPart, fuelSystemCleanerPart,
    tireShapeFor, TIRE_GUIDE
  };
});
