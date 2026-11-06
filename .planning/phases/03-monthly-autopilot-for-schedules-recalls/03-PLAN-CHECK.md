# Phase 3 plan check (re-verification)

Result: PASS (0 blockers, 2 warnings). Plans 03-01..03-08.

## Previous issues
1. BLOCKER severe in live plan: FIXED. 03-06 T1 adds severe_km/months to admin.js select + diff keys; 03-06 T2 adds them to remote-catalog select and put() mapping with test; 03-07 T3 adds Severe row in maintenance.js with test.
2. 03-08 depends_on: FIXED (["03-05","03-07"], wave 5).
3. Manual runs vs missed_runs/banner: FIXED (03-04 monthly-only + SQL test; 03-06 bannerState filters kind monthly + tests).
4. RESEARCH Open Questions: FIXED (titled RESOLVED with pointers).
5. 03-04 scope: still 2 tasks, 5 files; accepted risk.
6. autopilot_sources RPCs: FIXED (autopilot_get/set_source_hash in 03-04, used by 03-05).
7. First-time-car preview estimate: not re-checked as blocker (warning level).
8. Duplicate </output>: FIXED (one per plan).

## Checks
- Requirements ENG-01..09, SCH-01..05, REV-07, REV-08 all in frontmatter (REV-08 in 06/07).
- Waves: W1 01,02,03; W2 04; W3 05,06; W4 07; W5 08. Consistent, acyclic, no files_modified overlap in a wave.
- <threat_model> present in all 8 plans.
- D-09/D-10/D-12 honored; no scope-reduction language, no Phase 4 items.
- Field names: remote-catalog.js maps item.interval_km -> normalKm (line 103); test/remote-catalog.test.js fixtures use normalKm; maintenance.js uses intervalKm (effective) + normalKm (dealer). 03-06 severeKm/severeMonths and 03-07 fixture (normalKm, severeKm, severeMonths) are consistent.

## Warnings
1. 03-07 T3: maintenance.js Interval row uses svKm(s)/intervalKm; fixture with only normalKm 10000 may render NaN/empty in the Interval row. Fix: include intervalKm/intervalMonths in the fixture.
2. 03-04: 8 tables + ~17 RPCs in 2 tasks; split if execution quality drops.
