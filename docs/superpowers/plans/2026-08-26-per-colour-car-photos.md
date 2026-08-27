# Per-colour car photos — replacing the CSS tint with real photography

**Goal:** every model gets the same treatment `mazda3bm` already has — a
distinct, real photo per paint colour — instead of one generic photo pushed
through a `paintFilterClass` CSS tint. The tint (added in
`feat: add color-aware 3D car hero` / the "make every model's colour choice
show up" fix) is a *fallback*, not the end state; this doc tracks closing
the gap colour by colour, model by model.

**Status:** scaffolding is in place (`CAR_COLOR_PHOTOS` manifest,
`colorSlug()`, `hasExactColorPhoto()` in `src/pages/dashboard.js`). Zero new
photos have been supplied yet — every model but `mazda3bm` still renders via
the tint.

## How it works today

`studioCarImage(color, car)` in `src/pages/dashboard.js` checks, in order:

1. `CAR_COLOR_PHOTOS[modelId][colorSlug(color)]` — a real photo for this
   exact paint, if one has been added to the manifest. No tint is applied
   (`hasExactColorPhoto()` returns true, `renderDashboard` skips the
   `paint-*` class).
2. `GENERIC_MODEL_IMAGE[modelId]` — the model's one reference photo, tinted
   via `paintFilterClass(swatchFor(color))` (a real hue/sat/lightness bucket
   derived from the paint's verified hex in `MAZDA_PAINTS`, not the colour's
   name text).
3. `mazda3bm`'s legacy untinted fallback (`assets/mazda3-studio.png`), or
   `''` if the model has no image at all.

## Adding a real photo

1. Name the file `assets/<modelId>-<colorSlug>.png` (see the full list
   below for every `modelId`/`colorSlug` pair the catalogue currently
   needs). `colorSlug()` strips the `(Code XXXX)` suffix, lowercases, and
   hyphenates — e.g. `Soul Red Crystal Metallic (Code 46V)` →
   `soul-red-crystal-metallic`.
2. Drop the file in `assets/`.
3. Add one line to `CAR_COLOR_PHOTOS[modelId]` in `src/pages/dashboard.js`
   mapping the colour's exact catalogue name (or its slug — either works,
   see `hasExactColorPhoto`) to the new path.
4. Add the file to `sw.js`'s `ASSETS` precache list so it works offline.
5. `npm test` (300 tests must still pass — none of them assert on car
   photos, but a stray syntax error would fail the suite) and eyeball it in
   the browser (change `session.current().car.color` and re-render, or use
   the settings page's colour picker).

No manifest entry, no code change beyond that one line — the fallback tint
keeps working for every colour not yet covered.

## Full asset list still needed (as of 2026-08-26)

`mazda2`, `mazda3bm`, `mazda6`, `cx3`, `cx5ke`, and `cx9tb` are complete.
Every other model is fully outstanding. `[m.id]-[colorSlug]` → source catalogue colour, generated
from `CAR_MODELS` in `src/data/catalog.js`:

### mazda3bm (complete — 8/8)

### mazda2 (complete — 8/8)
soul-red-crystal-metallic, snowflake-white-pearl-mica, jet-black-mica,
deep-crystal-blue-mica, dynamic-blue-mica, machine-gray-metallic,
ceramic-metallic, platinum-quartz-metallic

### mazda3bp (8)
machine-gray-metallic, soul-red-crystal-metallic, snowflake-white-pearl-mica,
jet-black-mica, deep-crystal-blue-mica, polymetal-gray-metallic,
platinum-quartz-metallic, ceramic-metallic

### mazda6 (complete — 9/9)
machine-gray-metallic, soul-red-metallic, soul-red-crystal-metallic,
snowflake-white-pearl-mica, jet-black-mica, deep-crystal-blue-mica,
blue-reflex-mica, sonic-silver-metallic, titanium-flash-mica

### cx3 (complete — 9/9)
machine-gray-metallic, soul-red-crystal-metallic, snowflake-white-pearl-mica,
jet-black-mica, deep-crystal-blue-mica, dynamic-blue-mica, ceramic-metallic,
titanium-flash-mica, polymetal-gray-metallic

### cx30 (9)
machine-gray-metallic, soul-red-crystal-metallic, snowflake-white-pearl-mica,
jet-black-mica, deep-crystal-blue-mica, polymetal-gray-metallic,
platinum-quartz-metallic, ceramic-metallic, aero-gray-metallic

### cx5ke (complete — 10/10)
meteor-gray-mica, soul-red-metallic, crystal-white-pearl-mica,
jet-black-mica, blue-reflex-mica, sky-blue-mica, stormy-blue-mica,
liquid-silver-metallic, metropolitan-gray-mica, zeal-red-mica

### cx5kf (10)
machine-gray-metallic, soul-red-crystal-metallic, snowflake-white-pearl-mica,
rhodium-white-premium, jet-black-mica, deep-crystal-blue-mica,
eternal-blue-mica, sonic-silver-metallic, polymetal-gray-metallic,
zircon-sand-metallic

### cx5gen3 (6)
navy-blue-mica, soul-red-crystal-metallic, rhodium-white-premium,
machine-gray-metallic, jet-black-mica, aero-gray-metallic

### cx9tb (complete — 7/7)
dolphin-gray-mica, brilliant-black-clearcoat, crystal-white-pearl-mica,
copper-red-mica, liquid-silver-metallic, metropolitan-gray-mica,
stormy-blue-mica

### cx9 (8)
machine-gray-metallic, soul-red-crystal-metallic, snowflake-white-pearl-mica,
jet-black-mica, deep-crystal-blue-mica, sonic-silver-metallic,
titanium-flash-mica, polymetal-gray-metallic

### cx50 (8)
machine-gray-metallic, soul-red-crystal-metallic, wind-chill-pearl,
jet-black-mica, ingot-blue-metallic, polymetal-gray-metallic,
zircon-sand-metallic, cypress

### cx60 (8)
machine-gray-metallic, soul-red-crystal-metallic, rhodium-white-premium,
jet-black-mica, deep-crystal-blue-mica, platinum-quartz-metallic,
sonic-silver-metallic, artisan-red-premium

### cx70 (6)
melting-copper-metallic, soul-red-crystal-metallic, rhodium-white-premium,
jet-black-mica, polymetal-gray-metallic, zircon-sand-metallic

### cx80 (8)
artisan-red-premium, soul-red-crystal-metallic, rhodium-white-premium,
machine-gray-metallic, jet-black-mica, deep-crystal-blue-mica,
platinum-quartz-metallic, melting-copper-metallic

### cx90 (8)
artisan-red-premium, soul-red-crystal-metallic, rhodium-white-premium,
machine-gray-metallic, jet-black-mica, deep-crystal-blue-mica,
platinum-quartz-metallic, polymetal-gray-metallic

**Total: 122 photos** (1 + 121) across 16 models to fully retire the tint.
Colours repeat heavily across models (e.g. "Jet Black Mica" appears for
almost every model) — nothing requires all 122 to land before any of them
go live; each manifest line is independent and ships the moment its file
exists.

## Non-goals

- No change to the tint fallback's quality — it stays as-is for any
  colour without a real photo.
- No automatic file-discovery (e.g. probing `assets/<slug>.png` via
  `<img onerror>`) — an explicit manifest line was chosen so a missing or
  misnamed file fails loudly in review, not as a silent 404 in production.
