# TN-70 — a third regime: resilience stopped publishing altogether, and nothing says so

**Branch:** `docs/tn70-resilience-third-regime` · **Lane A** · docs only, no code

## TN-70 was not startable, and that was already written down

The entry prescribes a decisive test — re-run the rollup over the level-5 window — and a later
Lane A pass established that it **cannot be run from a container**: against production it is a
production write (the owner's call), and non-destructively it needs 191,191 raw rows through an
endpoint capped near 1,000, plus a ~40-member `io` no test in the repo builds. The alternative
read it suggested instead was done on 2026-09-25 and killed the baseline-still-learning
hypothesis.

So the remaining step is a production re-derive or a replay harness, each its own entry. Verifying
the entry rather than implementing it is what this session could add — and it found something the
entry does not describe.

## The two regimes reproduce exactly, and there is a third

The table verifies to the day: 16 days at level 5 (2026-07-24 → 2026-08-29, mean confidence
0.464, `daytime_stress_coverage_min` NULL on all — the column's age, as the entry's own ⚠ says),
and 14 days at levels 1–4 (2026-09-07 → 2026-09-22).

**Resilience has published nothing since 2026-09-22 — five days.** The entry ends its September
regime there and reads it as the current state. It is not.

## The rollup is fine. The gate is closed.

`oura_daily_derived` was last written **2026-09-27 02:19 UTC** and `daytime_stress_coverage_min`
is populated through **2026-09-27**. The rollup runs, computes coverage, and declines to publish
a level.

The mechanism needs no replay — it is two constants and the stored coverage column, which exists
precisely so "why did resilience produce nothing today" is answerable from data:

- a day is valid only at `resolutionMinutes × nonNaN ≥ minDaytimeStressHours × 60`
  (`stress-resilience.ts:144`) → **240 minutes**;
- a level publishes only at `validCount >= windowMinLength` (`:288`) → **5** of a 14-day window.

Coverage from 09-15: **290, 290, 170, 170, 120, 50, 150, 60, 150, 60, 140, 110, 50**. Two of the
last thirteen days clear 240. On 09-22 `confidence` was **0.357, which is exactly 5/14** — sitting
on the floor. On 09-23 the window rolled past one more valid day, `validCount` hit 4, and the gate
closed.

**Coverage alone does not explain it, which is worth stating because it looks like it should.**
09-21 published a level at 150 minutes and 09-23 published nothing at the same 150. The per-day
number is not the gate; the count of valid days in the trailing window is.

## What this changes about TN-70

The September spread was **already decaying to the floor as it was being measured**. Confidence
across 09-07 → 09-22 falls to the minimum and then through it. Reading those fourteen days as a
healthy regime to contrast against the level-5 one overstates them.

It does **not** explain the level-5 regime, and is not offered as doing so. It is a separate,
later fault on the same metric.

## Filed as LA-158

A score the owner reads simply stopped, and the only reason anyone knows is that someone queried
the table — no Known-Issues row, no surface saying "not enough daytime coverage to compute this",
no alert. The absence is indistinguishable from the app not having got to it yet.

Two candidate causes for the coverage collapse, **neither established**: the ring is genuinely
worn less in the daytime since mid-September, or daytime-stress ingest has degraded. The database
cannot separate them — `worn_hours_ble` is NULL on every row (TN-70's own finding), so there is no
stored wear figure to check against. That half is a `DV` question.

**The entry says outright not to fix it by lowering the gate.** Four hours is the vendor model's
own constant, and a level computed from 50 minutes of coverage would be worse than no level.

## Not exercised

**No code changed and nothing was run.** Every figure is a read of `claude_ro` against production,
and every threshold is quoted from source with its line. The decisive re-run TN-70 asks for is
still not done and still blocked for the reasons already recorded there.

**Both reads are row-scoped to the owner**, like every `claude_ro` view, so these are his days.
