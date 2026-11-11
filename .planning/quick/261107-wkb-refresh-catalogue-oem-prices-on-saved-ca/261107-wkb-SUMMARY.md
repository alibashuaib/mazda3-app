---
quick_id: 261107-wkb
status: complete
---
# Summary

- `src/data/catalog.js`: sharedParts stamps `catPrice` on OEM options.
- `src/data/normalize.js`: refresh step with LEGACY_OEM (prices from 26 catalog.js commits in git history).
- `test/normalize.test.js`: refresh, owner-edit kept, unknown legacy price kept, idempotent.
- 962/962 unit, e2e 43 passed / 1 skipped.
- Known limit: an owner who changed only brand/part no. but kept a catalogue price gets those fields refreshed.
