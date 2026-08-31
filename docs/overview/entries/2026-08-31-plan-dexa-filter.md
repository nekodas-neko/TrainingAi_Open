# 2026-08-31 — BF-2 gets a plan, and two shipped engines turn out to have no way in

**Branch:** `plan/dexa-filter` · **Lane A** · docs-only. Nothing implemented.

BF-2 sat at the head of the queue with an owner promotion on it (*"first we need that Dexa scan
filter applied so it shows Body fat on the current scale as per a dexa result"*) and **no plan** —
its own entry said it needed a planning session before implementation. This is that session.

## The finding that changes what "done" means

Re-verifying the entry against production rather than reading it:

| Claim | Status |
|---|---|
| `dexa_scans` + routes exist (BF-41, migration 240) | ✅ |
| The RMR half is split out as BF-33 | ✅ **shipped** — `measured_rmr`, `personalRmr`, `/api/measured-rmr` |
| The scale half of the calibration pair exists | ✅ 2026-08-27, 71.7 kg, 25.3 %, `scale_ble` |
| The scale is *consistent* — the premise the whole design rests on | ✅ twelve consecutive days in **24.9–25.5 %** |
| The DEXA half is stored | ❌ **`dexa_scans` holds zero of the owner's rows** |

**And it cannot be.** `grep -rn "dexa-scans\|measured-rmr" app/ components/ lib/` outside `app/api/`
returns nothing — no screen, no form, no client fetch on either route. `measured_rmr` is empty for
the same reason. Two engines shipped a day and five days ago respectively, both correct, both
unreachable; the owner's real results have been transcribed in `docs/clinical-baseline-2026-08-27.md`
for four days with nowhere to go.

**Nothing was going to catch this.** No test breaks when a table stays empty, no check goes red, and
the routes themselves are fine. The tell is a populated `docs/` transcription with an empty table
behind it. Filed as **LA-44**, which does not block *building* BF-2 — the correction engine is inert
with zero pairs — but does block the owner seeing it, which is what they asked for.

## Two decisions in the plan reverse what the entry assumed

**The pairs are derived, not stored.** The entry says the stored thing is "a set of paired (scan,
scale) observations". Both halves are already first-class rows — `dexa_scans.scanned_on`/`pct_fat`
joined to `body_metrics.date`/`body_fat_pct`, keyed by `source_map->>'body_fat_pct'` — so a stored
pair is a **stored counter wearing a different hat**, and every one of those in this project has
drifted. Deriving means a second DEXA becomes a second pair with no entry step, and it takes the
whole entry off the migration budget: **no new table, no migration number.**

**Offset, not ratio, at n=1.** They are numerically identical with one pair, so this is a choice about
how the correction degrades. A ratio asserts something specific about the bias at readings never
observed — at a scale reading of 5 % it implies a gap of 0.6 points. An offset asserts only what was
measured. Ship the offset and revisit at n = 2.

A third thing is *retired* rather than decided: the entry warns that adding a DEXA source means
editing `health-source.ts` and its inlined SQL `CASE` together or the ladders diverge. Under
read-time correction the DEXA never writes to `body_metrics`, so that edit does not happen at all.

## The consumer that must not be missed, and why it comes for free

`personalRmr` re-scales a measured RMR's Cunningham residual onto **today's** fat-free mass.
`ffm_kg_at_test` comes from the DEXA (51.46 kg); today's comes from the scale. Feed it the
uncorrected scale number and the two are from different instruments — 53.56 vs 51.46 kg, which
re-scales the residual onto **+45 kcal/day** of fat-free mass the owner does not have, permanently
and from the first day.

It needs no patch of its own: `goal-recommendation.ts:178` passes it a `leanMassKg` that
`bodyComposition()` derived from the body-fat input, so correcting **the input** fixes it by
construction. That is precisely why the plan puts the correction at the input boundary rather than at
each consumer — but the plan says to prove it with a test that fails without it, not to assume it.

## The correction reaches a third of the history

The three instruments turn out to occupy **contiguous, near-disjoint date ranges** rather than being
interleaved: no provenance at all from 2026-05-07 to 06-23 (40 rows), `health_connect` to 08-01
(11), `scale_ble` from 07-29 (31). So "fixing previous values" corrects **31 of 82 rows** and leaves
the earlier two-thirds alone — putting a **~3.2-point step in any body-fat chart at 2026-07-29** that
will read as a change in the body rather than a change in the correction.

**Widening the correction to close it is the wrong fix.** The provenance-less rows predate
`source_map` and are *probably* the same scale, but "probably" is exactly how a calibration gets
applied to an instrument it was never measured on — which the owner's own refinement ("the filter is
per measurement system, not global") rules out. The plan closes it by labelling: `corrected` is
carried **per reading**, so the chart can mark where the calibrated span begins.

## What the plan deliberately leaves alone

Only `body_fat_pct` is corrected. `muscle_mass_kg`, `bone_mass_kg`, `body_water_pct` and the rest come
from the same BIA call, and **no pair exists for them** — the DEXA reports lean and lean+BMC, which is
fat-free mass, not Renpho's "muscle mass". Deriving a correction for those from an FFM measurement
would be inventing a calibration nobody took. The panel is therefore internally inconsistent by
construction, and the Lane B half has to label it rather than hide it.

## Also noticed, and filed nowhere else

**The 🔵 marker on seven backlog headings has no legend.** It is on BF-1, BF-2, BF-3, BF-5, BF-7,
BF-9 and PS-7, and `grep -rn '🔵' docs/` finds no definition in the backlog protocol, in
`docs/agents/README.md`, or in `next-item.js`. All seven are large owner-requested features, so it
plausibly means "needs a plan" — but nothing says so, and a marker that has to be inferred is a
marker that will be applied inconsistently. Recorded here rather than guessed at; it is Orchestrator's
to define or remove, being the owner of the queue's conventions.

## Not exercised

Docs only — no code, no tests, no runtime surface. The production reads behind the findings above are
**row-scoped to one user** (`claude_ro`), so "zero rows" means *none of the owner's*; that is the
claim BF-2 needs and it is the only one this endpoint can support.
