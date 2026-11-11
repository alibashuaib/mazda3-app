---
status: complete
---
# Summary 261108-05r

- account.js: two local-only sign-out call sites now pass `{ scope: 'local' }` (vendored supabase-js 2.58.0 supports it).
- test/account.test.js: failed sign-in test asserts scope 'local'.
- sw.js cache regenerated. Unit 962/962.
- Commit: 0f2dff7
