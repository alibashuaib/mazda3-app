/* ============================================================
   Garage — a dependency-free static server for the e2e run.

   Exists so the browser suite can visit the app over http as well as
   file://. That matters: storage.js refuses IndexedDB on an opaque
   origin (shouldTryIndexedDb returns false for file:), so a file://-only
   run exercises the localStorage backend and nothing else. Serving the
   same files over http is the only way the IndexedDB path is ever
   executed by a test.

   Node's http and fs only — the project ships no runtime dependencies
   and adds none for tests it can write itself.
   ============================================================ */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 4173);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const rel = url === '/' ? 'index.html' : url.replace(/^\/+/, '');

  // Refuse anything that escapes the project root.
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }

  fs.readFile(file, (err, body) => {
    if (err) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(body);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`static server on http://127.0.0.1:${PORT}`);
});
