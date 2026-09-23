# 2026-09-23 — TN-60: the rail was where the information went

**Branch:** `lane-a/tn60-compressive-tail` · **Lane A** ·
`packages/shared/src/health/readiness-composite.ts`. No migration, no schema change. **The history
recompute was NOT fired** — it is batched behind TN-6, BF-13 and LA-121 per the owner's 2026-09-22
decision, so stored days keep their old scores until that single `rederive-baselines` run.

## I nearly skipped this, and checking is what stopped me

My own check-in said TN-60 was owner-gated scoring work Lane A must not take. The entry says
**"✅ OWNER DECIDED 2026-09-22 — build option 1, the compressive tail. The gate is lifted; this is
startable."** Skipping it would have been enforcing a gate the owner had explicitly removed. The
lesson is the ordinary one: re-read the entry, do not act on a summary of it — including my own.

## What the entry measured, and what it could not have known

Over 69 days, `hrvBalance` — the largest single source of movement in readiness at 22.8% — sat on a
rail on **26 of them (38%)**. The z values scoring 0 spanned **−1.63 to −4.37**: 2.7σ rendered as
one number, so a mildly poor night and the worst in the record were indistinguishable.

The entry said the fix needed no constant — *"nothing needs re-fitting, it is a shape change rather
than a constant change"*. **That is not true, and the reason is integer rounding.** The tail has to
be paid for out of the linear region, and how much you reserve decides whether the tail does
anything at all:

| band | linear kept to | worst days separated | still railed |
|---|---|---|---|
| 5 | z = 1.35 | 3 of 7 | 3 |
| 10 | z = 1.20 | 4 of 7 | 0 |
| **20** | **z = 0.90** | **6 of 7** | **0** |
| 30 | z = 0.60 | 7 of 7 | 0 |

Today's hard clip separates **1 of 7**. Put to the owner with that table; he chose **20**.

## Two calls I made myself

**Algebraic tail, not exponential.** An exponential is the obvious smooth saturation and it fails
the one job here: it decays fast enough that integer rounding re-ties the extreme days. At a
5-point band it separates 2 of 7 and leaves 8 values pinned at a rail. This is now enforced by a
test rather than a comment — swapping in an exponential makes ±10σ round back to exactly 100.

**The tail lives in score space, not z space.** `compressTails(raw)` takes a value already in linear
points, so one implementation covers `higher-better`, `lower-better` and the double-slope
`closer-better` without a second formula to keep in step. Value and first derivative both match the
linear region at the knee, so there is no kink.

## The cost, stated plainly: readiness can no longer reach 100

A saturating curve and a reachable ceiling are the same thing — the ceiling **is** the rail. So:

- a contributor at ±1.5σ scores **90 / 10**, not 100 / 0;
- a 1.5σ-on-everything day with a good check-in reads **95**; without one, **90**;
- an integer 100 would need roughly **23σ** past the knee.

This partially re-creates what the 2026-07-22 recalibration was written to remove — that note calls
the old ±2.5σ rail's *"capping readiness ~86 even on a perfect day"* a defect. 95 is much milder
than 86, and it follows necessarily from the shape the owner chose, so it shipped rather than going
back for a third decision. **It reverses with one constant** (`TAIL_BAND_POINTS`).

## Mutation pass — and the one that survived first time

| # | mutation | result |
|---|---|---|
| 1 | exponential tail instead of algebraic | killed |
| 2 | band narrowed to 5 | killed |
| 3 | lower tail removed (floor hard-clips again) | **survived → new test → killed** |
| 4 | upper tail removed | killed |
| 5 | knee offset `100 - W` → `100` | killed |
| C | `W/(1+x/W)` rewritten as `W·W/(W+x)` | **survived** (correct) |

**Mutant 3 is the find.** Deleting the lower tail outright — so the floor rails at 0 exactly as
before — passed all 1004 tests in the package. Every case I had written exercised the *ceiling*,
while TN-60's entire measurement is about days scoring **zero**. There is now a case for the floor,
and it kills it.

**The control earned its keep too.** It failed on first run, and it was right to: I had asserted a
*strict* decrease across all seven worst days when the design delivers 6 distinct of 7 — the number
the width was chosen on. Float noise moves which adjacent pair ties. The assertion now pins the
contract (non-increasing, ≥6 distinct, none at 0) instead of pinning noise.

## Not done

- **`READINESS_MODEL_VERSION` bumped to `v4:tail20:2026-09-23`** so a stored score can be attributed
  to the model that produced it. Rows written before this keep the old stamp and the old numbers.
- **The history recompute is deliberately not run here** (owner decision — batched).
- **Failure surfaces not exercised:** the device, and production data. The 69-day figures are the
  entry's, re-used; I did not re-query them. The pass test's *"share-of-movement table moves toward
  the declared weights"* cannot be confirmed until the batched recompute runs — so it is **not
  claimed**, only the per-contributor resolution is.
