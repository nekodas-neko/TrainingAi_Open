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
each was checked against the code. **Six have no writer at all**, and two of those six are **read by
live surfaces**: `weekly-digest` computes `otsHigh` from `trainingLoadHigh` (permanently false) and
the AI chat `trainingStress` tool filters on `trainingLoadOts != null` (always an empty array).
Neither fails; both quietly report nothing to say.

That is LA-140's trap with consumers attached, and it is filed as **LA-142** rather than folded in
here — the work is a per-column judgement (persist or delete) exactly as this one was, and six of
them in one diff would be a sweep that decided nothing.

## Verification

- `tsc` clean, `typecheck:tests` at baseline, lint 0 errors, full suite green, Custom Rules 78 of 78.

**Not exercised:** no test drives the rollup's derived writes — there is no harness for
`aggregateOuraRawSamples`, and building one for a one-line persist would be disproportionate. So
**this is verified by the type system and the plumbing audit above, not by a test that watches the
column fill.** The honest check is a production read after the next rollup: `night_hrv_baseline_ms`
should stop being NULL on new days. It has not been run, because the code is not deployed yet.
