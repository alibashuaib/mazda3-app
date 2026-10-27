# Mazda3 BM/BN framing review — 2026-10-27

**Framing needs correction.** The installed revision 198 set is consistent across paints but oversized against the shared framing. All eight paints clip horizontally at a 320px viewport. This is an audit only; installed images, dashboard code and cache remain unchanged.

## System Guardrails

1. **High priority — narrow-screen clipping:** at 320px the car card is 288px wide while the visible car spans 305.09–305.91px. Its silhouette extends 8.55–8.95px beyond the left edge and 8.55–9.16px beyond the right edge. All eight paints are affected in both themes: 16 of the 48 checked states.
2. **Shared scale mismatch:** the source width is 1502–1506px, versus the retained 1360px target. BM is 10.4–10.7% wider than the BP/Mazda6 references at the same viewport. A correction would reduce the current car size by about 9.6%.
3. **Baseline too low:** source tire baselines are y911–914 versus y825. In the app, BM sits 17.47–18.08px lower at 320/1440px and 19.93–20.63px lower at 390px than the reference cars.
4. **Tight margins:** source left/right clearance is only about 1% of canvas width. At 390px and desktop sizes the car fits, but side clearance is about 4–5px. The shared source target supplies roughly 5.6–5.9% horizontal margins; phone card cropping still needs browser verification after any repair.
5. **Minor paint-to-paint drift:** source width varies by 4px, roof y125–132 and baseline y911–914. In the checked app states, width drift stays under 1px, roof drift under 1.7px and baseline drift under 0.7px. Both wheel-surrounding landmarks remain within 1px of Meteor Gray in either direction. Internal alignment is a smaller issue than the overall scale.

48 actual color-picker selections passed: eight paints × 320/390/1440px × light/dark. Stored selected color and served asset bytes were checked; no page errors occurred. Twelve additional BP/Mazda6 reference states supplied the scale and baseline comparison. Successful loading does not make the clipping acceptable.

| Viewport | Card width | BM visible width | Reference width | BM baseline | Reference baseline |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 320px | 288px | 305.09–305.91px | 276.25px | 186.05–186.66px | 168.58px |
| 390px | 358px | 348.12–349.05px | 315.21px | 197.48–198.17px | 177.54px |
| 1440px | 314px | 305.09–305.91px | 276.25px | 176.05–176.66px | 158.58px |

Baseline coordinates are relative to the top of the card. Measurements use alpha≥128 and the browser's actual `object-fit: cover` rendering. Source coordinates use right−left / bottom−top spans. This mobile/desktop audit does not assess TV navigation or typography.

## Structural Blueprint

```text
1536 × 1024 transparent source canvas
  shared left edge:       x90
  shared right edge:      x1450
  shared width:           1360px
  shared center:          x770
  shared tire baseline:   y825
  BM-specific roof:       approximately y120
  retained content:       revision 198 body, paint, glass, trim and both badges
```

The proposed roof comes from uniformly scaling the existing Meteor Gray silhouette, whose bounds are [16,131,1520,911]. Its current height is 780px; 780×1360/1504 ≈705px. Keeping that height places the roof at approximately y120 above the y825 baseline. This is a proposed BM master target, not an installed correction.

Normalize the existing cutouts with premultiplied-alpha resampling, then verify each paint against the BM master. Keep both repaired wheel emblems and all accepted model details. Do not regenerate the car or restore the rejected quarter-window edit 196. Verify wheel landmarks separately from outer bounds and retest all paints on narrow screens, including fallback framing.

Source measurements, hashes and wheel offsets: `source-measurements.json`. Browser results: `browser-measurements.json`. Full-car sheets: `contact-light.png` and `contact-dark.png`. App card captures: `studio-*` and `blue-reflex-*`. Some 320px card captures include the sticky header because of Playwright's scroll positioning; the numeric clipping finding concerns the card's left/right bounds, not an alleged roof crop.

## External Engine Prompts

Figma/Canva review-board prompt:

> Create a Mazda3 BM/BN sedan framing review board from the eight supplied revision 198 transparent cutouts. Use 1536×1024 frames on light gray and charcoal. Show current bounds beside proposed guides x90/x1450, center x770, baseline y825 and BM roof approximately y120. Include 288×210, 358×210 and 314×190 app-card examples; flag horizontal overflow in the current 288px card. Preserve body proportions, factory hardware, paint, glass, chrome and wheel emblems. Label the proposed frame as a preview. Apply no generative retouching or color filters.
