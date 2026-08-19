/* ============================================================
   Garage — browser smoke tests.

   The Node suite runs against linkedom, which is fast and covers the
   modules well, but it is not a browser: it does not reproduce the real
   HTML parser, and it cannot load the app the way a user does. This
   config runs the same checks in Chromium twice.

     file  — index.html opened straight from disk. Running from a
             double-click is a documented feature of this app and the
             reason every module uses a script tag rather than an ES
             module; nothing else verifies that ten scripts still load in
             dependency order from an opaque origin.

     http  — the same files over 127.0.0.1. storage.js refuses IndexedDB
             on file: (shouldTryIndexedDb), so this is the only run in
             which the IndexedDB backend executes at all.

   Kept out of `npm test` on purpose: unit tests must stay runnable
   without a 150 MB browser download. Use `npm run test:e2e`.
   ============================================================ */
'use strict';
const path = require('path');
const { pathToFileURL } = require('url');
const { defineConfig } = require('@playwright/test');

const FILE_URL = pathToFileURL(path.join(__dirname, 'index.html')).href;
const HTTP_URL = 'http://127.0.0.1:4173/index.html';

module.exports = defineConfig({
  testDir: './e2e',
  // A failure here means a real user-visible break; retrying would only
  // hide flakiness we would rather see.
  retries: 0,
  reporter: process.env.CI ? 'list' : 'line',
  timeout: 30000,
  expect: { timeout: 10000 },

  webServer: {
    command: 'node e2e/static-server.js',
    url: HTTP_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 20000
  },

  projects: [
    {
      name: 'file',
      metadata: { appUrl: FILE_URL, backend: 'localStorage' },
      use: {
        browserName: 'chromium',
        // Without this, Chromium treats each file:// document as its own
        // opaque origin and the app cannot read its own scripts' state.
        launchOptions: { args: ['--allow-file-access-from-files'] }
      }
    },
    {
      name: 'http',
      metadata: { appUrl: HTTP_URL, backend: 'indexeddb' },
      use: { browserName: 'chromium' }
    }
  ]
});
