# Car asset direction retained from Mazda 2

Mazda3 BM/BN framing correction 213 is installed for all eight paints. Revision 198 artwork/badges retained; bounds [90,120,1450,825], 1360px width, x770 center and y825 baseline. Wheel-surrounding residuals <=1px; premultiplied-alpha resampling and exact lossless WebP exports. The old ~9px side clipping at 320px is corrected. 434 unit tests and 48 actual picker states passed across 320/390/1440px and both themes, matching BP reference width/center/baseline. URL suffix mazda3bm-framing-213; cache garage-v213. Evidence and backups: output/mazda3bm-framing-fix-213/. Audit 212 is historical. No generation or paint edits were performed.

CX-family repairs 211 are installed for all 11 variants/88 paints plus 5 additional default/fallback files. Every set has x90–1450 bounds and y825 tire baseline, with model-specific roof height and <=1px measured wheel-surrounding residuals. Both caps use the retained generated donor; exact alpha and outside-cap preservation apply relative to registered images. Lossless WebP RGBA verified. Selected blues corrected; CX-80/CX-90/gen3 CX-5 derived from cleaned model masters. Old CX-80/90 CSS transforms removed. Cache garage-v211; image suffix cx-family-fixes-211. 434 unit tests, 352 picker checks and 24 browser framing cases passed. Review board, source manifests, backups and evidence: output/cx-family-fixes-211/. The requested CX pass is complete. Colors remain visual approximations.

Read the consolidated [car asset guide](../docs/CAR-ASSET-GUIDE.md) before continuing car image work. It records the Mazda2 through Mazda6 history, approved endpoints, rejected edits, paint/trim/badge rules, alignment targets and checks through revision 205. Its current endpoint table takes precedence over the historical notes below.

- Use Mazda 2 revision 174 (`mazda2-showroom-color-set`) as the approved showroom gloss reference. Revision 175's further softening was explicitly rejected and reverted. Preserve visible gloss and curved highlights rather than flattening the paint.
- Establish one clean model-specific master before recoloring. References from another model supply finish direction only; preserve the target model's silhouette, wheels, lighting hardware, grille and trim.
- Remove duplicated oval reflection loops and abrupt shadow wedges with targeted edits. Keep natural panel sculpture, body seams and smooth transitions.
- Check complete paint coverage: roof, near/far A-pillars, mirror caps, door handles, bumper corners, lower lips and rear quarter. Protect glass, chrome and black trim.
- Inspect clean antialiased alpha edges on both light and dark backgrounds. Check roof, far pillar, underside and bumper tips for fringe, detached pixels and jagged outlines.
- Keep paint identities distinct; avoid inheriting an inaccurate old hue. Describe uncertain factory colors as approximations unless supported by calibrated references.
- Preserve generated transparency, stage every final in the project, convert losslessly, verify decoded pixels and served bytes, and retain backups. Refresh relevant asset URLs and service-worker cache when installing or reverting.

Completed next model: Mazda 3 BM/BN, revision 177 (`mazda3bm-showroom-177`).

- Preserve factory underbody details during reflection cleanup: small matte-black air deflectors ahead of both front tires must remain visible. Restored Mazda 3 BM/BN in revision 178 (`mazda3bm-deflectors-178`).

- Keep front tire deflectors as small separate tabs; avoid adding a long bumper extension or splitter to connect them. Keep front fascia shading natural, without heavy black outline strokes. Mazda 3 BM/BN bumper cleanup: revision 179.

- For Mazda 3 OEM underbody and lamp trim, use the user-supplied MY2018 reference saved under mazda3bm-oem-cleanup-180/reference.webp. Remove projecting horizontal ledges at both front/rear sill ends; use slim lower-light recesses and subtle trim edges. Do not mistake shadow for an added body kit. Revision 180.

- Mazda 3 upper grille slats should read black plastic, with restrained soft highlights. Keep chrome at emblem and perimeter only. Avoid a separate thick black border outside the chrome surround; smooth headlight cover reflections while retaining optical hardware. Revision 181.

- Mazda 3 BM/BN reflection direction: match the broad, continuous curved highlights on the body. Mirror caps must retain a glossy dome with one clean reflected band; avoid flat fills or ghosted double stripes. Smooth grille trim and slat reflections along their actual curves, preserving the emblem, seams, and original transparency. Revision 187 (`mazda3bm-continuous-reflections-187`).

### CX-3 DK — revision 207

Nine paints aligned to bounds [90,200,1450,825], preserving CX-3 master proportions. Wheel landmarks required independent checking: outer bounds alone left Soul Red front wheel14px off. Smooth registration from original pixels brought both wheel surroundings within1px of master. All18 badges corrected with generated donor and exact alpha/outside-cap preservation relative to registered images. Paint/hardware/reflections retained. Lossless WebP verified;434 unit tests and36 actual picker checks passed. Endpoint: output/cx3-alignment-logos-207, suffix cx3-alignment-logos-207; cache garage-v207. Next model: CX-30.

### Mazda2 repairs209 — supersedes audit208 findings

User authorized all flagged repairs. Built-in imagegen corrected42M to dark navy,47A to neutral ceramic gray and47S to muted champagne greige without reapplying rejected175 reflection softening. Other five hue sources retained. All16 wheel badges repaired; exact outside-cap/alpha preservation relative to registered images. Shared bounds [90,152,1450,825], wheel surroundings within1px of gray master, lossless exports.434 unit tests and32 actual picker checks passed. Endpoint output/mazda2-paint-fixes-209; suffix mazda2-paint-fixes-209; cache garage-v209. Paints remain visual approximations.
