# Mazda3 BM/BN framing correction — revision 213

Installed on 2026-10-27 for all eight paints. The previous oversize framing and narrow-screen clipping are corrected. Dashboard URLs use `mazda3bm-framing-213`; the service-worker cache is `garage-v213`.

## System Guardrails

- All 1536×1024 cutouts now have alpha≥128 bounds **[90,120,1450,825]**: width 1360px, center x770, BM-specific roof y120 and tire baseline y825.
- Existing revision 198 artwork, paint, trim, glass and repaired emblems supply every pixel. No new image generation or recoloring was used. Premultiplied-alpha resampling normalizes framing in one pass from the backed-up installed files; small smooth registration corrections keep wheel-surrounding landmarks within 1px of the Meteor Gray master.
- Eight lossless WebPs decode to the exact final PNG RGBA. Original installed bytes are retained in `before/`, with SHA256 hashes in `manifest.json`.
- **434 unit tests and 48 actual picker checks passed.** The browser checks cover all eight paints at 320/390/1440px in light/dark. They verify selected color, served bytes, exact source bounds, stable per-paint edges, width/center/baseline matching the BP reference, and no material clipping using the existing browser-test tolerance of 0.15px. Twelve BP/Mazda6 reference states were also measured. No page errors occurred.
- The prior ~9px side overflow at 320px is removed. All paints share the same final bounds; subpixel rendering is handled by the tolerance above. Card widths can vary with scrollbar availability, so comparisons are made within the same browser run.

Evidence: `unit-tests.log`, `browser-tests.log`, `browser-measurements.json`, `manifest.json`, light/dark contact sheets, and `studio-*`/`blue-reflex-*` app screenshots.

## Structural Blueprint

```text
Original installed revision 198 cutouts (before/)
  → one-pass premultiplied-alpha normalization + wheel registration
  → 1536×1024 PNG, bounds [90,120,1450,825]
  → exact lossless WebP
  → existing app asset paths, version suffix mazda3bm-framing-213
```

`process.cjs` stages the eight images from retained backups; `--install` also copies the verified WebPs to their app paths. `verify.cjs` checks the app through the preview server on port 4173. The superseded audit remains in `../mazda3bm-framing-review-212/`.

## External Engine Prompts

Figma/Canva review prompt:

> Place the eight supplied Mazda3 BM/BN cutouts in identical 1536×1024 frames. Mark x90/x1450, center x770, roof y120 and baseline y825. Show light-gray and charcoal variants, plus 320px phone app examples. Preserve the supplied colors, proportions, body details and badges; use no generative retouching or filters.
