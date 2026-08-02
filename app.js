/* ============================================================
   Garage — 2016 Mazda 3 2.0 SkyActiv-G  ·  vanilla JS SPA
   Data persists in localStorage. Everything is editable in-app.
   ============================================================ */
'use strict';

const STORE_KEY = 'garage.mazda3.v1';
const TODAY = new Date('2026-08-02');

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const uid = () => Math.random().toString(36).slice(2, 9);
const fmt = n => Number(n).toLocaleString('en-US');
const sar = n => Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const parseDate = s => new Date(s + 'T00:00:00');
const isoDate = d => d.toISOString().slice(0, 10);
const monthsBetween = (a, b) => (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) + (b.getDate() - a.getDate()) / 30;
const addMonths = (d, m) => { const x = new Date(d); x.setMonth(x.getMonth() + Math.round(m)); return x; };
const relDate = d => {
  const days = Math.round((d - TODAY) / 86400000);
  if (days === 0) return 'today';
  if (days < 0) return `${Math.abs(days)}d ago`;
  if (days < 45) return `in ${days}d`;
  const mo = Math.round(days / 30);
  return `in ${mo} mo`;
};

/* ============================================================
   SEED DATA — Mazda 3 2.0 SkyActiv-G, Saudi (severe) intervals
   Odometer baseline ~155,000 km. All values editable in-app.
   ============================================================ */
function seed() {
  return {
    car: {
      nickname: '', make: 'Mazda', model: '3', year: 2016,
      engine: '2.0 SkyActiv-G', transmission: 'Automatic',
      color: 'Meteor Gray Mica', plate: '', vin: '', photo: '', odometer: 155000,
      dailyKm: 40 // avg km/day, used to project date from km
    },
    budget: { annual: 6000 },
    // recurring services: intervals in km & months
    services: [
      { id: uid(), name: 'Engine Oil & Filter', icon: '🛢️', cat: 'Engine',
        intervalKm: 5000, intervalMonths: 6, lastKm: 151200, lastDate: '2026-04-15', cost: 260,
        note: '0W-20 full synthetic + OEM filter. 5,000 km for Saudi heat (severe schedule).' },
      { id: uid(), name: 'Tire Rotation & Balance', icon: '🔄', cat: 'Tires',
        intervalKm: 10000, intervalMonths: 12, lastKm: 148000, lastDate: '2026-03-01', cost: 80,
        note: 'Rotate front/rear and rebalance to even out wear.' },
      { id: uid(), name: 'Cabin (A/C) Filter', icon: '❄️', cat: 'Interior',
        intervalKm: 15000, intervalMonths: 6, lastKm: 145000, lastDate: '2026-01-20', cost: 70,
        note: 'Dusty climate clogs it fast — check every 6 months.' },
      { id: uid(), name: 'Engine Air Filter', icon: '🌬️', cat: 'Engine',
        intervalKm: 20000, intervalMonths: 24, lastKm: 140000, lastDate: '2025-08-10', cost: 90,
        note: 'Inspect earlier in sandy conditions.' },
      { id: uid(), name: 'Wheel Alignment', icon: '🎯', cat: 'Tires',
        intervalKm: 20000, intervalMonths: 24, lastKm: 140000, lastDate: '2025-08-10', cost: 120,
        note: 'Also after any pothole hit or new tires.' },
      { id: uid(), name: 'Brake Fluid', icon: '🩸', cat: 'Brakes',
        intervalKm: 40000, intervalMonths: 24, lastKm: 128000, lastDate: '2024-09-01', cost: 150,
        note: 'DOT 3/4. Absorbs moisture over time — flush on schedule.' },
      { id: uid(), name: 'Automatic Transmission Fluid', icon: '⚙️', cat: 'Drivetrain',
        intervalKm: 60000, intervalMonths: 48, lastKm: 100000, lastDate: '2023-05-01', cost: 480,
        note: 'Mazda ATF FZ. Severe-use interval; dealer or specialist.' },
      { id: uid(), name: 'Engine Coolant (FL22)', icon: '🌡️', cat: 'Engine',
        intervalKm: 120000, intervalMonths: 48, lastKm: 130000, lastDate: '2023-08-01', cost: 220,
        note: 'FL22 long-life. First change high, then every ~60k km.' },
      { id: uid(), name: 'Spark Plugs (x4)', icon: '⚡', cat: 'Engine',
        intervalKm: 80000, intervalMonths: 72, lastKm: 96000, lastDate: '2022-06-01', cost: 340,
        note: 'Iridium NGK ILKAR7L11. Restores smooth idle & economy.' },
      { id: uid(), name: 'Fuel Filter', icon: '⛽', cat: 'Engine',
        intervalKm: 80000, intervalMonths: 72, lastKm: 80000, lastDate: '2021-05-01', cost: 180,
        note: 'In-tank filter; replace on high mileage.' },
      { id: uid(), name: 'Drive (Serpentine) Belt', icon: '🔗', cat: 'Engine',
        intervalKm: 90000, intervalMonths: 72, lastKm: 90000, lastDate: '2021-11-01', cost: 200,
        note: 'Inspect for cracks/squeal; replace before it fails.' },
      { id: uid(), name: 'Battery Check', icon: '🔋', cat: 'Electrical',
        intervalKm: 30000, intervalMonths: 12, lastKm: 150000, lastDate: '2025-10-01', cost: 0,
        note: 'Load-test yearly; heat shortens battery life in KSA.' }
    ],
    // parts catalog with OEM + alternatives
    parts: [
      { id: uid(), name: 'Engine Oil 0W-20 (4L)', icon: '🛢️', cat: 'Engine',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine 0W-20', partNo: '0000-77-0W20-QT', price: 190, store: 'Mazda Dealer (Alireza)' },
          { tag: 'ALT', brand: 'Mobil 1 0W-20 Full Synthetic', partNo: '', price: 150, store: 'Amazon.sa', note: 'Excellent value & protection' },
          { tag: 'ALT', brand: 'Castrol EDGE 0W-20', partNo: '', price: 145, store: 'noon' }
        ] },
      { id: uid(), name: 'Oil Filter', icon: '🧽', cat: 'Engine', partsouq: 'PE0114302A',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (verified for your VIN)', partNo: 'PE01-14-302A', price: 45, store: 'Mazda Dealer (Alireza)' },
          { tag: 'ALT', brand: 'Mazda Genuine PE01-14-302A', partNo: 'PE0114302A', price: 22, store: 'PartSouq ↗', note: 'Genuine, ships to KSA' },
          { tag: 'ALT', brand: 'Denso 150-2010', partNo: '150-2010', price: 28, store: 'Amazon.sa' },
          { tag: 'ALT', brand: 'Bosch 3330', partNo: '3330', price: 25, store: 'Local parts market' }
        ] },
      { id: uid(), name: 'Engine Air Filter', icon: '🌬️', cat: 'Engine', partsouq: 'PE07133A0A',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (verified for your VIN)', partNo: 'PE07-13-3A0A', price: 95, store: 'Mazda Dealer (Alireza)' },
          { tag: 'ALT', brand: 'Blue Print ADM52264', partNo: 'ADM52264', price: 25, store: 'PartSouq ↗', note: 'In stock · 4–5 days' },
          { tag: 'ALT', brand: 'WIX WA9774', partNo: 'WA9774', price: 25, store: 'PartSouq ↗' },
          { tag: 'ALT', brand: 'Denso Air Filter', partNo: '', price: 55, store: 'Amazon.sa' }
        ] },
      { id: uid(), name: 'Cabin A/C Filter', icon: '❄️', cat: 'Interior', partsouq: 'KD4561J6X',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (verified for your VIN)', partNo: 'KD45-61-J6X', price: 80, store: 'Mazda Dealer (Alireza)' },
          { tag: 'ALT', brand: 'Filtron K1316', partNo: 'K1316', price: 29, store: 'PartSouq ↗' },
          { tag: 'ALT', brand: 'Denso Carbon Cabin', partNo: '', price: 45, store: 'Amazon.sa', note: 'Activated carbon, odor control' }
        ] },
      { id: uid(), name: 'Spark Plugs (each)', icon: '⚡', cat: 'Engine', partsouq: 'PE5R18110',
        options: [
          { tag: 'OEM', brand: 'Mazda / NGK ILKAR7L11 (verified for your VIN)', partNo: 'PE5R-18-110', price: 70, store: 'Mazda Dealer (Alireza)' },
          { tag: 'ALT', brand: 'Mazda Genuine PE5R-18-110', partNo: 'PE5R18110', price: 84, store: 'PartSouq ↗', note: 'Genuine, ships to KSA' },
          { tag: 'ALT', brand: 'NGK Iridium ILKAR7L11', partNo: '94124', price: 55, store: 'Amazon.sa' },
          { tag: 'ALT', brand: 'Denso Iridium TT', partNo: '', price: 48, store: 'noon' }
        ] },
      { id: uid(), name: 'Front Brake Pads', icon: '🛑', cat: 'Brakes', partsouq: 'B4Y03328ZB',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (verified for your VIN)', partNo: 'B4Y0-33-28ZB', price: 320, store: 'Mazda Dealer (Alireza)' },
          { tag: 'ALT', brand: 'Asimco KD3043', partNo: 'KD3043', price: 57, store: 'PartSouq ↗', note: 'In stock · 4–5 days' },
          { tag: 'ALT', brand: 'Akebono Ceramic', partNo: '', price: 210, store: 'Amazon.sa', note: 'Low dust, quiet' },
          { tag: 'ALT', brand: 'Bosch QuietCast', partNo: '', price: 180, store: 'Local parts market' }
        ] },
      { id: uid(), name: 'Rear Brake Pads', icon: '🛑', cat: 'Brakes', partsouq: 'B4Y02648ZB',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (verified for your VIN)', partNo: 'B4Y0-26-48ZB', price: 260, store: 'Mazda Dealer (Alireza)' },
          { tag: 'ALT', brand: 'Akebono Ceramic', partNo: '', price: 170, store: 'Amazon.sa' }
        ] },
      { id: uid(), name: 'Wiper Blades (pair)', icon: '🌧️', cat: 'Exterior',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine', partNo: '', price: 150, store: 'Mazda Dealer (Alireza)' },
          { tag: 'ALT', brand: 'Bosch Aerotwin', partNo: '', price: 95, store: 'Amazon.sa' },
          { tag: 'ALT', brand: 'Valeo First', partNo: '', price: 70, store: 'noon' }
        ] },
      { id: uid(), name: '12V Battery', icon: '🔋', cat: 'Electrical',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine 55Ah', partNo: '', price: 480, store: 'Mazda Dealer (Alireza)' },
          { tag: 'ALT', brand: 'Varta Blue Dynamic', partNo: '', price: 360, store: 'AC Delco / battery shop', note: 'Strong in heat' },
          { tag: 'ALT', brand: 'AC Delco', partNo: '', price: 320, store: 'Local battery shop' }
        ] },
      { id: uid(), name: 'Serpentine Belt', icon: '🔗', cat: 'Engine', partsouq: 'PE0815909B',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (verified for your VIN)', partNo: 'PE08-15-909B', price: 150, store: 'Mazda Dealer (Alireza)' },
          { tag: 'ALT', brand: 'Gates Micro-V', partNo: '', price: 90, store: 'Amazon.sa' },
          { tag: 'ALT', brand: 'Dayco', partNo: '', price: 80, store: 'Local parts market' }
        ] },
      { id: uid(), name: 'Coolant FL22 (concentrate)', icon: '🌡️', cat: 'Engine',
        options: [
          { tag: 'OEM', brand: 'Mazda FL22 Long Life', partNo: '0000-77-508E-20', price: 130, store: 'Mazda Dealer (Alireza)' },
          { tag: 'ALT', brand: 'Zerex Asian Blue (P-HOAT)', partNo: '', price: 85, store: 'Amazon.sa', note: 'Compatible chemistry' }
        ] },
      { id: uid(), name: 'ATF FZ (per liter)', icon: '⚙️', cat: 'Drivetrain',
        options: [
          { tag: 'OEM', brand: 'Mazda ATF FZ', partNo: '0000-77-112E-01', price: 60, store: 'Mazda Dealer (Alireza)' },
          { tag: 'ALT', brand: 'Idemitsu Type FZ', partNo: '', price: 42, store: 'Amazon.sa', note: 'OEM supplier equivalent' }
        ] },
      /* ---- Suspension wear parts (verified for your VIN) ---- */
      { id: uid(), name: 'Front Shock Absorber (each)', icon: '🌀', cat: 'Suspension', partsouq: 'BHS234700A',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine — R: BHS2-34-700A · L: BHS2-34-900A', partNo: 'BHS2-34-700A', price: 286, store: 'Mazda Dealer (Alireza)', note: 'Bouncy ride / clunks = replace in pairs' },
          { tag: 'ALT', brand: 'KYB 3340035', partNo: '3340035', price: 323, store: 'PartSouq ↗', note: 'OEM-grade · in stock' },
          { tag: 'ALT', brand: 'Orient ORMZ3340035', partNo: 'ORMZ3340035', price: 103, store: 'PartSouq ↗', note: 'Budget · in stock' }
        ] },
      { id: uid(), name: 'Rear Shock Absorber (each)', icon: '🌀', cat: 'Suspension', partsouq: 'B45A28910B',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (verified for your VIN)', partNo: 'B45A-28-910B', price: 313, store: 'Mazda Dealer (Alireza)', note: 'Replace in pairs' },
          { tag: 'ALT', brand: 'Aftermarket (Orient) ORMZ3430041', partNo: 'ORMZ3430041', price: 46, store: 'PartSouq ↗', note: 'Budget · in stock' }
        ] },
      { id: uid(), name: 'Front Lower Control Arm (each)', icon: '🦴', cat: 'Suspension', partsouq: 'B60S34300',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine — R: B60S-34-300 · L: B60S-34-350', partNo: 'B60S-34-300', price: 417, store: 'Mazda Dealer (Alireza)', note: 'Incl. ball joint & bushing' },
          { tag: 'ALT', brand: 'Schnieder MZS2201914', partNo: 'MZS2201914', price: 173, store: 'PartSouq ↗', note: 'Complete arm · in stock' },
          { tag: 'ALT', brand: 'Febest Ball Joint 0520KE', partNo: '0520KE', price: 41, store: 'PartSouq ↗', note: 'Ball joint only' }
        ] },
      { id: uid(), name: 'Front Strut Mount Bearing (each)', icon: '⭕', cat: 'Suspension', partsouq: 'KR273438X',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (verified for your VIN)', partNo: 'KR27-34-38X', price: 60, store: 'Mazda Dealer (Alireza)', note: 'Creak/knock when turning = replace with struts' }
        ] },
      { id: uid(), name: 'Rear Wheel Hub Bearing (each)', icon: '⭕', cat: 'Suspension', partsouq: 'B45A2615X',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine — hub + bearing', partNo: 'B45A-26-15X', price: 340, store: 'Mazda Dealer (Alireza)', note: 'Humming/whine from rear = replace' }
        ] },
      { id: uid(), name: 'Stabilizer (Sway Bar) Link', icon: '🔗', cat: 'Suspension', partsouq: 'KD3128170',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine — R: KD31-28-170 · L: KD31-28-190', partNo: 'KD31-28-170', price: 90, store: 'Mazda Dealer (Alireza)', note: 'Rattle/clunk over bumps = worn links' }
        ] },
      /* ---- Electrical wear parts (verified for your VIN) ---- */
      { id: uid(), name: 'Ignition Coil (each)', icon: '⚡', cat: 'Electrical', partsouq: 'PE2018100A',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (verified for your VIN)', partNo: 'PE20-18-100A', price: 545, store: 'Mazda Dealer (Alireza)', note: 'Misfire / rough idle / flashing CEL = replace' },
          { tag: 'ALT', brand: 'Febest 05640002', partNo: '05640002', price: 158, store: 'PartSouq ↗', note: 'In stock' }
        ] },
      { id: uid(), name: 'Alternator', icon: '🔌', cat: 'Electrical', partsouq: 'PE0118300',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (verified for your VIN)', partNo: 'PE01-18-300', price: 1026, store: 'Mazda Dealer (Alireza)', note: 'Battery/charge warning light = check' },
          { tag: 'ALT', brand: 'Schnieder MZS1100125', partNo: 'MZS1100125', price: 362, store: 'PartSouq ↗' }
        ] },
      { id: uid(), name: 'Starter Motor', icon: '🔌', cat: 'Electrical', partsouq: 'PE0718400',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (verified for your VIN)', partNo: 'PE07-18-400', price: 527, store: 'Mazda Dealer (Alireza)', note: 'Slow / clicking crank = replace' }
        ] },
      /* ---- Brakes: discs / rotors (verified for your VIN) ---- */
      { id: uid(), name: 'Front Brake Disc (each)', icon: '💿', cat: 'Brakes', partsouq: 'B45G33251A',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (verified for your VIN)', partNo: 'B45G-33-251A', price: 271, store: 'Mazda Dealer (Alireza)', note: 'Vibration under braking / lip on edge = replace in pairs' },
          { tag: 'ALT', brand: 'Hi-Q SD4440', partNo: 'SD4440', price: 133, store: 'PartSouq ↗', note: 'In stock' }
        ] },
      { id: uid(), name: 'Rear Brake Disc (each)', icon: '💿', cat: 'Brakes', partsouq: 'B45G26251A',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (verified for your VIN)', partNo: 'B45G-26-251A', price: 163, store: 'Mazda Dealer (Alireza)', note: 'Replace in pairs with pads' }
        ] },
      /* ---- Cooling / engine wear (verified for your VIN) ---- */
      { id: uid(), name: 'Water Pump', icon: '💧', cat: 'Engine', partsouq: 'PE0115010B',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (verified for your VIN)', partNo: 'PE01-15-010B', price: 257, store: 'Mazda Dealer (Alireza)', note: 'Coolant leak / whine / overheating = replace' },
          { tag: 'ALT', brand: 'GMB GWMZ79AH', partNo: 'GWMZ79AH', price: 198, store: 'PartSouq ↗', note: 'OE supplier · in stock' },
          { tag: 'ALT', brand: 'GMB (OE) PE01-15-010B', partNo: 'PE0115010B', price: 128, store: 'PartSouq ↗', note: 'OE supplier' }
        ] },
      { id: uid(), name: 'Thermostat', icon: '🌡️', cat: 'Engine', partsouq: 'P50115171',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (verified for your VIN)', partNo: 'P501-15-171', price: 55, store: 'Mazda Dealer (Alireza)', note: 'Overheating or slow warm-up = replace' }
        ] },
      { id: uid(), name: 'A/F (Oxygen) Sensor — upstream', icon: '📡', cat: 'Engine', partsouq: 'PE01188G1A',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (verified for your VIN)', partNo: 'PE01-18-8G1A', price: 529, store: 'Mazda Dealer (Alireza)', note: 'CEL / rough idle / high fuel use = replace' }
        ] },
      /* ---- Drivetrain: CV axle joint (verified for your VIN) ---- */
      { id: uid(), name: 'Front CV Axle Joint (outer)', icon: '🦴', cat: 'Drivetrain', partsouq: 'FTC322510',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine — R outer FTC3-22-510', partNo: 'FTC3-22-510', price: 1001, store: 'Mazda Dealer (Alireza)', note: 'Clicking when turning = worn outer CV joint' },
          { tag: 'ALT', brand: 'Aftermarket complete axle', partNo: '', price: 260, store: 'Local parts market', note: 'Full axle often cheaper than OEM joint' }
        ] },
      /* ---- Known failure-prone parts on the BM Mazda 3 (researched) ---- */
      { id: uid(), name: 'MAF (Mass Air Flow) Sensor', icon: '📡', cat: 'Engine', partsouq: 'PE0113215',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (verified for your VIN)', partNo: 'PE01-13-215', price: 534, store: 'Mazda Dealer (Alireza)', note: 'Common failure: hesitation / stalling / CEL — clean first, then replace' }
        ] },
      { id: uid(), name: 'A/C Condenser', icon: '❄️', cat: 'A/C', partsouq: 'GHR161480B',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (verified for your VIN)', partNo: 'GHR1-61-480B', price: 794, store: 'Mazda Dealer (Alireza)', note: 'Known leak — Mazda extended the warranty on 2016–17. Weak A/C = check' },
          { tag: 'ALT', brand: 'Aftermarket condenser', partNo: '', price: 300, store: 'Local parts market', note: 'Widely available' }
        ] },
      { id: uid(), name: 'Front Coil Spring (each)', icon: '🌀', cat: 'Suspension', partsouq: 'B45M34011A',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine — front B45M-34-011A', partNo: 'B45M-34-011A', price: 192, store: 'Mazda Dealer (Alireza)', note: 'Coil springs crack/break on Mazda 3 (esp. rear) — sag or clunk = replace in pairs' }
        ] },
      { id: uid(), name: 'Front Wheel Hub Bearing (each)', icon: '⭕', cat: 'Suspension', partsouq: 'B45A3304X',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (verified for your VIN)', partNo: 'B45A-33-04X', price: 583, store: 'Mazda Dealer (Alireza)', note: 'Humming/growling that rises with speed = replace' }
        ] },
      /* ---- More common replaceables (verified for your VIN) ---- */
      { id: uid(), name: 'Radiator', icon: '🧊', cat: 'Engine', partsouq: 'PE2015200',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (verified for your VIN)', partNo: 'PE20-15-200', price: 989, store: 'Mazda Dealer (Alireza)', note: 'Leak / overheating / coolant residue = replace' },
          { tag: 'ALT', brand: 'Aftermarket radiator', partNo: '', price: 280, store: 'Local parts market', note: 'Widely available' }
        ] },
      { id: uid(), name: 'Engine Mount (No.4, right)', icon: '🧱', cat: 'Engine', partsouq: 'GHR939070B',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (verified for your VIN)', partNo: 'GHR9-39-070B', price: 217, store: 'Mazda Dealer (Alireza)', note: 'Vibration/clunk on start, idle or acceleration = worn mount' },
          { tag: 'ALT', brand: 'Febest MZMGJLH', partNo: 'MZMGJLH', price: 230, store: 'PartSouq ↗' }
        ] },
      { id: uid(), name: 'Front Brake Caliper (each)', icon: '🗜️', cat: 'Brakes', partsouq: 'B4Y73398ZB',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine — R: B4Y7-33-98ZB · L: B4Y7-33-99ZB', partNo: 'B4Y7-33-98ZB', price: 491, store: 'Mazda Dealer (Alireza)', note: 'Sticking/leaking = pulling or uneven pad wear' },
          { tag: 'ALT', brand: 'Febest rebuild kit 0575BMF', partNo: '0575BMF', price: 30, store: 'PartSouq ↗', note: 'Seals only — cheaper than full caliper' }
        ] },
      { id: uid(), name: 'Blower Motor (A/C fan)', icon: '💨', cat: 'A/C', partsouq: 'KD4561B10',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (verified for your VIN)', partNo: 'KD45-61-B10', price: 700, store: 'Mazda Dealer (Alireza)', note: 'No / weak / noisy airflow from vents = replace' }
        ] },
      { id: uid(), name: 'Headlight Unit (each)', icon: '💡', cat: 'Exterior', partsouq: 'BHW3510K0A',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine — R: BHW3-51-0K0A · L: BHW3-51-0L0A', partNo: 'BHW3-51-0K0A', price: 902, store: 'Mazda Dealer (Alireza)', note: 'Cracked/fogged lens or dead unit' },
          { tag: 'ALT', brand: 'Aftermarket headlight unit', partNo: '', price: 450, store: 'Local parts market' }
        ] }
    ],
    // completed-service history (the "work log", newest first by date)
    history: [
      { id: uid(), name: 'Engine Oil & Filter', icon: '🛢️', date: '2026-04-15', odometer: 151200, cost: 260, cat: 'Maintenance', note: '0W-20 full synthetic + OEM filter.' },
      { id: uid(), name: 'Tire Rotation & Balance', icon: '🔄', date: '2026-03-01', odometer: 148000, cost: 80, cat: 'Tires', note: '' },
      { id: uid(), name: 'Cabin (A/C) Filter', icon: '❄️', date: '2026-01-20', odometer: 145000, cost: 70, cat: 'Maintenance', note: 'Was very dusty.' },
      { id: uid(), name: 'Battery Check', icon: '🔋', date: '2025-10-01', odometer: 150000, cost: 0, cat: 'Electrical', note: 'Load test OK.' },
      { id: uid(), name: 'Engine Air Filter', icon: '🌬️', date: '2025-08-10', odometer: 140000, cost: 90, cat: 'Maintenance', note: '' },
      { id: uid(), name: 'Wheel Alignment', icon: '🎯', date: '2025-08-10', odometer: 140000, cost: 120, cat: 'Tires', note: 'After new front tires.' },
      { id: uid(), name: 'Front Brake Pads', icon: '🛑', date: '2024-11-12', odometer: 122000, cost: 210, cat: 'Parts', note: 'Akebono ceramic.' }
    ],
    // spending log
    spending: [
      { id: uid(), date: '2026-04-15', cat: 'Maintenance', desc: 'Oil & filter change', amount: 260, odometer: 151200 },
      { id: uid(), date: '2026-03-01', cat: 'Tires', desc: 'Rotation & balance', amount: 80, odometer: 148000 },
      { id: uid(), date: '2026-02-10', cat: 'Parts', desc: 'New wiper blades (Bosch)', amount: 95, odometer: 146500 },
      { id: uid(), date: '2026-01-20', cat: 'Maintenance', desc: 'Cabin A/C filter', amount: 70, odometer: 145000 },
      { id: uid(), date: '2025-11-05', cat: 'Fuel', desc: 'Full tank', amount: 130, odometer: 143200 },
      { id: uid(), date: '2025-10-01', cat: 'Electrical', desc: 'Battery load test', amount: 0, odometer: 150000 }
    ]
  };
}

/* ---------- state / storage ---------- */
let state = load();
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      // migrate: ensure newer fields exist on data saved by older versions
      s.car = Object.assign({ nickname: '', vin: '', photo: '' }, s.car);
      if (!Array.isArray(s.history)) s.history = [];
      return s;
    }
  } catch (e) {}
  const s = seed();
  try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) {}
  return s;
}
function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {} }

/* ---------- service status computation ---------- */
function serviceStatus(s) {
  const odo = state.car.odometer;
  const dueKm = s.lastKm + s.intervalKm;
  const kmLeft = dueKm - odo;
  const dueDate = addMonths(parseDate(s.lastDate), s.intervalMonths);
  const daysLeft = Math.round((dueDate - TODAY) / 86400000);
  // progress through the interval (0..1+), take the more advanced of km/time
  const kmProg = (odo - s.lastKm) / s.intervalKm;
  const timeProg = monthsBetween(parseDate(s.lastDate), TODAY) / s.intervalMonths;
  const prog = Math.max(kmProg, timeProg);
  // which dimension is driving the due?
  const drivenByTime = timeProg >= kmProg;
  let level = 'ok';
  if (kmLeft <= 0 || daysLeft <= 0) level = 'danger';
  else if (kmLeft <= 1200 || daysLeft <= 30) level = 'warn';
  return { dueKm, kmLeft, dueDate, daysLeft, prog: clamp(prog, 0, 1.2), level, drivenByTime };
}
function servicesRanked() {
  return state.services
    .map(s => ({ s, st: serviceStatus(s) }))
    .sort((a, b) => a.st.prog === b.st.prog ? a.st.kmLeft - b.st.kmLeft : b.st.prog - a.st.prog);
}
function healthScore() {
  const list = state.services.map(serviceStatus);
  if (!list.length) return 100;
  const penalty = list.reduce((acc, st) => acc + (st.level === 'danger' ? 1 : st.level === 'warn' ? 0.4 : 0), 0);
  return Math.round(clamp(100 - (penalty / list.length) * 100, 0, 100));
}
function yearSpend(year) {
  return state.spending.filter(e => e.date.startsWith(String(year))).reduce((a, e) => a + Number(e.amount), 0);
}

/* ============================================================
   ROUTER
   ============================================================ */
const routes = { dashboard: renderDashboard, maintenance: renderMaintenance, parts: renderParts, budget: renderBudget };
let current = 'dashboard';
function go(route) {
  current = route;
  const view = $('#view');
  view.className = 'view ' + route;
  view.innerHTML = '';
  view.appendChild(routes[route]());
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('is-active', t.dataset.route === route));
  $('#view').scrollTop = 0;
  window.scrollTo(0, 0);
}
document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => go(t.dataset.route)));

/* ============================================================
   PAGE 1 — DASHBOARD
   ============================================================ */
function renderDashboard() {
  const v = el('div');
  const ranked = servicesRanked();
  const overdue = ranked.filter(r => r.st.level === 'danger');
  const soon = ranked.filter(r => r.st.level === 'warn');
  const hs = healthScore();
  const spent = yearSpend(2026);
  const budget = state.budget.annual;

  // hero + ring
  const hero = el('div', 'card hero');
  const dash = 2 * Math.PI * 40;
  hero.innerHTML = `
    <div>
      <div class="odo-label">Odometer</div>
      <div class="odo-value">${fmt(state.car.odometer)}<span>km</span></div>
      <button class="odo-edit" id="editOdo">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
        Update mileage
      </button>
    </div>
    <div class="ring">
      <svg viewBox="0 0 92 92">
        <defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="${hs >= 70 ? '#23c186' : hs >= 45 ? '#f5a623' : '#ff4d5e'}"/>
          <stop offset="1" stop-color="${hs >= 70 ? '#4be0a6' : hs >= 45 ? '#ffce6b' : '#ff8a95'}"/>
        </linearGradient></defs>
        <circle class="track" cx="46" cy="46" r="40" fill="none" stroke-width="8"/>
        <circle class="prog" cx="46" cy="46" r="40" fill="none" stroke-width="8"
          stroke-dasharray="${dash}" stroke-dashoffset="${dash * (1 - hs / 100)}"/>
      </svg>
      <div class="ring-label"><div class="ring-num">${hs}</div><div class="ring-cap">Health</div></div>
    </div>`;
  if (state.car.photo) hero.insertAdjacentHTML('afterbegin', `<div class="hero-bg" style="background-image:url(${state.car.photo})"></div>`);
  v.appendChild(hero);

  // tiles
  const tiles = el('div', 'tiles');
  tiles.innerHTML = `
    <div class="tile ${overdue.length ? 'danger' : 'ok'}"><div class="t-num">${overdue.length}</div><div class="t-cap">Overdue</div></div>
    <div class="tile ${soon.length ? 'warn' : 'ok'}"><div class="t-num">${soon.length}</div><div class="t-cap">Due soon</div></div>
    <div class="tile"><div class="t-num">${sar(spent)}</div><div class="t-cap">SAR this year</div></div>`;
  v.appendChild(tiles);

  // Next up (top 4 services)
  v.appendChild(sectionTitle('Next up', 'See all', () => go('maintenance')));
  const list = el('div', 'list');
  ranked.slice(0, 4).forEach(({ s, st }) => list.appendChild(serviceItem(s, st)));
  v.appendChild(list);

  // Top recommendation
  const rec = topRecommendation(ranked);
  if (rec) {
    v.appendChild(sectionTitle('Recommendation', 'More', () => go('budget')));
    v.appendChild(rec);
  }

  // quick actions
  const row = el('div', 'fab-row');
  const bLog = el('button', 'btn primary block', iconSvg('check') + 'Log a service');
  bLog.onclick = () => openLogService();
  const bSpend = el('button', 'btn block', iconSvg('plus') + 'Add spending');
  bSpend.onclick = () => openAddSpending();
  row.append(bLog, bSpend);
  v.appendChild(row);

  hero.querySelector('#editOdo').onclick = openEditOdo;
  return v;
}

/* ============================================================
   PAGE 2 — MAINTENANCE
   ============================================================ */
let maintMode = 'Schedule'; // remembered across renders in the session
function renderMaintenance() {
  const v = el('div');
  v.appendChild(pageIntro('Maintenance', 'Your service schedule and full work history — tracked by distance and time.'));

  const modeSeg = el('div', 'seg');
  ['Schedule', 'History'].forEach(m => {
    const b = el('button', m === maintMode ? 'on' : '', m);
    b.onclick = () => { if (maintMode === m) return; maintMode = m; [...modeSeg.children].forEach(c => c.classList.toggle('on', c === b)); paintMode(); };
    modeSeg.appendChild(b);
  });
  v.appendChild(modeSeg);

  const body = el('div');
  v.appendChild(body);
  function paintMode() { body.innerHTML = ''; (maintMode === 'History' ? buildHistory : buildSchedule)(body); }
  paintMode();
  return v;
}

function buildSchedule(v) {
  const seg = el('div', 'seg');
  const filters = ['All', 'Overdue', 'Due soon', 'OK'];
  let active = 'All';
  filters.forEach(f => {
    const b = el('button', f === active ? 'on' : '', f);
    b.onclick = () => { active = f; [...seg.children].forEach(c => c.classList.toggle('on', c === b)); paint(); };
    seg.appendChild(b);
  });
  v.appendChild(seg);

  const list = el('div', 'list');
  v.appendChild(list);
  function paint() {
    list.innerHTML = '';
    let items = servicesRanked();
    if (active === 'Overdue') items = items.filter(r => r.st.level === 'danger');
    else if (active === 'Due soon') items = items.filter(r => r.st.level === 'warn');
    else if (active === 'OK') items = items.filter(r => r.st.level === 'ok');
    if (!items.length) { list.appendChild(emptyState('🎉', 'Nothing here — all good!')); return; }
    items.forEach(({ s, st }) => list.appendChild(serviceItem(s, st, true)));
  }
  paint();

  const add = el('button', 'btn block ghost', iconSvg('plus') + 'Add a custom service');
  add.style.marginTop = '16px';
  add.onclick = () => openEditService(null);
  v.appendChild(add);
}

function buildHistory(v) {
  const hist = [...state.history].sort((a, b) => b.date.localeCompare(a.date) || b.odometer - a.odometer);
  const totalCost = hist.reduce((a, e) => a + Number(e.cost || 0), 0);
  const last = hist[0];

  const tiles = el('div', 'tiles');
  tiles.innerHTML = `
    <div class="tile"><div class="t-num">${hist.length}</div><div class="t-cap">Services logged</div></div>
    <div class="tile"><div class="t-num">${sar(totalCost)}</div><div class="t-cap">SAR total</div></div>
    <div class="tile"><div class="t-num" style="font-size:15px;line-height:1.9">${last ? new Date(last.date + 'T00:00:00').toLocaleDateString('en', { day: 'numeric', month: 'short' }) : '—'}</div><div class="t-cap">Last service</div></div>`;
  v.appendChild(tiles);

  const add = el('button', 'btn block primary', iconSvg('plus') + 'Log a past service');
  add.style.margin = '14px 0 6px';
  add.onclick = () => openAddHistory(null);
  v.appendChild(add);

  if (!hist.length) { v.appendChild(emptyState('🧰', 'No service history yet.\nLog your first one above.')); return; }

  const tl = el('div', 'timeline');
  let lastYear = null;
  hist.forEach((e, i) => {
    const yr = e.date.slice(0, 4);
    if (yr !== lastYear) { tl.appendChild(el('div', 'tl-year', yr)); lastYear = yr; }
    const item = el('div', 'tl-item' + (i === hist.length - 1 ? ' last' : ''));
    const d = new Date(e.date + 'T00:00:00');
    item.innerHTML = `
      <div class="tl-dot">${e.icon || '🔧'}</div>
      <div class="card tl-card">
        <div class="tl-top"><h3>${e.name}</h3><div class="tl-cost">${e.cost > 0 ? sar(e.cost) + ' SAR' : '—'}</div></div>
        <div class="tl-sub">${d.toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' })} · ${fmt(e.odometer)} km</div>
        ${e.note ? `<div class="tl-note">${e.note}</div>` : ''}
      </div>`;
    item.querySelector('.tl-card').onclick = () => openAddHistory(e);
    tl.appendChild(item);
  });
  v.appendChild(tl);
}

function serviceItem(s, st, withBar) {
  const item = el('div', 'item');
  const pillTxt = st.level === 'danger' ? 'Overdue' : st.level === 'warn' ? 'Due soon' : 'On track';
  const kmTxt = st.kmLeft <= 0 ? `${fmt(-st.kmLeft)} km over` : `${fmt(st.kmLeft)} km left`;
  item.innerHTML = `
    <div class="item-ic">${s.icon || '🔧'}</div>
    <div class="item-main">
      <h3>${s.name}</h3>
      <p>${st.drivenByTime ? relDate(st.dueDate) + ' · ' : ''}${kmTxt}</p>
      ${withBar ? `<div class="bar ${st.level}"><span style="width:${clamp(st.prog, 0, 1) * 100}%"></span></div>` : ''}
    </div>
    <div class="item-side"><span class="pill ${st.level}">${pillTxt}</span></div>`;
  item.onclick = () => openServiceDetail(s);
  return item;
}

/* ============================================================
   PAGE 3 — PARTS
   ============================================================ */
function renderParts() {
  const v = el('div');
  v.appendChild(pageIntro('Car Parts', 'OEM parts with cheaper alternatives, prices and where to buy. Tap a part to compare.'));

  const cats = ['All', ...new Set(state.parts.map(p => p.cat))];
  let active = 'All';
  const seg = el('div', 'seg');
  seg.style.flexWrap = 'wrap';
  cats.forEach(c => {
    const b = el('button', c === active ? 'on' : '', c);
    b.onclick = () => { active = c; [...seg.children].forEach(x => x.classList.toggle('on', x === b)); paint(); };
    seg.appendChild(b);
  });
  v.appendChild(seg);

  const list = el('div', 'list');
  v.appendChild(list);
  function paint() {
    list.innerHTML = '';
    const items = state.parts.filter(p => active === 'All' || p.cat === active);
    items.forEach(p => list.appendChild(partCard(p)));
  }
  paint();

  const add = el('button', 'btn block ghost', iconSvg('plus') + 'Add a part');
  add.style.marginTop = '16px';
  add.onclick = () => openEditPart(null);
  v.appendChild(add);
  return v;
}

function partCard(p) {
  const cheapest = Math.min(...p.options.map(o => o.price));
  const card = el('div', 'card part');
  card.innerHTML = `
    <div class="part-head">
      <div class="item-ic">${p.icon || '🔩'}</div>
      <h3>${p.name}</h3>
      <div style="text-align:right">
        <div style="font-weight:750;font-size:14px">from ${sar(cheapest)} <span class="muted" style="font-size:11px">SAR</span></div>
        <div class="muted" style="font-size:11px">${p.options.length} options</div>
      </div>
      <button class="part-toggle"><svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></button>
    </div>
    <div class="part-body">
      ${p.options.map(o => `
        <div class="opt">
          <span class="opt-tag ${o.tag === 'OEM' ? 'oem' : 'alt'}">${o.tag}</span>
          <div class="opt-main">
            <div class="b">${o.brand}</div>
            <div class="s">${[o.partNo, o.note].filter(Boolean).join(' · ') || '&nbsp;'}</div>
          </div>
          <div class="opt-price">
            <div class="p">${sar(o.price)} <span class="muted" style="font-size:10px">SAR</span></div>
            <div class="store">${o.store}</div>
          </div>
        </div>`).join('')}
      ${p.partsouq ? `<a class="btn" href="https://partsouq.com/en/search/all?q=${encodeURIComponent(p.partsouq)}" target="_blank" rel="noopener noreferrer" style="width:100%;margin-top:12px;font-size:12.5px;padding:11px;text-decoration:none;color:var(--accent-soft)">🔎 Live price &amp; alternatives on PartSouq ↗</a>` : ''}
      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="btn ghost" style="flex:1;font-size:12.5px;padding:9px" data-edit>Edit</button>
      </div>
    </div>`;
  const toggle = () => card.classList.toggle('open');
  card.querySelector('.part-head').onclick = e => { if (!e.target.closest('.part-toggle') && !e.target.closest('button')) toggle(); };
  card.querySelector('.part-toggle').onclick = toggle;
  card.querySelector('[data-edit]').onclick = e => { e.stopPropagation(); openEditPart(p); };
  return card;
}

/* ============================================================
   PAGE 4 — BUDGET & SPENDING
   ============================================================ */
function renderBudget() {
  const v = el('div');
  v.appendChild(pageIntro('Budget & Spending', 'Track what your Mazda costs to run and keep it in top shape.'));

  const spent = yearSpend(2026);
  const budget = state.budget.annual;
  const pct = clamp(budget ? spent / budget : 0, 0, 1.2);
  const dash = 2 * Math.PI * 40;
  const overBudget = spent > budget;

  const ring = el('div', 'card budget-ring-card');
  ring.innerHTML = `
    <div class="ring" style="width:96px;height:96px">
      <svg viewBox="0 0 92 92" style="width:96px;height:96px">
        <defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="${overBudget ? '#ff4d5e' : '#d6203c'}"/>
          <stop offset="1" stop-color="${overBudget ? '#ff8a95' : '#ff5c6e'}"/>
        </linearGradient></defs>
        <circle class="track" cx="46" cy="46" r="40" fill="none" stroke-width="8"/>
        <circle class="prog" cx="46" cy="46" r="40" fill="none" stroke-width="8"
          stroke-dasharray="${dash}" stroke-dashoffset="${dash * (1 - clamp(pct, 0, 1))}"/>
      </svg>
      <div class="ring-label"><div class="ring-num" style="font-size:19px">${Math.round(pct * 100)}%</div><div class="ring-cap">of budget</div></div>
    </div>
    <div style="flex:1">
      <div class="muted" style="font-size:12px">Spent in 2026</div>
      <div style="font-size:26px;font-weight:800;letter-spacing:-.5px">${sar(spent)} <span class="muted" style="font-size:13px;font-weight:600">SAR</span></div>
      <div style="font-size:12.5px;margin-top:4px" class="${overBudget ? '' : 'muted'}">
        ${overBudget ? `⚠️ ${sar(spent - budget)} over budget` : `${sar(budget - spent)} SAR remaining of ${sar(budget)}`}
      </div>
      <button class="odo-edit" id="editBudget" style="margin-top:8px">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
        Set annual budget
      </button>
    </div>`;
  v.appendChild(ring);

  // monthly bars (last 6 months)
  v.appendChild(sectionTitle('Monthly spending', '', null));
  const bars = el('div', 'card');
  bars.style.padding = '16px';
  bars.appendChild(monthlyBars());
  v.appendChild(bars);

  // breakdown by category
  const byCat = {};
  state.spending.filter(e => e.date.startsWith('2026')).forEach(e => { byCat[e.cat] = (byCat[e.cat] || 0) + Number(e.amount); });
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  if (cats.length) {
    v.appendChild(sectionTitle('By category (2026)', '', null));
    const cc = el('div', 'card');
    cc.style.padding = '14px 16px';
    const total = cats.reduce((a, c) => a + c[1], 0) || 1;
    cc.innerHTML = cats.map(([k, val]) => `
      <div style="margin:10px 0 12px">
        <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px">
          <span>${k}</span><span style="font-weight:700">${sar(val)} SAR</span>
        </div>
        <div class="bar"><span style="width:${(val / total) * 100}%"></span></div>
      </div>`).join('');
    v.appendChild(cc);
  }

  // recommendations
  v.appendChild(sectionTitle('Keep it in top condition', '', null));
  const recs = el('div', 'list');
  recommendations().forEach(r => recs.appendChild(r));
  v.appendChild(recs);

  // spending log
  v.appendChild(sectionTitle('Recent spending', 'Add', () => openAddSpending()));
  const log = el('div', 'list');
  const sorted = [...state.spending].sort((a, b) => b.date.localeCompare(a.date));
  if (!sorted.length) log.appendChild(emptyState('🧾', 'No spending logged yet.'));
  sorted.slice(0, 12).forEach(e => log.appendChild(spendEntry(e)));
  v.appendChild(log);

  ring.querySelector('#editBudget').onclick = openEditBudget;
  return v;
}

function monthlyBars() {
  const wrap = el('div', 'spend-bars');
  const months = [];
  for (let i = 5; i >= 0; i--) { const d = new Date(TODAY.getFullYear(), TODAY.getMonth() - i, 1); months.push(d); }
  const totals = months.map(m => {
    const key = m.getFullYear() + '-' + String(m.getMonth() + 1).padStart(2, '0'); // local month, no TZ shift
    return state.spending.filter(e => e.date.startsWith(key)).reduce((a, e) => a + Number(e.amount), 0);
  });
  const max = Math.max(1, ...totals);
  months.forEach((m, i) => {
    const isNow = i === months.length - 1;
    const sb = el('div', 'sb' + (isNow ? ' now' : ''));
    const h = Math.max(4, (totals[i] / max) * 100);
    sb.innerHTML = `<div class="col" style="height:${h}%"></div><div class="m">${m.toLocaleString('en', { month: 'short' })}</div>`;
    sb.title = `${sar(totals[i])} SAR`;
    wrap.appendChild(sb);
  });
  return wrap;
}

function spendEntry(e) {
  const emoji = { Maintenance: '🔧', Tires: '🛞', Parts: '📦', Fuel: '⛽', Electrical: '🔋', Insurance: '📄', Other: '💠' }[e.cat] || '💠';
  const it = el('div', 'card entry');
  it.innerHTML = `
    <div class="e-ic">${emoji}</div>
    <div class="e-main"><h3>${e.desc}</h3><p>${e.cat} · ${new Date(e.date + 'T00:00:00').toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' })}</p></div>
    <div class="e-amt">${sar(e.amount)} <span class="muted" style="font-size:10px">SAR</span></div>`;
  it.onclick = () => openAddSpending(e);
  return it;
}

/* ---------- recommendations ---------- */
function topRecommendation(ranked) {
  const worst = ranked[0];
  if (!worst) return null;
  const { s, st } = worst;
  let txt;
  if (st.level === 'danger') txt = `${s.name} is overdue by ${st.kmLeft <= 0 ? fmt(-st.kmLeft) + ' km' : Math.abs(st.daysLeft) + ' days'}. Book it soon to avoid bigger repairs.`;
  else if (st.level === 'warn') txt = `${s.name} is due ${st.drivenByTime ? relDate(st.dueDate) : 'in ' + fmt(st.kmLeft) + ' km'}. Plan it into this month's budget.`;
  else txt = `You're on top of things — next up is ${s.name} in ${fmt(st.kmLeft)} km.`;
  const c = el('div', 'card rec');
  c.innerHTML = `<div class="r-ic">${st.level === 'danger' ? '🚨' : st.level === 'warn' ? '⏰' : '✅'}</div><div><h3>${s.name}</h3><p>${txt}</p></div>`;
  return c;
}

function recommendations() {
  const out = [];
  const ranked = servicesRanked();
  const overdue = ranked.filter(r => r.st.level === 'danger');
  const soon = ranked.filter(r => r.st.level === 'warn');

  overdue.slice(0, 2).forEach(({ s, st }) => out.push(recCard('🚨', `${s.name} — overdue`,
    `${st.kmLeft <= 0 ? fmt(-st.kmLeft) + ' km past due' : Math.abs(st.daysLeft) + ' days past due'}. Estimated ${sar(s.cost)} SAR. Do this first.`)));
  soon.slice(0, 2).forEach(({ s, st }) => out.push(recCard('⏰', `${s.name} — coming up`,
    `Due ${st.drivenByTime ? relDate(st.dueDate) : 'in ' + fmt(st.kmLeft) + ' km'}. Budget ~${sar(s.cost)} SAR.`)));

  // evergreen tips
  const tips = [
    ['🌡️', 'Beat the Saudi heat', 'Check coolant level and A/C performance before summer. Heat is the #1 killer of batteries and rubber hoses here.'],
    ['🛞', 'Tire pressure weekly', 'Check pressures when cold (≈32 psi). Correct pressure saves fuel and prevents blowouts on hot asphalt.'],
    ['🛢️', 'Stick to 5,000 km oil', 'Short trips + heat + dust = severe conditions. Frequent 0W-20 changes keep the SkyActiv engine clean.'],
    ['💧', 'Wash off dust & salt', 'Regular washes protect paint and underbody from corrosion, especially near the coast.']
  ];
  const need = Math.max(0, 3 - out.length);
  tips.slice(0, need + 1).forEach(t => out.push(recCard(t[0], t[1], t[2])));
  return out;
}
function recCard(ic, title, body) {
  const c = el('div', 'card rec');
  c.innerHTML = `<div class="r-ic">${ic}</div><div><h3>${title}</h3><p>${body}</p></div>`;
  return c;
}

/* ============================================================
   MODALS
   ============================================================ */
function openModal(title, sub, bodyBuilder) {
  const host = $('#modalHost'), card = $('#modalCard');
  card.innerHTML = '<div class="modal-grip"></div>';
  const h = el('h2', null, title); card.appendChild(h);
  if (sub) card.appendChild(el('p', 'sub', sub));
  bodyBuilder(card);
  host.hidden = false;
  host.querySelector('[data-close]').onclick = closeModal;
}
function closeModal() { $('#modalHost').hidden = true; }
function field(label, inputHtml) {
  const f = el('div', 'field');
  f.innerHTML = `<label>${label}</label>${inputHtml}`;
  return f;
}

function openEditOdo() {
  openModal('Update mileage', 'Keep this current so due dates stay accurate.', card => {
    card.appendChild(field('Odometer (km)', `<input id="m_odo" type="number" inputmode="numeric" value="${state.car.odometer}">`));
    card.appendChild(field('Average driving (km / day)', `<input id="m_daily" type="number" inputmode="numeric" value="${state.car.dailyKm}">`));
    const b = el('button', 'btn primary block', 'Save');
    b.onclick = () => {
      const val = parseInt($('#m_odo').value, 10);
      if (!isNaN(val)) state.car.odometer = val;
      const d = parseInt($('#m_daily').value, 10);
      if (!isNaN(d) && d > 0) state.car.dailyKm = d;
      save(); closeModal(); go(current); toast('Mileage updated');
    };
    card.appendChild(b);
  });
}

/* ---------- car profile / settings ---------- */
function carTitle() { return state.car.nickname || `${state.car.make} ${state.car.model}`.trim() || 'My car'; }
function carInitials() {
  const c = state.car;
  const a = (c.make || '')[0] || '';
  const b = (c.model || '')[0] || '';
  return (a + b).toUpperCase() || '🚗';
}
function renderTopbar() {
  const c = state.car;
  $('#carTitle').textContent = carTitle();
  $('#carSub').textContent = [c.year, c.engine, c.transmission, c.color].filter(Boolean).join(' · ');
  const badge = $('#carBadge');
  if (c.photo) { badge.classList.add('has-photo'); badge.innerHTML = `<img src="${c.photo}" alt="">`; }
  else { badge.classList.remove('has-photo'); badge.textContent = carInitials(); }
}

// downscale an uploaded image to keep localStorage small; returns a JPEG data URL
function readImageResized(file, cb) {
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const max = 900;
      let { width: w, height: h } = img;
      if (w > max || h > max) { const r = Math.min(max / w, max / h); w = Math.round(w * r); h = Math.round(h * r); }
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(img, 0, 0, w, h);
      cb(cv.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => toast('Could not read that image', 'warn');
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

function openSettings() {
  openModal('Car profile', 'These details personalise the app and its badge.', card => {
    const c = state.car;
    let photo = c.photo || '';

    const picker = el('div', 'photo-picker');
    picker.innerHTML = `
      <div class="photo-preview" id="s_prev">${photo ? `<img src="${photo}">` : '🚗'}</div>
      <div class="photo-actions">
        <button class="btn" id="s_pick">${photo ? 'Change photo' : 'Add photo'}</button>
        <button class="btn ghost" id="s_rm" ${photo ? '' : 'hidden'} style="color:var(--danger)">Remove</button>
        <input type="file" accept="image/*" id="s_file" hidden>
      </div>`;
    card.appendChild(picker);
    const prev = picker.querySelector('#s_prev');
    picker.querySelector('#s_pick').onclick = () => picker.querySelector('#s_file').click();
    picker.querySelector('#s_file').onchange = e => {
      const f = e.target.files[0]; if (!f) return;
      readImageResized(f, url => { photo = url; prev.innerHTML = `<img src="${url}">`; picker.querySelector('#s_pick').textContent = 'Change photo'; picker.querySelector('#s_rm').hidden = false; });
    };
    picker.querySelector('#s_rm').onclick = () => { photo = ''; prev.innerHTML = '🚗'; picker.querySelector('#s_pick').textContent = 'Add photo'; picker.querySelector('#s_rm').hidden = true; };

    card.appendChild(field('Nickname (optional)', `<input id="c_nick" value="${c.nickname || ''}" placeholder="e.g. The Gray Ghost">`));
    const r1 = el('div', 'field-row');
    r1.append(field('Make', `<input id="c_make" value="${c.make || ''}">`), field('Model', `<input id="c_model" value="${c.model || ''}">`));
    card.appendChild(r1);
    const r2 = el('div', 'field-row');
    r2.append(field('Year', `<input id="c_year" type="number" value="${c.year || ''}">`), field('Color', `<input id="c_color" value="${c.color || ''}">`));
    card.appendChild(r2);
    const r3 = el('div', 'field-row');
    r3.append(field('Engine', `<input id="c_engine" value="${c.engine || ''}">`),
      field('Transmission', `<select id="c_trans">${['Automatic', 'Manual', 'CVT', 'Dual-clutch'].map(t => `<option ${c.transmission === t ? 'selected' : ''}>${t}</option>`).join('')}</select>`));
    card.appendChild(r3);
    const r4 = el('div', 'field-row');
    r4.append(field('Plate number', `<input id="c_plate" value="${c.plate || ''}" placeholder="e.g. ABC 1234">`),
      field('VIN', `<input id="c_vin" value="${c.vin || ''}" placeholder="17-char VIN">`));
    card.appendChild(r4);

    const b = el('button', 'btn primary block', 'Save profile');
    b.onclick = () => {
      Object.assign(state.car, {
        nickname: $('#c_nick').value.trim(), make: $('#c_make').value.trim(), model: $('#c_model').value.trim(),
        year: +$('#c_year').value || c.year, color: $('#c_color').value.trim(),
        engine: $('#c_engine').value.trim(), transmission: $('#c_trans').value,
        plate: $('#c_plate').value.trim(), vin: $('#c_vin').value.trim().toUpperCase(), photo
      });
      try { save(); } catch (e) {}
      // photo may exceed quota — verify it stuck
      renderTopbar(); closeModal(); go(current); toast('Profile saved');
    };
    card.appendChild(b);
  });
}

function openEditBudget() {
  openModal('Annual budget', 'Your target spend on the car for the year.', card => {
    card.appendChild(field('Budget (SAR / year)', `<input id="m_budget" type="number" inputmode="numeric" value="${state.budget.annual}">`));
    const b = el('button', 'btn primary block', 'Save');
    b.onclick = () => { const v = parseInt($('#m_budget').value, 10); if (!isNaN(v)) state.budget.annual = v; save(); closeModal(); go('budget'); toast('Budget updated'); };
    card.appendChild(b);
  });
}

function openServiceDetail(s) {
  const st = serviceStatus(s);
  openModal(s.name, s.cat, card => {
    const pillTxt = st.level === 'danger' ? 'Overdue' : st.level === 'warn' ? 'Due soon' : 'On track';
    const box = el('div');
    box.innerHTML = `
      <div style="margin:2px 0 14px"><span class="pill ${st.level}">${pillTxt}</span></div>
      <div class="detail-row"><span class="k">Interval</span><span class="v">${fmt(s.intervalKm)} km / ${s.intervalMonths} mo</span></div>
      <div class="detail-row"><span class="k">Last done</span><span class="v">${fmt(s.lastKm)} km · ${new Date(s.lastDate + 'T00:00:00').toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' })}</span></div>
      <div class="detail-row"><span class="k">Next due</span><span class="v">${fmt(st.dueKm)} km · ${st.dueDate.toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' })}</span></div>
      <div class="detail-row"><span class="k">Distance left</span><span class="v">${st.kmLeft <= 0 ? fmt(-st.kmLeft) + ' km over' : fmt(st.kmLeft) + ' km'}</span></div>
      <div class="detail-row"><span class="k">Est. cost</span><span class="v">${sar(s.cost)} SAR</span></div>
      ${s.note ? `<p class="muted" style="font-size:12.5px;margin-top:14px;line-height:1.5">${s.note}</p>` : ''}`;
    card.appendChild(box);
    const row = el('div', 'fab-row');
    const done = el('button', 'btn primary', iconSvg('check') + 'Mark done now');
    done.style.flex = '1';
    done.onclick = () => { markServiceDone(s); closeModal(); go(current); toast(`${s.name} logged ✓`); };
    const edit = el('button', 'btn', 'Edit');
    edit.onclick = () => openEditService(s);
    row.append(done, edit);
    card.appendChild(row);
  });
}

function markServiceDone(s) {
  s.lastKm = state.car.odometer;
  s.lastDate = isoDate(TODAY);
  // record it in the work history
  state.history.push({ id: uid(), name: s.name, icon: s.icon || '🔧', date: isoDate(TODAY), odometer: state.car.odometer, cost: s.cost || 0, cat: 'Maintenance', note: '' });
  // log the spend
  if (s.cost > 0) state.spending.push({ id: uid(), date: isoDate(TODAY), cat: 'Maintenance', desc: s.name, amount: s.cost, odometer: state.car.odometer });
  save();
}

function openAddHistory(e) {
  const editing = !!e;
  const cats = ['Maintenance', 'Tires', 'Parts', 'Fuel', 'Electrical', 'Other'];
  openModal(editing ? 'Edit service record' : 'Log a past service', editing ? '' : 'Record work already done on your car.', card => {
    card.appendChild(field('Service', `<input id="h_name" value="${e ? e.name : ''}" placeholder="e.g. Timing chain inspection">`));
    const r0 = el('div', 'field-row');
    r0.append(field('Icon (emoji)', `<input id="h_icon" value="${e ? e.icon : '🔧'}" maxlength="2">`),
      field('Category', `<select id="h_cat">${cats.map(c => `<option ${e && e.cat === c ? 'selected' : ''}>${c}</option>`).join('')}</select>`));
    card.appendChild(r0);
    const r1 = el('div', 'field-row');
    r1.append(field('Date', `<input id="h_date" type="date" value="${e ? e.date : isoDate(TODAY)}">`),
      field('Odometer (km)', `<input id="h_odo" type="number" value="${e ? e.odometer : state.car.odometer}">`));
    card.appendChild(r1);
    card.appendChild(field('Cost (SAR)', `<input id="h_cost" type="number" value="${e ? e.cost : 0}">`));
    card.appendChild(field('Note', `<textarea id="h_note" rows="2">${e ? (e.note || '') : ''}</textarea>`));
    if (!editing) {
      const chk = el('div', 'field');
      chk.innerHTML = `<label style="display:flex;align-items:center;gap:9px;font-size:13px;color:var(--text);font-weight:500;cursor:pointer">
        <input type="checkbox" id="h_spend" checked style="width:auto;accent-color:var(--accent)"> Also add this cost to Budget</label>`;
      card.appendChild(chk);
    }
    const b = el('button', 'btn primary block', editing ? 'Save changes' : 'Add to history');
    b.onclick = () => {
      const name = $('#h_name').value.trim();
      if (!name) return toast('Service name required', 'warn');
      const obj = {
        id: e ? e.id : uid(), name, icon: $('#h_icon').value.trim() || '🔧', cat: $('#h_cat').value,
        date: $('#h_date').value || isoDate(TODAY), odometer: +$('#h_odo').value || 0,
        cost: +$('#h_cost').value || 0, note: $('#h_note').value.trim()
      };
      if (e) Object.assign(e, obj);
      else {
        state.history.push(obj);
        if ($('#h_spend').checked && obj.cost > 0) state.spending.push({ id: uid(), date: obj.date, cat: obj.cat, desc: obj.name, amount: obj.cost, odometer: obj.odometer });
      }
      save(); closeModal(); go('maintenance'); toast(editing ? 'Record updated' : 'Service logged ✓');
    };
    card.appendChild(b);
    if (editing) {
      const del = el('button', 'btn block ghost', 'Delete record');
      del.style.marginTop = '8px'; del.style.color = 'var(--danger)';
      del.onclick = () => { state.history = state.history.filter(x => x.id !== e.id); save(); closeModal(); go('maintenance'); toast('Record deleted'); };
      card.appendChild(del);
    }
  });
}

function openEditService(s) {
  const editing = !!s;
  openModal(editing ? 'Edit service' : 'New service', 'Set the interval and last service point.', card => {
    card.appendChild(field('Name', `<input id="s_name" value="${s ? s.name : ''}" placeholder="e.g. Timing chain check">`));
    card.appendChild(field('Icon (emoji)', `<input id="s_icon" value="${s ? s.icon : '🔧'}" maxlength="2">`));
    const row1 = el('div', 'field-row');
    row1.append(field('Interval (km)', `<input id="s_ikm" type="number" value="${s ? s.intervalKm : 10000}">`),
      field('Interval (months)', `<input id="s_imo" type="number" value="${s ? s.intervalMonths : 12}">`));
    card.appendChild(row1);
    const row2 = el('div', 'field-row');
    row2.append(field('Last done (km)', `<input id="s_lkm" type="number" value="${s ? s.lastKm : state.car.odometer}">`),
      field('Last done (date)', `<input id="s_ldate" type="date" value="${s ? s.lastDate : isoDate(TODAY)}">`));
    card.appendChild(row2);
    const row3 = el('div', 'field-row');
    row3.append(field('Category', `<input id="s_cat" value="${s ? s.cat : 'General'}">`),
      field('Est. cost (SAR)', `<input id="s_cost" type="number" value="${s ? s.cost : 0}">`));
    card.appendChild(row3);
    card.appendChild(field('Note', `<textarea id="s_note" rows="2">${s ? (s.note || '') : ''}</textarea>`));
    const b = el('button', 'btn primary block', 'Save service');
    b.onclick = () => {
      const name = $('#s_name').value.trim();
      if (!name) return toast('Name is required', 'warn');
      const obj = {
        id: s ? s.id : uid(), name, icon: $('#s_icon').value.trim() || '🔧',
        cat: $('#s_cat').value.trim() || 'General',
        intervalKm: +$('#s_ikm').value || 10000, intervalMonths: +$('#s_imo').value || 12,
        lastKm: +$('#s_lkm').value || 0, lastDate: $('#s_ldate').value || isoDate(TODAY),
        cost: +$('#s_cost').value || 0, note: $('#s_note').value.trim()
      };
      if (s) Object.assign(s, obj); else state.services.push(obj);
      save(); closeModal(); go('maintenance'); toast(editing ? 'Service updated' : 'Service added');
    };
    card.appendChild(b);
    if (editing) {
      const del = el('button', 'btn block ghost', 'Delete service');
      del.style.marginTop = '8px'; del.style.color = 'var(--danger)';
      del.onclick = () => { state.services = state.services.filter(x => x.id !== s.id); save(); closeModal(); go('maintenance'); toast('Service deleted'); };
      card.appendChild(del);
    }
  });
}

function openLogService() {
  openModal('Log a service', 'Pick what you just had done — it resets the clock and adds the cost.', card => {
    const list = el('div', 'list');
    servicesRanked().forEach(({ s, st }) => {
      const it = serviceItem(s, st);
      it.onclick = () => { markServiceDone(s); closeModal(); go(current); toast(`${s.name} logged ✓`); };
      list.appendChild(it);
    });
    card.appendChild(list);
  });
}

function openAddSpending(e) {
  const editing = !!e;
  const cats = ['Maintenance', 'Tires', 'Parts', 'Fuel', 'Electrical', 'Insurance', 'Other'];
  openModal(editing ? 'Edit expense' : 'Add spending', 'Log money spent on the car.', card => {
    card.appendChild(field('Description', `<input id="x_desc" value="${e ? e.desc : ''}" placeholder="e.g. New front brake pads">`));
    const row = el('div', 'field-row');
    row.append(field('Amount (SAR)', `<input id="x_amt" type="number" inputmode="numeric" value="${e ? e.amount : ''}">`),
      field('Date', `<input id="x_date" type="date" value="${e ? e.date : isoDate(TODAY)}">`));
    card.appendChild(row);
    card.appendChild(field('Category', `<select id="x_cat">${cats.map(c => `<option ${e && e.cat === c ? 'selected' : ''}>${c}</option>`).join('')}</select>`));
    card.appendChild(field('Odometer at time (km)', `<input id="x_odo" type="number" value="${e ? e.odometer : state.car.odometer}">`));
    const b = el('button', 'btn primary block', 'Save');
    b.onclick = () => {
      const desc = $('#x_desc').value.trim(); const amt = +$('#x_amt').value;
      if (!desc) return toast('Description required', 'warn');
      if (isNaN(amt)) return toast('Amount required', 'warn');
      const obj = { id: e ? e.id : uid(), desc, amount: amt, date: $('#x_date').value || isoDate(TODAY), cat: $('#x_cat').value, odometer: +$('#x_odo').value || state.car.odometer };
      if (e) Object.assign(e, obj); else state.spending.push(obj);
      save(); closeModal(); go('budget'); toast(editing ? 'Expense updated' : 'Expense added');
    };
    card.appendChild(b);
    if (editing) {
      const del = el('button', 'btn block ghost', 'Delete expense');
      del.style.marginTop = '8px'; del.style.color = 'var(--danger)';
      del.onclick = () => { state.spending = state.spending.filter(x => x.id !== e.id); save(); closeModal(); go('budget'); toast('Expense deleted'); };
      card.appendChild(del);
    }
  });
}

function openEditPart(p) {
  const editing = !!p;
  openModal(editing ? 'Edit part' : 'New part', 'Add the OEM option and any alternatives.', card => {
    card.appendChild(field('Part name', `<input id="p_name" value="${p ? p.name : ''}" placeholder="e.g. Front Brake Pads">`));
    const row = el('div', 'field-row');
    row.append(field('Icon (emoji)', `<input id="p_icon" value="${p ? p.icon : '🔩'}" maxlength="2">`),
      field('Category', `<input id="p_cat" value="${p ? p.cat : 'Engine'}">`));
    card.appendChild(row);
    card.appendChild(field('PartSouq part no. (optional — enables live-price link)', `<input id="p_psq" value="${p && p.partsouq ? p.partsouq : ''}" placeholder="e.g. PE0114302A">`));

    const optsWrap = el('div');
    card.appendChild(el('label', null, 'Options').cloneNode(true));
    const lbl = el('div'); lbl.style.cssText = 'font-size:12px;font-weight:600;color:var(--text-2);margin:6px 0';
    lbl.textContent = 'Options (OEM & alternatives)';
    card.appendChild(lbl);
    card.appendChild(optsWrap);

    const opts = p ? JSON.parse(JSON.stringify(p.options)) : [{ tag: 'OEM', brand: '', partNo: '', price: 0, store: '', note: '' }];
    function drawOpts() {
      optsWrap.innerHTML = '';
      opts.forEach((o, i) => {
        const box = el('div', 'card');
        box.style.cssText = 'padding:12px;margin-bottom:10px';
        box.innerHTML = `
          <div class="field-row" style="margin-bottom:8px">
            <div class="field" style="margin:0"><label>Type</label><select data-k="tag"><option ${o.tag === 'OEM' ? 'selected' : ''}>OEM</option><option ${o.tag !== 'OEM' ? 'selected' : ''}>ALT</option></select></div>
            <div class="field" style="margin:0"><label>Price (SAR)</label><input type="number" data-k="price" value="${o.price}"></div>
          </div>
          <div class="field" style="margin:0 0 8px"><label>Brand / product</label><input data-k="brand" value="${o.brand || ''}"></div>
          <div class="field-row" style="margin-bottom:8px">
            <div class="field" style="margin:0"><label>Part no.</label><input data-k="partNo" value="${o.partNo || ''}"></div>
            <div class="field" style="margin:0"><label>Store</label><input data-k="store" value="${o.store || ''}"></div>
          </div>
          <div class="field" style="margin:0"><label>Note</label><input data-k="note" value="${o.note || ''}"></div>`;
        box.querySelectorAll('[data-k]').forEach(inp => inp.oninput = () => { o[inp.dataset.k] = inp.type === 'number' ? +inp.value : inp.value; });
        if (opts.length > 1) {
          const rm = el('button', 'btn ghost', 'Remove option'); rm.style.cssText = 'margin-top:8px;font-size:12px;padding:7px;color:var(--danger)';
          rm.onclick = () => { opts.splice(i, 1); drawOpts(); };
          box.appendChild(rm);
        }
        optsWrap.appendChild(box);
      });
    }
    drawOpts();
    const addOpt = el('button', 'btn block ghost', iconSvg('plus') + 'Add option');
    addOpt.style.marginBottom = '14px';
    addOpt.onclick = () => { opts.push({ tag: 'ALT', brand: '', partNo: '', price: 0, store: '', note: '' }); drawOpts(); };
    card.appendChild(addOpt);

    const b = el('button', 'btn primary block', 'Save part');
    b.onclick = () => {
      const name = $('#p_name').value.trim();
      if (!name) return toast('Part name required', 'warn');
      const valid = opts.filter(o => o.brand.trim());
      if (!valid.length) return toast('Add at least one option', 'warn');
      const obj = { id: p ? p.id : uid(), name, icon: $('#p_icon').value.trim() || '🔩', cat: $('#p_cat').value.trim() || 'General', partsouq: $('#p_psq').value.trim().replace(/[^A-Za-z0-9]/g, ''), options: valid };
      if (p) Object.assign(p, obj); else state.parts.push(obj);
      save(); closeModal(); go('parts'); toast(editing ? 'Part updated' : 'Part added');
    };
    card.appendChild(b);
    if (editing) {
      const del = el('button', 'btn block ghost', 'Delete part');
      del.style.marginTop = '8px'; del.style.color = 'var(--danger)';
      del.onclick = () => { state.parts = state.parts.filter(x => x.id !== p.id); save(); closeModal(); go('parts'); toast('Part deleted'); };
      card.appendChild(del);
    }
  });
}

/* ============================================================
   SHARED UI BITS
   ============================================================ */
function sectionTitle(title, linkTxt, onLink) {
  const s = el('div', 'section-title');
  s.appendChild(el('h2', null, title));
  if (linkTxt && onLink) { const b = el('button', 'link', linkTxt); b.onclick = onLink; s.appendChild(b); }
  return s;
}
function pageIntro(title, sub) {
  const d = el('div');
  d.style.margin = '6px 4px 8px';
  d.innerHTML = `<h2 style="font-size:22px;font-weight:800;letter-spacing:-.4px">${title}</h2><p class="muted" style="font-size:13px;margin-top:4px;line-height:1.5">${sub}</p>`;
  return d;
}
function emptyState(emoji, txt) {
  const e = el('div', 'empty');
  e.innerHTML = `<div class="e-emoji">${emoji}</div><p>${txt}</p>`;
  return e;
}
function iconSvg(name) {
  const paths = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    check: '<path d="M20 6 9 17l-5-5"/>'
  };
  return `<svg viewBox="0 0 24 24">${paths[name] || ''}</svg>`;
}
function toast(msg, kind) {
  const host = $('#toastHost');
  const t = el('div', 'toast', `<span class="dot" style="background:${kind === 'warn' ? 'var(--warn)' : 'var(--ok)'}"></span>${msg}`);
  host.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(10px)'; t.style.transition = '.3s'; setTimeout(() => t.remove(), 300); }, 2200);
}

/* ---------- theme ---------- */
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  $('meta[name=theme-color]').setAttribute('content', t === 'light' ? '#eef0f4' : '#141518');
  try { localStorage.setItem('garage.theme', t); } catch (e) {}
}
$('#themeToggle').onclick = () => applyTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light');
applyTheme(localStorage.getItem('garage.theme') || 'dark');

/* ---------- boot ---------- */
$('#settingsBtn').onclick = openSettings;
$('#openProfile').onclick = openSettings;
renderTopbar();
go('dashboard');
