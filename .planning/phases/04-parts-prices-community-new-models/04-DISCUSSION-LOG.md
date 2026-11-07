# Phase 4: Parts, Prices, Community & New Models - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-11-08
**Phase:** 04-parts-prices-community-new-models
**Areas discussed:** Where approved parts live, Price sources & threshold, Community failures & alts, New models in picker, Cost cap

---

## Where approved parts live

| Option | Description | Selected |
|--------|-------------|----------|
| Server table overlay | New RLS table, cached like remote-catalog.js, overrides catalog.js | ✓ |
| Patch for catalog.js | Approval produces a diff applied by hand | |

| Conflict rule | Selected |
|---------------|----------|
| Approved server value wins | ✓ |
| catalog.js wins | |

| Official catalogue | Selected |
|--------------------|----------|
| Mazda KSA dealer price list | ✓ |
| PartSouq genuine catalogue | |
| Mazda global/US parts sites | |

| Fitment key | Selected |
|-------------|----------|
| Per car_model id (model:engine) | ✓ |
| Per model + generation | |

---

## Price sources & threshold

| Price sources (multi) | Selected |
|-----------------------|----------|
| Mazda KSA dealer list | ✓ |
| Web search snippets | ✓ |
| App users' price reports | ✓ |
| Allowed shop pages | ✓ |

| Threshold | Selected |
|-----------|----------|
| Both ≥10% AND ≥5 SAR | ✓ |
| Either ≥10% OR ≥5 SAR | |
| Configurable, default 10% / 5 SAR | |

| Indicative label | Selected |
|------------------|----------|
| On non-dealer prices only | ✓ |
| On every autopilot price | |

| Price shape | Selected |
|-------------|----------|
| OEM price + alternative price | ✓ |
| Range (min–max) | |

---

## Community failures & alts

| Sources (multi) | Selected |
|-----------------|----------|
| Reddit | ✓ |
| Mazda owner forums | ✓ |
| Arabic/GCC forums | ✓ |
| NHTSA complaints | ✓ |

| Mention bar | Selected |
|-------------|----------|
| 3+ from 2+ sites | ✓ |
| 5+ mentions, any site | |
| 2+ mentions | |

| Where shown | Selected |
|-------------|----------|
| Car page 'Known issues' card | ✓ |
| Inside the related part | |
| Admin only for now | |

| Agreement rule | Selected |
|----------------|----------|
| Same car_model + part, median ±30% trim | ✓ |
| Same part any car | |
| You decide | |

---

## New models in picker

| Detection | Selected |
|-----------|----------|
| Mazda KSA/GCC sites first | ✓ |
| Mazda global + GCC | |

| Picker behaviour | Selected |
|------------------|----------|
| Show with 'catalogue in progress' | ✓ |
| Hide until it has a schedule | |

| Proposal fields | Selected |
|-----------------|----------|
| Identity + basics | ✓ |
| Identity only | |

| Id | Selected |
|----|----------|
| Code generates catalogId | ✓ |
| Owner types it on approve | |

---

## Cost cap

| Option | Selected |
|--------|----------|
| Keep SAR 40, stagger cars | ✓ |
| Raise the cap | |
| Separate cap per stage | |

## Claude's Discretion

- Table/kind naming and schema, rotation rule, snippet-price quoting, Known issues card placement, outlier-trim code.

## Deferred Ideas

- Car photos (PHO-01/02, v2). Price ranges.
