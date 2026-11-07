---
quick_id: 261107-w9p
status: complete
---
# Summary

- `DEALER_PRICE` in `src/data/catalog.js` covers mazda3bm, mazda3bp, mazda6, cx9tb (3.7L), cx30, cx60, cx90; applied only where the OEM option has no part number.
- B6Y1-14-302A source label changed to `KSA` with its own note; test/catalog.test.js updated.
- Arabic strings added; sw.js CACHE regenerated. 961/961 tests pass.
- Left unchanged: coolant, CX-30/CX-90 belts, cx5gen3/cx50/cx70/cx80 (no dealer page), CX-9 TB 3.5L plug.
- Assumption: one dealer page applied to all engines of a model.
