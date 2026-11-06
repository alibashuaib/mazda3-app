# vendor/

Third-party code committed to the repo rather than installed.

The app has no build step and must run from `file://`, so it cannot use a
bundler or `<script type="module">`. A CDN `import()` would keep this
directory empty, but a cross-origin module cannot be cached by the service
worker the way a same-origin script can — and a signed-in user opening the
app offline is the case this app is built for.

## supabase.js

- **Package:** `@supabase/supabase-js`
- **Version:** 2.58.0
- **SHA-256:** `3ae8cfec4a4715f4e67aa45fe4e7c1a40d67787629c7f10e32afd7dd836edf4e`
- **Bytes:** 136992
- **Source:** https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.58.0/dist/umd/supabase.js
- **Publishes:** `window.supabase`
- **Added:** 2026-08-20, Phase 4a

`vendor/pins.json` and this README must change together; `test/vendor-pin.test.js` enforces it.

Updating is a deliberate decision, not a routine one: re-fetch the pinned URL
with a new version, re-run `npm test` and `npm run test:e2e`, and update this
file. Never loaded by the Node test suite — `account.js` takes its client
through `configure({ client })`.
