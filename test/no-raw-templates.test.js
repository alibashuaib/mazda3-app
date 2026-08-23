'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

/* Phase 3c moves Phase 3b's converted code out of app.js piece by piece, into
   src/pages/*.js and src/ui/*.js. The escaping guarantee this file polices
   moved with it, so the scan must cover the same files the code now lives
   in — app.js alone would only shrink every task until this guard's own
   sanity floor (calls.length > 100) started failing on the split itself,
   not on a real regression. Line numbers below are relative to this
   concatenation, not any one file — good enough to locate a hit by content,
   not by line, which matches how the existing failures are read (grep the
   quoted snippet). Task 11 of Phase 3c removes app.js from this list
   entirely once nothing remains in it. */
function readDirJs(dir) {
  const abs = path.join(__dirname, '..', dir);
  if (!fs.existsSync(abs)) return '';
  return fs.readdirSync(abs).filter(f => f.endsWith('.js'))
    .map(f => fs.readFileSync(path.join(abs, f), 'utf8')).join('\n');
}
const APP = [
  fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8'),
  readDirJs('src/pages'),
  readDirJs('src/ui')
].join('\n');

/* Every HTML string must be built by html``. An untagged template assigned to
   innerHTML is exactly the hole Phase 3b closed. */
test('no innerHTML assignment takes an untagged template literal', () => {
  const bad = APP.split('\n')
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => /\.innerHTML\s*=\s*`/.test(line));
  assert.deepStrictEqual(bad.map(b => b.n), [], `untagged innerHTML templates at lines: ${bad.map(b => `${b.n}: ${b.line.trim()}`).join(' | ')}`);
});

/* Was a regex, `/\bel\([^)]*,\s*`/`, whose `[^)]*` breaks the moment an
   earlier argument contains a `)` — e.g. `el('div', cls(x), \`...\`)` — so an
   untagged template on such a call would pass silently. findElCalls (below)
   is a proper balanced-paren/string scanner already used by the "content
   argument" test further down; reuse it here instead of a second regex. */
test('no el() call takes an untagged template literal', () => {
  const calls = findElCalls(APP);
  assert.ok(calls.length > 100, `only found ${calls.length} el() calls — the scanner is probably broken, not the app`);
  const bad = [];
  for (const { line, args } of calls) {
    for (const rawArg of args) {
      const a = rawArg.trim();
      if (/^`/.test(a) && a.endsWith('`') && !/^html`/.test(a)) bad.push({ line, arg: a });
    }
  }
  assert.deepStrictEqual(bad.map(b => b.line), [], `untagged el() templates at lines: ${bad.map(b => `${b.line}: ${b.arg}`).join(' | ')}`);
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
   ADDITION 1 (Task 9 brief addendum), widened after a post-merge review
   found an eighth live XSS at app.js:907 (2026-08-19): the template-literal
   guards above are blind to HTML built any way other than a bare backtick.
   Two such forms exist:

     - concatenation: `el(tag, cls, iconSvg('x') + t('y'))` — ten sites,
       all constants, converted to html`` earlier in this task.
     - a bare expression: `el(tag, cls, t(c))` — no backtick, no `+`, just
       a function call or variable handed straight to el()'s raw-HTML
       sink. This was invisible to every guard in this file: it has no
       backtick for tests 1/2 to find and no `+` for the concatenation
       check above to find. app.js:907 built a Parts-page filter chip as
       `el('button', c === active ? 'on' : '', t(c))`, where `c` is a
       category string drawn from `session.current().parts.map(p =>
       p.cat)` — reachable from an imported backup, unescaped, and live
       the moment the Parts page rendered. 38 such sites existed app.js-wide
       (see task-9-report.md's classification); all were converted to
       html`` in this pass, mechanically, regardless of whether the specific
       argument passed today happens to be a source-code constant — the
       guard cannot tell a `t('Save')` call (constant, safe) from a `t(c)`
       call (attacker-influenced, the actual bug) apart at the syntax
       level, so it must reject the *form* itself, not attempt to judge
       per-site safety.

   The predicate below therefore requires every el() call's third argument
   to be EITHER a single html`` tagged template OR a constant single/double
   -quoted string literal with no interpolation — anything else (string
   concatenation, a bare function call, a bare identifier, a ternary of
   non-literal expressions) fails. This subsumes the original
   concatenation-only check.

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

test('every el() call\'s content argument is html`` or a constant literal — never concatenation or a bare expression', () => {
  const calls = findElCalls(APP);
  assert.ok(calls.length > 100, `only found ${calls.length} el() calls — the scanner is probably broken, not the app`);
  const bad = calls.filter(({ args }) => {
    if (args.length < 3) return false;
    const content = args[2].trim();
    const isHtmlTagged = /^html`/.test(content) && content.endsWith('`');
    const isConstantLiteral = /^'[^']*'$/.test(content) || /^"[^"]*"$/.test(content);
    return !isHtmlTagged && !isConstantLiteral;
  });
  assert.deepStrictEqual(bad.map(b => b.line), [],
    `el() calls with an unsafe content argument (concatenation or bare expression) at lines: ${bad.map(b => `${b.line}: ${b.args[2].trim()}`).join(' | ')}`);
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
