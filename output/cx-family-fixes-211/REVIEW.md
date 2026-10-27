# CX-family repairs — revision 211

Installed locally on 2026-10-27: eleven CX variants, all 88 catalog paints and five additional default/fallback images. Dashboard image URLs use `cx-family-fixes-211`; service-worker cache is `garage-v211`.

## System Guardrails

- All cutouts are 1536×1024 with true alpha. The alpha≥128 silhouette runs from x90 to x1450 (1360px coordinate span), centered at x770, with tire baseline y825. Each model keeps its own master height.
- Both wheel emblems were repaired with the retained generated Mazda donor. Independent pixel comparisons confirm unchanged alpha and exact preservation outside the cap masks relative to the registered image. Reframing/registration changes the wider image, so outside-mask preservation does **not** describe the entire change from the old installed asset.
- All 88 lossless WebPs decode to the exact working PNG RGBA. Measured wheel-surrounding registration residuals are at most 1px in either direction. Matching wheel landmarks does not certify every internal body detail.
- Blue Reflex on KE was moved toward muted steel blue-gray; selected Deep Crystal Blue variants toward dark navy; CX-50 Ingot Blue was revised. CX-80, CX-90 and third-generation CX-5 use the staged model-specific cleaned masters and derived paints. Other paints retain their existing body/finish sources before registration and cap repair.
- The old CX-80/CX-90 CSS transforms were removed because the new source images carry the alignment. Generic fallback images also use their model's normalized master.
- Paint colors remain visual approximations. No calibrated factory-color certification is claimed. Existing accepted gloss, material separation and model hardware remain the working references.

Validation: **434 unit tests, 352 actual picker checks, and 24 browser framing cases passed**. The picker checks cover 88 paints × 390/1440px × light/dark, verify selected session color and served bytes, and check source geometry and equal image rectangles across models. Framing cases cover CX-80/CX-90 at 320/390/1440px in light/dark over both file and HTTP, including fallback behavior and visibility checks on all model defaults. Browser checks use Chromium. No page errors were reported. This change does not alter storage behavior or add a reload-persistence test.

Evidence: `unit-tests.log`, `picker-tests.log`, `framing-tests.log`, `verification.json`, `manifest.json`, and `installed.json`.

## Structural Blueprint

```text
Review board (index.html)
  model selector
  full car / wheel caps
  light / dark backdrop
  per-paint labels and source bounds
Evidence
  before/                    original installed WebPs
  inputs/                    decoded original sources
  sources.json               selected project-local generated sources
  generated-sources.json     original generation locations
  prompts.json               prior session prompt records
  resumed-generations-complete.json  seven resumed edits and prompts
  <model>/manifest.json       per-paint registration and badge evidence
  <model>/contact-*.png       comparison sheets
  <model>/caps-*.png          before/after badge close-ups
```

| Model | Paints | Master roof y |
| --- | ---: | ---: |
| CX-30 DM | 9 | 161 |
| CX-5 KE | 10 | 102 |
| CX-5 KF | 10 | 107 |
| CX-5 third generation | 6 | 106 |
| CX-9 TB | 7 | 150 |
| CX-9 TC | 8 | 177 |
| CX-50 | 8 | 146 |
| CX-60 | 8 | 184 |
| CX-70 | 6 | 171 |
| CX-80 | 8 | 216 |
| CX-90 | 8 | 178 |

`process.cjs --model=<id>` regenerates registration/cap repair from staged sources. `install.cjs` independently verifies all staged PNGs and retained roundtrips; `--install` additionally copies verified WebPs and records installed hashes. `verify-picker.cjs` requires the local preview server at port 4173. `init.cjs` now preserves an existing `sources.json` when resuming a set.

## External Engine Prompts

Figma/Canva review prompt:

> Create a Mazda CX-family asset review board grouped by exact model generation. Use identical 3:2 image frames on light gray and charcoal. Label every paint. Mark source guides x90, x1450 and baseline y825 while preserving each model's master roof height. Include near/far wheel emblem close-ups and before/after comparisons. Use the supplied pixels without filters, recoloring, or decorative effects. Keep all labels and controls inside a 5% board margin.

The actual image-edit prompts and source files are retained in the JSON records above.
