# Garage — Mazda care app

A modern, fully responsive web app to keep any Mazda in top condition — pick your model, generation and engine from the built-in catalog (Mazda 2 through CX-90) and it sets up a matching service plan. Supports multiple vehicles in one garage.
Pure HTML/CSS/JS — no build step, no dependencies. All data is saved locally in your browser (`localStorage`/IndexedDB) and is fully editable in-app.

**Responsive layout:**
- **Phone** — single column with a floating bottom tab bar.
- **Tablet** — wider column, two-column cards, bottom tab bar.
- **Laptop / Desktop** — left sidebar navigation, wide multi-column content, centered dialog modals.

## Pages
1. **Dashboard** — odometer, health score, overdue/due-soon counts, spend-to-date, "next up" services, top recommendation, quick actions. Your car photo appears as a subtle backdrop.
2. **Maintenance** — two views via a toggle:
   - **Schedule** — recurring services tracked by **distance and time (whichever comes first)**, with status filters, progress bars, mark-done, add/edit/delete.
   - **History** — a year-grouped timeline of every completed service (date, mileage, cost, notes) with totals. Marking a service done logs it here automatically; you can also log past services (with an option to add the cost to Budget).
3. **Car Parts** — each part with the **OEM option + cheaper alternatives**, price (SAR) and where to buy; add/edit your own. OEM numbers are **verified against the PartSouq genuine catalog for the car's VIN** (e.g. oil filter PE01-14-302A, air filter PE07-13-3A0A, front pads B4Y0-33-28ZB). Each catalogued part has a **"Live price & alternatives on PartSouq"** link that opens the current price/stock for that exact part number. Prices shown are indicative (PartSouq quotes USD; converted at ≈3.75 SAR and it ships internationally). Set a part's PartSouq number in the part editor to enable the link on custom parts. Includes **Suspension** wear parts (shocks, lower control arms, strut mount bearing, front/rear wheel hub bearings, sway-bar links, coil spring), **Electrical** wear parts (ignition coil, alternator, starter), cooling parts (water pump, thermostat, A/C condenser), brake rotors, MAF and A/F sensors, and CV axle — including the model's **known failure points** (researched for the BM Mazda 3: MAF sensor, A/C condenser leak, coil springs, wheel bearings). Each carries a symptom hint for when to replace.
4. **Budget & Spending** — annual budget ring, 6-month spend chart, category breakdown, tailored recommendations, and an editable expense log.

**Settings / Car profile** (gear icon, or tap the car name in the top bar) — edit nickname, make, model, year, color, engine, transmission, plate and VIN, and add a photo of your car (stored locally, auto-resized). The photo becomes the app badge and a backdrop on the Dashboard.

## Run it
Just open `index.html` in any browser (double-click works — no server needed).

Or serve locally:
```bash
python3 -m http.server 8777
# then visit http://localhost:8777
```

## Deploy (static hosting)
Works as-is on Render (Static Site), Netlify, Vercel, or GitHub Pages — publish this folder, no build command.
- **Render:** New → Static Site → Publish directory: `.` (root), Build command: *(leave empty)*.

## Notes on the data
The maintenance schedule uses **official Mazda 3 SkyActiv intervals adjusted for Saudi "severe" (Jeddah) conditions** (heat/dust/city driving). Engine oil is **5W-30 (API SP / ILSAC GF-6A)** — the grade specified in the GCC owner's manual for high ambient temperatures — changed every **7,500 km / 6 months**. Other intervals follow the "Except Europe" schedule and the local 5-year Jeddah plan: coolant (Mazda FL22) every 5 years, spark plugs at 120,000 km / 6 years, ATF-FZ every 60–80k km. Every number — intervals, last-service points, costs, parts, prices, stores — can be edited from within the app. Odometer defaults to 316,000 km.

To reset everything to the seed data, clear the site's local storage (browser dev tools → Application → Local Storage → delete `garage.mazda3.v1`).
