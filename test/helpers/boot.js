'use strict';
/* ============================================================
   Boot the shipped scripts, in index.html's order, under the DOM
   harness — so the tests exercise app.js itself rather than only the
   modules that were extracted out of it.

   app.js is a classic script that runs its boot block on load, so it
   cannot be require()d. It is evaluated instead.

   WHY A FRESH vm CONTEXT PER BOOT, rather than vm.runInThisContext:
   two verified reasons, both fatal to the shared-global approach.

   1. Top-level `const`/`let` in a script create bindings in the
      context's *global lexical scope*, which persists. app.js opens
      with `const save = ...`, so a second bootApp() in the same
      process throws "SyntaxError: Identifier 'save' has already been
      declared". Eleven tests need eleven boots.
   2. dom.js installs `self` as the linkedom window, which is NOT
      globalThis. Every module here is dual-mode and publishes with
      `root.session = api` / `Object.assign(root, api)` where
      `root = self`. Under runInThisContext that puts `session`,
      `Status`, `html`, `AR` and the catalog on the linkedom window
      object, where app.js's bare-name references cannot see them.

   A per-boot context fixes both: the context global IS `self`, exactly
   as in a browser where `self === window === globalThis`, so the
   namespaces land where bare names resolve; and each boot starts with
   an empty global lexical scope, so nothing collides.

   The rejected alternative was wrapping each script in an IIFE. That
   makes every top-level binding function-scoped, which would put
   `maintMode` and `reportType` permanently out of evalInApp's reach and
   silently defeat two of the tests.
   ============================================================ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { setupDom } = require('./dom.js');

const ROOT = path.join(__dirname, '..', '..');

/* Must stay in the same order as index.html's <script> tags. A mismatch here
   is itself a bug worth failing on — see the order assertion below. */
const SCRIPTS = [
  'src/core/helpers.js',
  'src/ui/html.js',
  'src/ui/modal.js',
  'src/ui/photo.js',
  'src/ui/chrome.js',
  'src/data/catalog.js',
  'src/i18n/strings.ar.js',
  'src/i18n/lang.js',
  'schedule.js',
  'storage.js',
  'src/data/normalize.js',
  'src/data/session.js',
  'src/data/status.js',
  'src/data/account.js',
  'ui.js',
  'src/pages/dashboard.js',
  'src/pages/maintenance.js',
  'app.js'
];

/* Guards against index.html and this list drifting apart.

   Matches any <script ...src="..."...></script> tag that names a local file
   (no scheme, so CDN/inline scripts are skipped) — tolerant of attribute
   order (src before or after defer/async/etc.), single or double quotes
   around the src value, and any other boolean/valued attribute on the tag.
   A single, unanchored `src=(["'])([^"']+)\1` capture inside a loosely
   bounded `<script ...>...<\/script>` match is enough: index.html's script
   tags are all one-line and self-closing pairs, so there is no risk of one
   tag's attributes bleeding into the next. */
function assertScriptOrderMatchesIndexHtml() {
  const htmlSrc = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const inHtml = [...htmlSrc.matchAll(/<script\b([^>]*)><\/script>/g)]
    .map(m => {
      const attrs = m[1];
      const srcMatch = attrs.match(/\bsrc=(["'])([^"']+)\1/);
      return srcMatch ? srcMatch[2] : null;
    })
    /* vendor/ is excluded deliberately. The real Supabase client is a large
       browser bundle that reaches for fetch and window internals the harness
       does not provide, and account.js never uses the global under Node — it
       takes its client through configure({ client }). Excluding it here keeps
       the order assertion meaningful for everything the tests DO run. */
    .filter(src => src != null && src.indexOf('vendor/') !== 0);
  if (inHtml.join(',') !== SCRIPTS.join(',')) {
    throw new Error(`test/helpers/boot.js SCRIPTS is out of sync with index.html.\n  index.html: ${inHtml.join(', ')}\n  boot.js:    ${SCRIPTS.join(', ')}`);
  }
}

/* Host builtins the scripts reach for. A fresh vm context supplies its own
   Object/Array/JSON/Math/Date/Promise/RegExp, so only the platform APIs that
   live outside the language core need forwarding. */
const HOST_GLOBALS = [
  'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'setImmediate', 'clearImmediate', 'queueMicrotask',
  'URL', 'URLSearchParams', 'Blob', 'File', 'FileReader',
  'TextEncoder', 'TextDecoder', 'atob', 'btoa', 'structuredClone',
  'performance', 'crypto', 'AbortController', 'Event', 'EventTarget'
];

function makeContext(dom, opts) {
  opts = opts || {};
  const context = vm.createContext({}, { name: 'garage-app' });
  const g = vm.runInContext('this', context);   // the context's global object

  HOST_GLOBALS.forEach(k => { if (globalThis[k] !== undefined) g[k] = globalThis[k]; });

  g.globalThis = g;
  g.self = g;              // browser truth: self === window === the global object
  g.window = dom.window;   // linkedom's window carries addEventListener et al
  g.document = dom.document;
  g.navigator = globalThis.navigator;
  g.localStorage = globalThis.localStorage;
  g.matchMedia = globalThis.matchMedia;

  /* Neither of these exists on linkedom's window, and both are read at boot:
     storage.js's openStorage() reads location.protocol to decide whether to
     even try IndexedDB, and go() calls window.scrollTo on every navigation.
     'file:' is the documented double-click-index.html case, and it selects the
     localStorage backend — deterministic, and no indexedDB stub required. */
  /* 'file:' is the documented double-click case and selects the localStorage
     backend. Tests that need account UI pass protocol: 'https:' — account.js's
     available() is false on file:// by design. */
  const proto = opts.protocol || 'file:';
  g.location = { protocol: proto, href: proto === 'file:' ? 'file:///index.html' : proto + '//localhost/index.html' };
  if (typeof dom.window.scrollTo !== 'function') dom.window.scrollTo = () => {};
  if (typeof dom.window.matchMedia !== 'function') dom.window.matchMedia = globalThis.matchMedia;

  /* index.html carries <meta name="theme-color">, and applyTheme() writes to it
     on every theme change. The harness shell is body-only, so add it — this
     mirrors the real document rather than papering over an app defect. */
  if (!dom.document.querySelector('meta[name=theme-color]')) {
    const meta = dom.document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    meta.setAttribute('content', '#0f1013');
    (dom.document.head || dom.document.documentElement).appendChild(meta);
  }

  patchSelectValueSetter(dom);

  /* vendor/supabase.js is excluded from the harness (see SCRIPTS), so the
     boot block's client construction is unreachable under Node without a
     stand-in. Tests that need a signed-in-capable boot pass one. */
  if (opts.supabaseStub) g.supabase = opts.supabaseStub;

  return { context, g };
}

/* linkedom defines HTMLSelectElement.prototype.value as a getter with no
   setter, so `select.value = x` throws "Cannot set property value ... which has
   only a getter". Browsers make it settable, and app.js relies on that in
   openLogConfirm (app.js:554) and openAddVehicle — both of which were
   consequently impossible to render under test. This restores the standard
   behaviour rather than working around it in the app: assigning selects the
   first matching option, and a value that matches nothing clears the
   selection, exactly as the HTML spec requires. */
function patchSelectValueSetter(dom) {
  const proto = dom.window.HTMLSelectElement && dom.window.HTMLSelectElement.prototype;
  if (!proto) return;
  const desc = Object.getOwnPropertyDescriptor(proto, 'value');
  if (!desc || !desc.get || desc.set) return;   // already settable, or absent
  Object.defineProperty(proto, 'value', {
    configurable: true,
    get: desc.get,
    set(v) {
      const wanted = String(v);
      const options = [...this.querySelectorAll('option')];
      const match = options.find(o => (o.hasAttribute('value') ? o.getAttribute('value') : o.textContent) === wanted);
      options.forEach(o => { o.selected = false; o.removeAttribute('selected'); });
      if (match) { match.selected = true; match.setAttribute('selected', ''); }
    }
  });
}

async function bootApp(opts = {}) {
  assertScriptOrderMatchesIndexHtml();
  const dom = setupDom();

  if (opts.lang) globalThis.localStorage.setItem('garage.lang', opts.lang);

  const { context, g } = makeContext(dom, { protocol: opts.protocol, supabaseStub: opts.supabaseStub });
  for (const rel of SCRIPTS) {
    const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    vm.runInContext(code, context, { filename: rel });
  }

  // app.js's boot is async; wait for the session to hydrate before rendering.
  const deadline = Date.now() + 2000;
  while (!g.session.booted() && Date.now() < deadline) {
    await new Promise(r => setImmediate(r));
  }
  if (!g.session.booted()) throw new Error('app.js did not finish booting within 2s');

  if (opts.vehicles) g.session.setVehicles(opts.vehicles, opts.activeId || opts.vehicles[0].id);

  /* Reaches app.js's top-level `let` bindings (maintMode, reportType, lang),
     which live in the context's global lexical scope and are not properties of
     its global object. */
  const evalInApp = code => vm.runInContext(code, context, { filename: 'evalInApp' });

  return { document: dom.document, window: dom.window, api: g, evalInApp, cleanup: dom.cleanup };
}

module.exports = { bootApp, SCRIPTS, assertScriptOrderMatchesIndexHtml };
