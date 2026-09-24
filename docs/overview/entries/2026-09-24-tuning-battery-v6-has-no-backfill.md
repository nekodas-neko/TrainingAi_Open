# 2026-09-24 — the battery fix shipped, and my plan's claim that it re-scores history was wrong

**Branch:** `tuning/battery-v6-has-no-backfill` · **Agent:** Tuning · **Docs-only.**

TN-55 shipped. Verifying its own acceptance test turned up an error in the plan I wrote, not in the
implementation.

## What shipped, correctly

`app/api/body-battery/route.ts` carries `CHARGE_RATE` **0.120**, `DRAIN_RATE` **0.080**,
`STRESS_DRAIN_RATE` **0.020**, `MODEL_VERSION` **v6** — exactly as specified. Production deployed it
(1.465.25 → **1.465.26**).

## What cannot happen

The route's write-through persists **`date: todayIso` only**, and `upsertBodyBatteryDaily` has **exactly
one caller** — that route. No backfill, no wide pass, no admin re-derive exists for
`body_battery_daily`. So v6 appears one day at a time as the app is opened, and **every stored
historical day keeps the model that wrote it, permanently.**

The plan (§5) said *"this change re-scores all 84 stored days"*. It does not and cannot. I inferred a
recompute from the `MODEL_VERSION` bump — which only *labels* which model wrote a row — without checking
that a path existed to rewrite one. The plan is corrected in place; the owner's 2026-08-26
"recompute rather than freeze" decision is **unsatisfied**, not implemented.

## What the owner will see

| model | days | mean end | days at zero | last |
|---|---:|---:|---:|---|
| v1 | 16 | 66.3 | 0 | 2026-07-15 |
| v4 | 18 | 62.9 | 0 | 2026-08-03 |
| **v5** | 52 | **15.2** | **27** | 2026-09-24 |
| **v6** | **0** | — | — | — |

A battery trend spanning today will show a **step from ~15 to ~60 that is a model change wearing the
clothes of a recovery**. Filed as **TN-72, `Lane: A`**, recommending a bounded admin re-derive on the
`backfill-derived-scores` pattern — the inputs survive for the whole span, so the days are re-derivable.
Two alternatives are on the entry, including freezing history and labelling the discontinuity, which
reverses the owner's decision and is therefore his call.

**This is TN-62's shape on a second metric.** A `MODEL_VERSION` bump plus a write path that only touches
today produces a history that silently mixes models — worth checking wherever else a versioned score is
persisted per day.

## The acceptance test has NOT run

TN-55's pass test is distributional — median daily net near 0, mean end ~61, sd ~25, ~0% of days at
zero, ~9% railing at 100. **Zero v6 rows exist**, so none of it is measured, and the battery must not be
described as fixed. Still owed alongside it, from the plan's own caveat: `DRAIN_RATE` fell 7.5× and
Q-521 measured drain tracking *wear time* rather than exertion (`corr(hr_sample_count, drained)` +0.518
vs `corr(steps, drained)` −0.153), so a workout day must be confirmed to still separate from a rest day.
If it does not, that is a separate defect and must **not** be patched by raising `DRAIN_RATE` back.

## Not exercised

Nothing runs. Read-only `claude_ro` queries, **row-scoped to the owner**, plus source reading and one
`/api/version` check. **Not established:** anything about v6's behaviour — no row exists yet. The first
real check is after a few days of reads accumulate. `pnpm check:rules` result below.
