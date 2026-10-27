# Mazda car asset editing guide

Latest installed BM work: revision 213, `output/mazda3bm-framing-fix-213/REVIEW.md`. All eight Mazda3 BM/BN paints retain revision 198 artwork and badges with normalized bounds [90,120,1450,825]. URL suffix `mazda3bm-framing-213`; current cache `garage-v213`. 434 unit tests and 48 actual picker states passed, with matching reference width/center/baseline and no material clipping at 320/390/1440px in either theme. Audit 212 is superseded by this correction.

Latest installed CX work: revision 211, `output/cx-family-fixes-211/REVIEW.md` and `index.html`. All eleven remaining variants and all 88 paints now use normalized cutouts and repaired wheel emblems. Installed URLs use `cx-family-fixes-211`; service-worker cache at that revision was `garage-v211`. Five additional default/fallback files use their model's normalized master. Audit 210 remains historical evidence, superseded by the installed repair manifests.

Retained project memory from Mazda2 through the CX family. Updated 2026-10-27 after revision 213. The requested remaining-CX pass is complete. Installed endpoints take precedence over historical experiments and prompts.

## Current approved references

| Model | Installed endpoint | Evidence directory and URL suffix |
| --- | --- | --- |
| Mazda2 DJ | Hue corrections, alignment and wheel logos209; eight paints. Gloss direction174 retained | `output/mazda2-paint-fixes-209/`; `mazda2-paint-fixes-209` |
| Mazda3 BM/BN sedan | No-antenna 195 + wheel logos 198 → framing 213; eight paints | `output/mazda3bm-framing-fix-213/`; `mazda3bm-framing-213` |
| Mazda3 BP sedan | Cleanup 200; eight paints | `output/mazda3bp-cleanup-200/`; `mazda3bp-cleanup-200` |
| Mazda6 GJ/GL | Cleanup 202 → scale 203 → alignment 204 → logos 205; nine paints | `output/mazda6-wheel-logo-205/`; `mazda6-wheel-logo-205` |
| CX-3 DK | Alignment + wheel logos 207; nine paints | `output/cx3-alignment-logos-207/`; `cx3-alignment-logos-207` |
| CX-30, CX-5 KE/KF/gen3, CX-9 TB/TC, CX-50/60/70/80/90 | Shared width/baseline, wheel emblems and selected paint/master corrections 211; 88 paints | `output/cx-family-fixes-211/`; `cx-family-fixes-211` |

Current service-worker cache: `garage-v213`. Check live code before assigning a new revision. Each endpoint's manifest maps sources and installed assets; `before/` retains originals. Never substitute an older candidate simply because it has detailed prompts.

## System Guardrails

### Vehicle identity and approved details

- Preserve the exact generation, silhouette, proportions, viewpoint, wheel design, lamp optics, grille, glass and factory trim. Another model may supply finish direction, not hardware.
- Resolve uncertain black trim, lamps, chrome and underbody shapes using exact-model manufacturer or user photos. Dark pixels can be real housings or recesses.
- Keep authentic small independent tire deflectors. Do not join them with invented splitters, wings or long bumper extensions. Avoid heavy artificial black outlines.
- Current BM/BN approval has stock round fog lamps and no antenna. Earlier MY2018-reference slim-lamp edits are historical, not instructions to overwrite current hardware. Do not universally remove antennas from other cars.
- When the user approves the rest and requests a local fix, preserve everything outside that region. Use a generated donor and local composite for tiny badges; verify exact outside-mask preservation when claiming it.

### Reflections, paint and material finish

- Retain glossy clearcoat with broad continuous curved showroom reflections. Smooth abrupt wedges, doubled oval loops, stepped fields and jagged streaks without flattening paint or panel sculpture.
- Mirrors remain glossy curved domes with one coherent reflected band; avoid flat fills, doubled stripes and ghosted edges.
- Keep glass, metal, rubber, black plastic, leather and paint distinct. Sharpen physical detail without halos, outlines, grain or fabricated lettering.
- Keep grille slats black with restrained highlights; preserve chrome perimeter and emblem without an added thick black border. Retain headlamp optics beneath natural lens reflections.
- Cover all painted surfaces: hood, roof, both A-pillars, mirror caps, handles, bumper corners, lower painted lips, doors and rear quarter. Protect glass, cabin, chrome, seals, grille, lamps, tires and wheels. Check far pillars and mirror bases for donor-gray paint.
- Deep Crystal Blue 42M is dark midnight navy; Blue Reflex 42B is muted steel blue-gray, not cobalt. Mazda2 Dynamic Blue 44J is a separate brighter paint.
- Mazda3 BP's user-described light blue is Polymetal Gray 47C: revision 200 approved deeper muted slate blue-gray rather than pale silver/baby blue. Mazda6 Blue Reflex was corrected from vivid blue toward subdued steel blue-gray in 202.
- Keep Snowflake White pearl white, Ceramic pale ceramic gray, Platinum Quartz restrained champagne beige and Titanium Flash muted bronze/brown-gray. Keep catalog reds and silvers distinct.
- Rendered paint is a visual approximation unless calibrated references support exact accuracy. Color names/codes alone do not establish exact RGB.

### Wheel-center emblems

- Correct Mazda mark: a silver closed oval around the symmetrical winged M on black. Swept wings meet the upper sides; the central tip dips down with black space underneath, without a stem joining the bottom oval.
- Reject spirals, P-shaped loops, numerals, Y/three-spoke symbols and squiggles. Inspect both wheel centers for every paint; full-car thumbnails are insufficient.
- Generate an enlarged correct donor with imagegen, then fit each cap's measured center, ellipse and perspective without touching lug nuts or spokes. Use area downsampling and a feathered cap boundary to avoid dotted/jagged tiny lines.
- Mazda3 BM/BN 198 and Mazda6 205 are targeted cap repairs. Mazda6's full-car generation in 202 did not produce correct marks; 205 supersedes those symbols. A prompt requesting the right logo does not prove the output has it.

### Transparency, scale and position

- Keep true alpha PNG working files and lossless WebPs. Current sets use 1536×1024. Preserve complete unclipped cars, clean antialiased silhouettes, no stray pixels or colored fringe. Inspect light and dark backgrounds, especially roof, far pillar, mirrors, bumper tips and underside.
- Inspect alpha directly: viewers sometimes show hidden transparent RGB as a false glow/backdrop. Alpha-zero RGB does not create a visible background. Do not regenerate based solely on such a preview.
- Normalize from retained generated sources using premultiplied-alpha interpolation, avoiding repeated resampling and fringe.
- Approved Mazda3 BP framing: alpha ≥128 silhouette x90–1450; width 1360px, horizontal center x770, tire baseline y825.
- Mazda6 matches that width/center/baseline and has master roof y157, height 668px. All nine variants have bounds `[90,157,1450,825]`; revision 205 preserves the entire alpha channel.
- Width/baseline alone are insufficient: Mazda6 203 still had nine pixels of roof-height drift; 204 aligned height/top too. Correct small generation drift to the same model's master. Do not force SUVs or other models to Mazda6's height.
- Check wheel centers and other landmarks as well as bounds: identical rectangles do not prove identical internal geometry. Use the actual color picker on mobile/desktop and light/dark; image/card rectangles, dimensions, object-fit and transform must remain stable. Account for header wrapping or model transforms if movement appears.

## Retained history and rejected edits

### Mazda2

Platinum Quartz detail and door work (166–168) refined warm paint, softened shading across the shared vertical door gap and retained the narrow seam and bright sill edge. Revision 172 requested independent Platinum Quartz gloss without supplying Machine Gray as the reflection template. Revision 174 installed eight showroom paints, reduced lower-door oval patches and kept broad even glossy lighting. **Revision 175's further softening was explicitly rejected; 174 was restored.** Earlier individual Platinum candidates are not current assets.

### Mazda3 BM/BN

Showroom set 177 led to restoring small front-tire deflectors (178), removing added long lower-bumper extensions/heavy outlining (179), and MY2018-reference OEM lamp/underbody cleanup (180). Black grille and chrome/lens treatment followed (181). Paint, mirrors, upper-door and grille finishes were refined; navy and Blue Reflex color drift was detected and restored (182–183). Reflection experiments 184–187 explored local glare reduction, then natural continuous curved highlights; intermediate requests are not universal matte-finish preferences.

High-magnification audits 188–191 identified simplified materials, soft cabin/lamp detail, stepped chrome and malformed badges. Revision 193 approved cleaner photography, revised pose and stock round fog lamps. Sedan work followed in 194; antenna removal in 195. **The quarter-window chrome-notch attempt in 196 was abandoned after “ignore the edit”; 195 was restored. Do not reapply 196 or infer that either black notch should be removed.** Both wheel logos were then corrected across eight paints in 198.

### Mazda3 BP

Audit 199 identified jagged/fringed edges, soft cabin and distorted wheel marks. Cleanup 200 built a clean gray master and seven paints, refined glazing/cabin, repaired both badges, removed fringe and normalized width/center/baseline. Polymetal was corrected toward deeper muted slate blue-gray. Eight colors were checked in both themes and screen sizes; selection persistence was tested. Cap coordinates from before framing must be remapped after normalization.

### Mazda6

Audit 201 found stepped roof/hood reflections, rough edges, malformed badges and vivid Blue Reflex. Cleanup 202 created nine paints. A second background-removal candidate was unnecessary: the apparent glow was hidden transparent RGB. Scale 203 increased width from 1288 to 1360px (about 5.6%) and matched BP's center/baseline. Alignment 204 also removed roof-height drift.

[Mazda Canada's original 2014 gallery](https://en.media.mazda.ca/media-photos-mazda6-2014?l=100) confirmed dark headlamp internals, so they were retained. Reference photo/notes are in `output/mazda6-scale-203/`. A later wheel audit caught inaccurate generated symbols; targeted repair 205 corrected all eighteen caps with exact alpha/outside-mask preservation. The user approved the rest: retain those body, paint, reflections, trim and framing details.

## Structural Blueprint: workflow for the remaining cars

1. Read this guide, existing lessons, the model catalog and dashboard mappings. Record the live revision and preserve unrelated changes.
2. Audit every paint on light/dark backgrounds. Build full-car sheets and enlarged roof, pillar, mirror, glass, lamp, trim, underbody and both wheel-cap views. Record real defects instead of regenerating a good car automatically.
3. Resolve factory details from exact-model photos. Establish a clean model-specific master if broader work is needed; otherwise isolate the requested repair.
4. Use built-in imagegen for generation/retouching, preserving transparency. Stage selected outputs in the project. Retain prompts, source paths, manifests, originals and rejected candidates. Use a generated donor/local mask for tiny details.
5. Recolor only catalog paints, checking identity, coverage and protected materials. Compare against prior approved hues to detect drift.
6. Normalize all paints to the model master and appropriate app scale. Check bounds and landmarks: width, height, center, roof, wheel centers and baseline. Preserve body-style proportions.
7. Inspect every badge and edge; export lossless WebPs and decode to compare RGBA exactly. Verify outside-mask preservation for local edits.
8. Back up installed assets before replacement. Refresh only the relevant model URL suffix and advance the service-worker cache; update existing render expectations.
9. Run relevant tests and actual picker selections for every paint at mobile/desktop in light/dark. Assert stable rendered geometry, correct selected color/URL and HTTP bytes matching installed files. Test reload persistence when picker/storage behavior changes. Latest checkpoint: 434 unit tests and 36 actual Mazda6 picker checks passed.
10. Save report, sheets, close-ups, manifests, prompts and verification results. Update the endpoint table and add new lessons. Rejected edits remain rejected unless the user changes direction.

## External Engine Prompts

### Imagegen: master cleanup

> Retouch this exact [model/generation/year] cutout into crisp factory-stock product photography. Preserve viewpoint, silhouette, proportions, wheels, lamp optics, grille, chrome, glass and framing. Correct only [verified defects]. Keep broad continuous curved glossy highlights and distinct paint/glass/metal/rubber. Preserve real underbody parts and seams. No invented accessories, outlines or splitter. Full unclipped car on 1536×1024 transparent canvas; clean antialiased silhouette, no outside shadow/glow or fringe. Inspect both wheel badges independently.

### Imagegen: paint variant

> Recolor only painted surfaces of this approved [model] master to [name/code and restrained visual description]. Cover hood, roof, both A-pillars, mirrors, handles, bumpers/lips, doors and rear quarter consistently. Preserve geometry, framing, curved gloss, glass/cabin, lamps, chrome, black trim, tires, wheels and badges. True transparent background, no new objects/text. Keep distinct from [similar adjacent paint].

### Imagegen: wheel-center donor

> Replace only the incorrect cap symbol in this enlarged target crop with the reference Mazda emblem: silver closed oval enclosing the symmetrical swept winged M on black, wings meeting upper sides, central tip dipping down with black space below and no stem to the lower oval. Preserve cap size, center, tilted ellipse, lug nuts, spokes, lighting and crop. No spiral, P/Y, numeral or text. Fit the generated donor locally and verify every pixel outside the cap regions remains unchanged.

### Figma/Canva: review board

> Create an asset QA board for [model/generation], one labeled tile per catalog paint. Use identical 3:2 frames with light gray/charcoal backgrounds. Align car width, center, master roof and tire baseline with shared guides. Add close-ups of both wheel badges, roof/A-pillars, mirrors, lamp housings, chrome and underbody. Show before/after only for edited regions. Preserve source proportions/transparency; no filters or decorative highlights.

### CX-3 DK — revision 207

Nine paints aligned to bounds [90,200,1450,825], preserving CX-3 master proportions. Wheel landmarks required independent checking: outer bounds alone left Soul Red front wheel14px off. Smooth registration from original pixels brought both wheel surroundings within1px of master. All18 badges corrected with generated donor and exact alpha/outside-cap preservation relative to registered images. Paint/hardware/reflections retained. Lossless WebP verified;434 unit tests and36 actual picker checks passed. Endpoint: output/cx3-alignment-logos-207, suffix cx3-alignment-logos-207; cache garage-v207. Next model: CX-30.

### CX-3 Dynamic Blue Mica verification

Official 2016 Mazda specification deck confirms44J. Mazda vehicle brochure PDF page18 shows vivid blue/cyan highlights distinct from42M navy. Current207 asset is a plausible visual match; retained after both-theme asset/served-byte checks. No calibrated exact match claimed. References and rendered factory swatch: output/cx3-dynamic-blue-verification/README.md.

### Mazda2 all-color audit208 (no installation)

32 actual picker checks passed. Official Mazda UK2022 brochure swatches/page8 vehicle renderings show42M darker navy than current174 cobalt appearance. Dynamic44J plausible; Ceramic warmer/off-white than neutral factory swatch; Platinum Quartz warmer than brochure but user-approved champagne direction remains authoritative. Both wheel badges malformed (near Y-stem, far P/loop); framing width1466–1471/baseline897–898 predates shared1360/825 convention. Preserve174 gloss and rejected175 status. Evidence: output/mazda2-paint-audit-208/REVIEW.md. Endpoint unchanged; audit is not a new approved asset set.

### Mazda2 repairs209 — supersedes audit208 findings

User authorized all flagged repairs. Built-in imagegen corrected42M to dark navy,47A to neutral ceramic gray and47S to muted champagne greige without reapplying rejected175 reflection softening. Other five hue sources retained. All16 wheel badges repaired; exact outside-cap/alpha preservation relative to registered images. Shared bounds [90,152,1450,825], wheel surroundings within1px of gray master, lossless exports.434 unit tests and32 actual picker checks passed. Endpoint output/mazda2-paint-fixes-209; suffix mazda2-paint-fixes-209; cache garage-v209. Paints remain visual approximations.
