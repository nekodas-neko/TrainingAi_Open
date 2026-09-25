# 2026-09-25 — LA-140: a column plumbed end to end and written by nothing

**Branch:** `la140-persist-hrv-baseline` · **Lane A**

`oura_daily_derived.night_hrv_baseline_ms` had a complete pipeline — `schema.ts`, `DERIVED_COLS`,
the row mapper, the `pushMutations` branch, the local SQLite table, the sync delta, the Zod
validator — and **no writer**. NULL on all 130 production rows.

## Why a dead column is worse than an unused one here

`computeResilienceForDay` gates `contributorsOk` on this exact field being non-null, and falls back
to a **fabricated 50** for the stress scaling (`stress-resilience.ts:395`). So a reader who finds
NULL reasonably concludes the input was missing, when in fact it was computed and discarded. TN-70
hit precisely that: it could measure the resting-heart-rate half of its regime comparison and not the
HRV half, and said so.

Scoring was never affected — the resilience compute uses the in-memory `nightHrvMs`, which is why
this survived. The cost was diagnostic, and it was paid.

## Persist, not delete

LA-140 left the choice open: persist what the rollup already computes, or delete the column and its
plumbing. **Persist**, because TN-70 has a named, live need for the value and deleting would
foreclose it permanently, where persisting costs one line. The trap disappears either way; only one
of the two options leaves the question answerable.

**It joins the GUARD, not just the patch**, and that is the part worth reading. The surrounding write
is gated on `res.dailyIndices || res.level != null || res.daytimeStressCoverageMin != null` —
resilience having produced something. Gating the night's own *input* on the score succeeding is
backwards: a day the score skipped is precisely a day someone needs the input for. `nightHrvMs` comes
from `latest.hrvBaseline`/`hrvAvgMs` at the top of the loop and does not depend on `res` at all, so
`nightHrvMs != null` joins the condition.

## What this does not do

**The 130 existing rows stay NULL, so TN-70's July-versus-September comparison is still unanswerable
from the database.** The rollup re-derives each day from the packed raw tier, so a wide pass *would*
fill history — that pass is real work and has not been run. TN-70's entry now says so rather than
implying the fix unblocked it.

## The finding that came out of asking how many others there are

Rather than assume this column was alone, I asked production how many `oura_daily_derived` columns
are NULL on every row: **eleven**. All-NULL is not proof of a missing writer — `chronic_stress_*` is
gated on 21 complete nights by its own model, `recovery_index_hours` writes from `run.ts:561` — so
each was checked against the code. **Four have no writer at all**: `active_calories_est`, `pwv`,
`worn_hours_ble`, and the derived `vascular_age` (distinct from `oura_daily.vascular_age`, a
different table that is written). None has a reader either, so deleting them and their plumbing is
probably right — a migration plus a local SQLite version bump, so it ships alone. Filed as
**LA-142**.

> **⚠ Corrected 2026-09-25, after this entry was first written.** It said **six** columns had no
> writer, and that two of them — `training_load_ots` and `training_load_high` — were read by live
> surfaces, making them LA-140's trap with consumers attached.
> **`app/api/training-stress/route.ts:89` writes both**, on its success branch. The repo-wide grep
> behind that claim truncated its output per column and never surfaced the file.
>
> The symptom I described is real: both columns are all-NULL, so `weekly-digest`'s `otsHigh` is
> permanently false and the AI chat's `trainingStress` tool always returns an empty array. But the
> cause is that the route's gate never reaches `ok` and persists a reason instead — **TN-79's
> subject, already open** — not a missing writer. Fixing the gate fills the columns.
>
> Recorded here rather than quietly edited, because the original claim shipped in this PR's body and
> the wrong half is the interesting half: an entry filed to describe "measured the wrong thing"
> made that exact mistake within the hour.

## Verification

- `tsc` clean, `typecheck:tests` at baseline, lint 0 errors, full suite green, Custom Rules 78 of 78.

**Not exercised:** no test drives the rollup's derived writes — there is no harness for
`aggregateOuraRawSamples`, and building one for a one-line persist would be disproportionate. So
**this is verified by the type system and the plumbing audit above, not by a test that watches the
column fill.** The honest check is a production read after the next rollup: `night_hrv_baseline_ms`
should stop being NULL on new days. It has not been run, because the code is not deployed yet.
