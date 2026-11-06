---
phase: quick-261106-qfy
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - styles.css
  - main.js
  - src/**/*.js (only files where proven-dead code is found)
  - src/i18n/strings.ar.js
  - sw.js (CACHE line only, via npm run sw:version)
autonomous: true
requirements: [QUICK-261106-qfy]

must_haves:
  truths:
    - "App behaves exactly as before: npm test stays 951/951 passing, Playwright e2e passes"
    - "Duplicate .admin-view .admin-item + .admin-item rule (styles.css ~1140) is gone; admin item spacing and border unchanged"
    - "Every removed JS function/const had zero references outside its own definition across main.js, src, test, e2e, index.html, sw.js, supabase, tools"
    - "Every removed Arabic dictionary key had no exact literal occurrence anywhere outside strings.ar.js and could not be built dynamically"
  artifacts:
    - path: "styles.css"
      provides: "Stylesheet without exact-duplicate / dead rules"
    - path: "src/i18n/strings.ar.js"
      provides: "AR dictionary without unused keys"
    - path: "sw.js"
      provides: "CACHE hash regenerated to match edited precached files"
  key_links:
    - from: "sw.js CACHE"
      to: "precached files (styles.css, main.js, src/**)"
      via: "npm run sw:version content hash, checked by test/precache.test.js"
      pattern: "const CACHE = 'garage-"
---

<objective>
Delete dead code in the shipped browser app (main.js, src/**, styles.css, sw.js) on branch `cleanup-dead-code` with zero behavior change: duplicate/dead CSS rules, unreferenced functions/consts, unused Arabic i18n keys.

Purpose: less code to read and ship. Deletion only, no refactors, no renames, no new helpers.
Output: smaller styles.css, main.js/src files, strings.ar.js; regenerated sw.js CACHE; three atomic commits.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@./CLAUDE.md

Key facts (already verified by planner):
- All browser JS is classic scripts sharing ONE global scope. A function defined in src/pages/x.js may be called from main.js, another page, index.html, or tests (test/helpers/boot.js exposes globals as `app.api.*`). "Unused" therefore means unused across the WHOLE repo.
- `src/` modules are dual-mode (browser global + `module.exports`); names returned from the factory `api` object may be consumed by `require()` in test/ — count those as used.
- `t(s)` in src/i18n/lang.js looks up `AR[s]` by the exact English string; strings may arrive via variables (data files in src/data, remote catalogue rows from Supabase / supabase/seed-catalogue.sql, label maps, status codes).
- styles.css line 1099: `.admin-item + .admin-item { border-top: 1px solid var(--stroke); margin-top: 16px; padding-top: 16px; }`
  styles.css line 1140: `.admin-view .admin-item + .admin-item { margin-top: 16px; padding-top: 16px; }` — same values, narrower selector. Planner grepped: no rule between them (or anywhere) sets margin/padding on `.item + .item` or similar that 1140 would be overriding. `.admin-item` is only created in src/pages/admin.js (el('div','admin-item')). So line 1140 is a pure duplicate: delete it.
- After editing any precached file run `npm run sw:version` (rewrites the CACHE line in sw.js) or test/precache.test.js fails.
- Use the scratchpad dir for any throwaway scan scripts. Never add scan scripts to the repo.
</context>

<tasks>

<task type="auto">
  <name>Task 1: Remove duplicate and dead CSS rules from styles.css</name>
  <files>styles.css, sw.js</files>
  <action>
1. Delete styles.css line ~1140 `.admin-view .admin-item + .admin-item { margin-top: 16px; padding-top: 16px; }` (exact duplicate of values in the ~1099 rule; see context).
2. Scan the rest of styles.css for further candidates, removing ONLY:
   (a) rules whose selector text AND full declaration set appear identically earlier/later in the file (keep the one that wins in cascade order; if both identical, keep the first unless the later one sits in an @media block — then keep both);
   (b) a declaration repeated inside the same rule block (keep the last one);
   (c) selectors whose class/id tokens appear nowhere in main.js, src/**, index.html, sw.js, e2e/, test/. Before removing for (c), also grep for the class prefix to catch dynamically built names (e.g. `'pill-' + x`, `` `status-${s}` ``, `classList.toggle(`, `className =`); if any prefix concatenation could produce it, KEEP it. For compound selectors, only drop the selector from a list, or the whole rule if every selector in the list is dead.
   Do NOT touch: rules inside @media/@supports unless they duplicate an identical rule in the same at-block; :root custom properties; keyframes (unless the animation name is grepped and found nowhere); any rule where you are not certain.
3. Run `npm run sw:version`.
Do not reformat or reorder anything else; diff should be pure deletions plus the sw.js CACHE line.
  </action>
  <verify>
    <automated>cd "C:/Users/Ali Bashuaib/mazda3-app" && npm run sw:version && npm test 2>&1 | tail -15 && git diff --stat && git diff --numstat styles.css</automated>
  </verify>
  <done>styles.css only has deletions (numstat added = 0); line ~1140 duplicate gone; npm test reports 951 pass, 0 fail. Commit: `refactor(css): remove duplicate and dead rules` with trailer `Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>`.</done>
</task>

<task type="auto">
  <name>Task 2: Remove unreferenced functions and consts from main.js and src/**</name>
  <files>main.js, src/**/*.js (only files with proven-dead symbols), sw.js</files>
  <action>
1. Write a throwaway node script in the scratchpad that lists every top-level `function NAME(`, `const NAME =`, `let NAME =` declared in main.js, sw.js and src/**/*.js (also names inside dual-mode factory bodies), then for each NAME counts whole-word occurrences (regex `\bNAME\b`) across main.js, sw.js, index.html, src/**, test/**, e2e/**, supabase/**, tools/**. Candidates = names whose only occurrence is their own declaration (count 1), or whose only other occurrences are in the same dead code being removed.
2. For each candidate, manually confirm before deleting:
   - not listed in a factory `return { ... }` / `api` object or `module.exports` (if it is, and no test/require uses it, remove it from that object too — but only if the global is also never referenced);
   - not referenced as a string (e.g. `'NAME'`, `window[...]`, `onclick="NAME(`), not an event-handler name in index.html;
   - not used by sw.js event listeners or as a callback passed by reference.
   If any doubt, keep it.
3. Also remove: unreachable code after an unconditional `return`/`throw` in the same block, and commented-out code blocks (multi-line commented JS statements, NOT explanatory prose comments or banner comments — CLAUDE.md requires banner comments and existing prose comments stay).
4. Do not touch supabase/, tools/, vendor/, test/. If a deleted function had a dedicated test (it should not, since tests count as references), stop and keep the function instead.
5. Run `node --check` on every edited .js file, then `npm run sw:version`.
  </action>
  <verify>
    <automated>cd "C:/Users/Ali Bashuaib/mazda3-app" && for f in $(git diff --name-only -- '*.js'); do node --check "$f" || exit 1; done && npm run sw:version && npm test 2>&1 | tail -15 && git diff --numstat</automated>
  </verify>
  <done>Every removed symbol had zero external references (list them in SUMMARY with the grep count); edited files pass node --check; npm test 951 pass, 0 fail. Commit: `refactor: remove unreferenced functions and dead code` with trailer `Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>`. If no candidates survive confirmation, skip the commit and say so in SUMMARY.</done>
</task>

<task type="auto">
  <name>Task 3: Remove unused Arabic i18n keys, then run e2e</name>
  <files>src/i18n/strings.ar.js, sw.js</files>
  <action>
1. Scratchpad node script: extract every key of the `AR` object in src/i18n/strings.ar.js (reuse the key-scan approach in test/strings-ar-unique.test.js). For each key, search for the exact key text as a quoted literal (`'key'`, `"key"`, or inside a backtick template) in main.js, sw.js, index.html, src/** (excluding strings.ar.js), test/**, e2e/**, supabase/** (seed-catalogue.sql and functions feed remote catalogue rows that get passed through t()). Also check unquoted occurrence in index.html text and in .sql/.json data.
2. Candidate = zero occurrences outside strings.ar.js. Then KEEP the key anyway if any of these hold:
   - it looks like data that can arrive at runtime (part/category names, model/engine/trim names, service item names, status codes, units, months/weekdays, error codes like 'offline'/'failed');
   - it contains or could be built from a template/concatenation (a `t(\`...${`, `t(a + b)`, or string with spaces/punctuation that might be assembled — grep for its first word near `t(`);
   - it is a short fragment (one or two words) that also appears as a substring of any literal in src/main.js;
   - any test references it.
   Only delete keys that are clearly old UI sentences/labels with no literal anywhere. Delete the whole `'key': 'value',` entry; keep surrounding comment lines unless the comment's whole section becomes empty.
3. `node --check src/i18n/strings.ar.js`, `npm run sw:version`, `npm test`.
4. Run full e2e: `npx playwright test`. If it fails, check whether failure relates to this plan's deletions (revert that deletion) or is pre-existing (run `git stash` + rerun to confirm, then `git stash pop`; report in SUMMARY).
  </action>
  <verify>
    <automated>cd "C:/Users/Ali Bashuaib/mazda3-app" && node --check src/i18n/strings.ar.js && npm run sw:version && npm test 2>&1 | tail -15 && npx playwright test 2>&1 | tail -15</automated>
  </verify>
  <done>Removed keys listed in SUMMARY (each with "0 literal occurrences" evidence); strings.ar.js only has deletions; npm test 951 pass; Playwright e2e passes. Commit: `refactor(i18n): remove unused Arabic strings` with trailer `Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>`. Do not push.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| none new | Deletion-only change; no new inputs, fetches, or rendering paths |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-qfy-01 | Tampering | escaping `html` template / SSRF guards in src/ui/html.js and data modules | mitigate | Never delete security helpers (html, esc, Raw, safe-fetch, URL guards) even if a grep count looks low; test/no-raw-templates.test.js must stay green |
| T-qfy-02 | Denial of Service | sw.js precache | mitigate | Run npm run sw:version after every edit so clients get the new cache; precache.test.js gates it |
</threat_model>

<verification>
- `git diff --numstat` on main branch base shows deletions only (plus sw.js CACHE line).
- `npm test`: 951/951 pass.
- `npx playwright test`: pass.
- `node --check` passes on every edited .js.
- Three (or fewer, if a task finds nothing) local commits, nothing pushed.
</verification>

<success_criteria>
- Duplicate `.admin-view .admin-item + .admin-item` rule removed.
- Proven-dead CSS, JS symbols, and AR keys removed with grep evidence recorded in SUMMARY.
- No behavior change: unit + e2e suites green.
</success_criteria>

<output>
Create `.planning/quick/261106-qfy-reduce-unnecessary-code-dead-code-duplic/261106-qfy-SUMMARY.md` when done
</output>
