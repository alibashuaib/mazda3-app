'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const APP = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

/* Every HTML string must be built by html``. An untagged template assigned to
   innerHTML is exactly the hole Phase 3b closed. */
test('no innerHTML assignment takes an untagged template literal', () => {
  const bad = APP.split('\n')
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => /\.innerHTML\s*=\s*`/.test(line));
  assert.deepStrictEqual(bad.map(b => b.n), [], `untagged innerHTML templates at lines: ${bad.map(b => `${b.n}: ${b.line.trim()}`).join(' | ')}`);
});

test('no el() call takes an untagged template literal', () => {
  const bad = APP.split('\n')
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => /\bel\([^)]*,\s*`/.test(line) && !/el\([^)]*,\s*html`/.test(line));
  assert.deepStrictEqual(bad.map(b => b.n), [], `untagged el() templates at lines: ${bad.map(b => `${b.n}: ${b.line.trim()}`).join(' | ')}`);
});

/* raw() is the sanctioned escape hatch, so it must stay small and reviewable.
   Raise this number deliberately, with a justification in the commit message —
   never to make a failing test pass. Real count on 2026-08-19: 9 (all audited
   as unreachable from user or imported data — see task-9-report.md). 12 gives
   a small margin without being high enough to be meaningless. */
test('raw() use stays bounded', () => {
  const count = (APP.match(/\braw\(/g) || []).length;
  assert.ok(count <= 12, `raw() is used ${count} times; each one bypasses escaping and needs justifying`);
});

/* ============================================================
   ADDITION 1 (Task 9 brief addendum): the template-literal guards above are
   blind to HTML built by string concatenation instead of a bare backtick —
   `el(tag, cls, iconSvg('x') + t('y'))` has no backtick, so nothing above
   catches it, yet it is exactly the same "HTML assembled by ad-hoc string
   joining" hole the phase closed everywhere else. Ten such sites existed at
   the start of this task (all `iconSvg(...) + t(...)`, all constants — no
   live bug) and were converted to html`` rather than merely excluded from
   this guard. This test asserts that conversion holds by finding any el()
   call whose third (content) argument contains a top-level `+` that isn't
   entirely inside a single html`` tagged template.

   A hand-rolled balanced-paren/string scanner is used instead of a regex
   because the third argument can itself contain parens, e.g.
   `el('div', 'card' + (x ? 'a' : 'b'), html\`...\`)` — a naive `[^)]*` regex
   cannot tell that boundary from the call's own closing paren. Every el()
   call in app.js is single-line (verified below), so a per-call scan does
   not need to cross newlines. */
function matchBalanced(str, start) {
  let depth = 0, inStr = null;
  for (let i = start; i < str.length; i++) {
    const c = str[i];
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { inStr = c; continue; }
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return str.slice(start + 1, i); }
  }
  return null;
}

function splitTopLevelArgs(argStr) {
  const parts = [];
  let depth = 0, inStr = null, cur = '';
  for (let i = 0; i < argStr.length; i++) {
    const c = argStr[i];
    if (inStr) {
      cur += c;
      if (c === '\\') { cur += argStr[++i] || ''; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { inStr = c; cur += c; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    if (c === ')' || c === ']' || c === '}') depth--;
    if (c === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

function findElCalls(src) {
  const calls = [];
  const re = /\bel\(/g;
  let m;
  while ((m = re.exec(src))) {
    const openIdx = m.index + 2; // index of the '(' itself
    const inner = matchBalanced(src, openIdx);
    if (inner == null) continue; // unbalanced — e.g. matched inside a string; ignore
    const line = src.slice(0, m.index).split('\n').length;
    calls.push({ line, args: splitTopLevelArgs(inner) });
  }
  return calls;
}

test('no el() call builds its content by string concatenation', () => {
  const calls = findElCalls(APP);
  assert.ok(calls.length > 100, `only found ${calls.length} el() calls — the scanner is probably broken, not the app`);
  const bad = calls.filter(({ args }) => {
    if (args.length < 3) return false;
    const content = args[2].trim();
    const isHtmlTagged = /^html`/.test(content) && content.endsWith('`');
    return !isHtmlTagged && /\+/.test(content);
  });
  assert.deepStrictEqual(bad.map(b => b.line), [],
    `el() calls building content by concatenation at lines: ${bad.map(b => `${b.line}: ${b.args[2].trim()}`).join(' | ')}`);
});

/* ============================================================
   ADDITION 2 (Task 9 brief addendum): openModal's grip is a constant string
   — `card.innerHTML = '<div class="modal-grip"></div>'` — with nothing
   interpolated into it. A single-quoted (or double-quoted) literal cannot
   carry an injection: there is no value substitution for hostile data to
   ride in on. This guard therefore permits constant-string innerHTML
   assignments and flags only assignments built by concatenation, which is
   where a future edit could reintroduce a live value unescaped. */
test('no innerHTML assignment is built by string concatenation outside html``', () => {
  const bad = APP.split('\n')
    .map((line, i) => ({ line: line.trim(), n: i + 1 }))
    .filter(({ line }) => {
      const m = line.match(/\.innerHTML\s*=\s*([^;]+);/);
      if (!m) return false;
      const rhs = m[1].trim();
      if (/^html`/.test(rhs) && rhs.endsWith('`')) return false;      // tagged
      if (/^'[^']*'$/.test(rhs) || /^"[^"]*"$/.test(rhs)) return false; // constant literal
      if (rhs === "''" || rhs === '""') return false;
      // a leading unary + (numeric coercion, e.g. `+modelSel.value`) is not concatenation
      return /[a-zA-Z0-9_)\]'"`]\s*\+\s*/.test(rhs);
    });
  assert.deepStrictEqual(bad.map(b => b.n), [],
    `innerHTML built by concatenation at lines: ${bad.map(b => `${b.n}: ${b.line}`).join(' | ')}`);
});
