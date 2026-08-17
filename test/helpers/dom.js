'use strict';
const { parseHTML } = require('linkedom');

const SHELL = `<!doctype html><html lang="en"><body>
  <div id="app" class="app-shell">
    <header class="topbar">
      <button class="topbar-car" id="openProfile">
        <div class="car-badge" id="carBadge">M3</div>
        <div class="car-meta"><h1 id="carTitle">Mazda 3</h1><p id="carSub">sub</p></div>
      </button>
      <div class="topbar-actions">
        <button class="icon-btn" id="garageBtn"></button>
        <button class="icon-btn" id="settingsBtn"></button>
        <button class="icon-btn" id="themeToggle"></button>
      </div>
    </header>
    <main id="view" class="view"></main>
    <nav class="tabbar" id="tabbar">
      <button class="tab is-active" data-route="dashboard"><span>Dashboard</span></button>
      <button class="tab" data-route="maintenance"><span>Maintenance</span></button>
      <button class="tab" data-route="parts"><span>Parts</span></button>
      <button class="tab" data-route="fuel"><span>Fuel</span></button>
      <button class="tab" data-route="budget"><span>Budget</span></button>
      <button class="tab" data-route="reports"><span>Reports</span></button>
    </nav>
  </div>
  <div class="modal-host" id="modalHost" hidden>
    <div class="modal-backdrop" data-close></div>
    <div class="modal-card" id="modalCard"></div>
  </div>
  <div class="toast-host" id="toastHost"></div>
</body></html>`;

function makeLocalStorage() {
  const map = new Map();
  return {
    getItem: k => (map.has(String(k)) ? map.get(String(k)) : null),
    setItem: (k, v) => { map.set(String(k), String(v)); },
    removeItem: k => { map.delete(String(k)); },
    clear: () => map.clear(),
    key: i => [...map.keys()][i] ?? null,
    get length() { return map.size; }
  };
}

const INSTALLED = ['document', 'window', 'self', 'navigator', 'localStorage', 'matchMedia'];

// Node 21+ defines `navigator` (and, depending on flags, other globals) as a
// getter-only accessor property on globalThis, so a plain `globalThis.x = ...`
// throws. Route every install through defineProperty so it always succeeds.
function setGlobal(key, value) {
  Object.defineProperty(globalThis, key, {
    value,
    configurable: true,
    writable: true,
    enumerable: true
  });
}

function setupDom(html) {
  const { window, document } = parseHTML(html || SHELL);

  // linkedom supplies neither of these, and app.js uses both at boot.
  const matchMedia = q => ({ matches: false, media: String(q), addEventListener() {}, removeEventListener() {} });
  const localStorage = makeLocalStorage();

  let urlSeq = 0;
  const createObjectURL = () => `blob:test/${++urlSeq}`;
  const revokeObjectURL = () => {};

  Object.assign(window, { matchMedia, localStorage });
  setGlobal('document', document);
  setGlobal('window', window);
  setGlobal('self', window);
  setGlobal('navigator', { userAgent: 'node' });   // no serviceWorker key: app.js's guard skips registration
  setGlobal('localStorage', localStorage);
  setGlobal('matchMedia', matchMedia);

  if (!globalThis.URL.createObjectURL) {
    globalThis.URL.createObjectURL = createObjectURL;
    globalThis.URL.revokeObjectURL = revokeObjectURL;
  }

  function cleanup() {
    INSTALLED.forEach(k => { delete globalThis[k]; });
    delete globalThis.URL.createObjectURL;
    delete globalThis.URL.revokeObjectURL;
  }

  return { window, document, cleanup };
}

module.exports = { setupDom, SHELL };
