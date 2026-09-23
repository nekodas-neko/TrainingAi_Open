# 2026-09-23 — RV-77: the structure is real, the duplicate is not, and the path has never run

**Branch:** `lane-a/rv77-reverify` · **Lane A** · docs only. No code changed — that is the finding.

## Why nothing was built

RV-77 reached the top of Lane A's READY list and says meal-plan generation *"can fire the same
top-up model call twice for one meal"*, with a fix: key the top-up on (meal name, rounded shortfall).
Three checks against current `main`:

**1. The structure is real.** `generate/route.ts` does `Promise.all` over day-variants and then over
meals within each, calling `scaleWithTopUp` per (variant × meal). `loggedGenerateObject` takes a
`fingerprint`, but `lib/ai/instrument.ts` hashes it for the log row and **never dedups on it** — its
own comment says a fingerprint is *"a diagnostic, not a payload"*. So nothing collapses two calls.

**2. The two calls are not duplicates.** The rest variant subtracts `REST_DAY_CARB_REDUCTION` (0.15)
of carbs and `carbShift × 4` calories, so the two variants scale the same ingredient list toward
**different targets** and reach **different shortfalls**. The proposed key would collapse them only
when the shortfalls happen to round together. **A fix built to the entry's description would be a
near-no-op that reads as done** — the worst outcome available here.

**3. The comment it cites agrees with the code.** `:376` says *"One ingredient list serves both
variants"*, and that is what happens: `names[i].ingredients` is shared, and the *scaling* is
deliberately per-variant, which the same comment spells out (*"same meal, more rice on a training
day"*). The entry read a contradiction into a comment that does not contain one.

## And the measurement that settles it

The entry flagged *"no `meal-plan-top-up` row in `ai_call_log` at all"*. Re-measured three days
later:

| section | calls, all time | last |
|---|---|---|
| `meal-plan-top-up` | **0** | — |
| `meal-plan-generate` | **2** | 2026-09-01 |

The whole feature has run **twice, ever**, three weeks ago, and the call site this entry optimises
has **never executed**. The measured saving is nothing.

## What shipped instead

- **RV-77 rewritten in place** with all three findings and moved from position 1 to 8 — below the
  entries whose code paths actually execute. It rose to the top only because everything above it
  shipped, which is the queue working correctly rather than a signal to build it. If it is ever
  built, the honest fix is the entry's *second* option (top up once on the training variant, re-scale
  its merged list for the rest variant), which changes plan output and so needs a before/after on a
  real plan — which needs the feature to be in use.
- **LA-131 filed**, found while reading: `REST_DAY_CARB_REDUCTION = 0.15` is declared **twice**, in
  `generate/route.ts` and `[id]/structure/route.ts`, and so is the three-line derivation around it.
  Those are the generate and restructure paths for the same plan, so if one copy is ever tuned and
  the other is not, restructuring silently re-targets every rest-day meal against a different
  definition of a rest day. They agree today, which is the cheap moment to merge them.

## The pattern this is the ninth instance of

Nine entries were worked today. **One — DV-7 — was accurate as filed.** The rest were right about a
measurement and wrong about the conclusion drawn from it, or already fixed by another entry, or
pointed at the wrong component. Two were mine, and one of those was my own correction of an earlier
mistake. The re-verify step is not ceremony; it is where most of the value has been.

## Not done

- **No code change, deliberately.** Building the entry as written would have produced a fix that
  collapses almost nothing on a path that does not run.
- **Failure surfaces not exercised:** none apply — nothing executable changed.
