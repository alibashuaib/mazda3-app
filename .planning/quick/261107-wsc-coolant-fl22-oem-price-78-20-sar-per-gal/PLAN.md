---
quick_id: 261107-wsc
description: Coolant FL22 OEM price 78.20 SAR per gallon from dealer
---

Set the Mazda Genuine FL22 option in `coolantPart` to 78.2 (per 1 gal, Mazda KSA dealer list), add the per-gallon note with Arabic pattern in `src/i18n/lang.js`, and make `normalizeData` rebuild saved coolant parts whose OEM price is still the old 130.
