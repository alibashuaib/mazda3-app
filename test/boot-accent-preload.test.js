'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* index.html's second inline <script> paints the cached accent before
   session.load() resolves (see its own comment, and chrome.js's
   applyAccent()). That cache's `soft` value is only correct for the theme
   it was computed against — accentForColor() darkens toward one theme's
   background and lightens toward the other's to hold WCAG AA contrast (see
   src/ui/color.js's own comment) — so if the OS-preferred theme flips while
   the app is closed, applying a stale cache's `soft` paints sub-AA-contrast
   link text until the real applyAccent() call corrects it.

   This runs the actual inline script text from index.html (not a
   reimplementation of it) against a minimal fake DOM/localStorage, the same
   way test/helpers/boot.js's SCRIPTS list is checked against index.html
   itself rather than trusted to stay in sync by hand. */

const ROOT = path.join(__dirname, '..');

function extractAccentScript() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  const found = scripts.find(s => s.includes("localStorage.getItem('garage.accent')"));
  if (!found) throw new Error('index.html\'s accent pre-paint <script> not found — did it move or get renamed?');
  return found;
}

function runAccentScript({ theme, cached }) {
  const store = cached === undefined ? {} : { 'garage.accent': JSON.stringify(cached) };
  const props = {};
  const sandbox = {
    localStorage: {
      getItem: k => (k in store ? store[k] : null)
    },
    document: {
      documentElement: {
        getAttribute: name => (name === 'data-theme' ? theme : null),
        style: { setProperty: (k, v) => { props[k] = v; } }
      }
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(extractAccentScript(), sandbox);
  return props;
}

test('accent pre-paint script applies --accent-soft when the cached theme matches the live one', () => {
  const props = runAccentScript({
    theme: 'dark',
    cached: { accent: '#fff', soft: '#abc', accent2: '#000', glow: 'rgba(0,0,0,.35)', theme: 'dark' }
  });
  assert.strictEqual(props['--accent-soft'], '#abc');
  assert.strictEqual(props['--accent'], '#fff');
  assert.strictEqual(props['--accent-2'], '#000');
  assert.strictEqual(props['--accent-glow'], 'rgba(0,0,0,.35)');
});

test('accent pre-paint script withholds a stale --accent-soft when the OS theme flipped since caching', () => {
  const props = runAccentScript({
    theme: 'light', // OS/theme preference changed after 'garage.accent' was cached
    cached: { accent: '#fff', soft: '#abc', accent2: '#000', glow: 'rgba(0,0,0,.35)', theme: 'dark' }
  });
  assert.strictEqual(props['--accent-soft'], undefined,
    'a soft colour computed for the wrong theme must not be painted — leave the stylesheet default in place');
  // The theme-independent properties are unaffected by the mismatch.
  assert.strictEqual(props['--accent'], '#fff');
  assert.strictEqual(props['--accent-2'], '#000');
  assert.strictEqual(props['--accent-glow'], 'rgba(0,0,0,.35)');
});

test('accent pre-paint script tolerates a cache written before this fix, with no theme field', () => {
  const props = runAccentScript({
    theme: 'dark',
    cached: { accent: '#fff', soft: '#abc', accent2: '#000', glow: 'rgba(0,0,0,.35)' } // no `theme` — pre-fix shape
  });
  assert.strictEqual(props['--accent-soft'], undefined,
    'an un-attributed soft colour must be treated as untrustworthy, not assumed to match');
});
