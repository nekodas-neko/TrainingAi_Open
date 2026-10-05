# 2026-10-05 — OR-209: the model's own numbers go in the shadow row

**Branch:** `feat/or209-raw-model-in-shadow` · **Lane A** · no schema, no behaviour change.

`RV-65` asks whether the model still earns its call in the prescription, and that was unanswerable and
could never be answered retrospectively: the stored prescription carries only the final values and
`session_periodization` keeps one overwritten row per session. BF-199 Phase 1 already records the
final values and the rules prescriber's beside them, but not what the MODEL returned.

## What changed

- Generation copies `parsed.exercises` immediately after the model call, **before** reconciliation
  overwrites it in place, and passes it to `buildPrescriptionShadow`, which adds `model` to each row
  of the existing `rows` JSON. **No migration**: it is a JSON key.
- `model` is `null` where the model omitted an exercise and reconciliation backfilled it, ignores an id
  the model invented, keeps the first of a repeated id, and is **absent** (not null) on rows written
  before today, which never recorded it. Those are three different facts and stay distinguishable.
- It stores the model's answer **raw**. The model often returns pct as a fraction, so readers apply
  `normalizePctFraction` first (noted on the type, the BF-199 Keep and RV-65).

## First live row (the owner's snapshot, live Gemini, Push)

Bench: model 0.775 × 7 × **4 sets**, given 77.5 × 7 × **2**. Overhead Press: 4 sets against 2. Dips:
3 against 2. **Dumbbell Fly and Tricep Cable Combo: the model omitted both**, and reconciliation
backfilled them. One row is an anecdote and not a result, but the three effects the entry predicted a
diagnostic would separate (the model's sets, its pct convention and omitted exercises) are all visible
in it.

## Verified

`bf199-prescription-shadow.test.ts` (6 new cases: the delta readable, null for an omission, a ghost id
ignored, first of a repeat, raw fractions kept, key absent without input, and a source pin that the
snapshot precedes the rewrite). Periodization suites and the real-Postgres shadow write test: 172
passed. tsc clean. Live generation wrote the row above.

## Not exercised

Production, which needs a deploy and a prescription. Server-only, so no device path.
