# 2026-09-04 — the derived-scores backfill wrote history with no model stamp (LB-53)

**Branch:** `fix/backfill-readiness-model-stamp` · **Lane:** A · **Domain:** sleep / platform

## What LB-53 said, and why it was wrong

LB-53 read `oura_daily_derived.computed_at` and found four distinct stamps across the whole table —
one of them rewriting 85 rows spanning the entire history minutes after a deploy — and concluded the
scores are recomputed in occasional bulk passes rather than per night.

`computed_at` cannot support that reading. `upsertOuraDailyDerived` sets `computedAt: new Date()`
unconditionally, on every write of any of the row's 36 columns, by any of five producers. It answers
*"when was this row last touched"*, never *"when was this score computed"*.

**The 85-row pass is the body-comp backfill.** Every rollup run calls `persistBodyCompFromMetrics`,
which walks the entire `body_metrics` history and upserts one derived row per day that has a weight
and a body-fat reading — writing `body_comp` and nothing else, while re-stamping `computed_at` on all
of them. Measured in production the same day: a burst at 02:16:37Z, one row per day, writes 3–4 ms
apart, across the whole history. No score was touched by it.

## What actually happens

The scores are written per day, on the day, by the live route, and never revisited afterwards.
`readiness-payload.ts` persists readiness, sleep and activity on every `/api/readiness-score`
request, keyed to today. So a day's stored score is refreshed continuously while that day is current
and frozen when it ends — which is correct behaviour, not staleness.

That is measured rather than inferred. `model_versions.readiness` is written by the live route and
by nothing else, and in production it is present on exactly the **10** most recent days and absent
from all **76** older rows. Any pass that recomputed a past day's readiness would have left the stamp
behind. None did.

## The defect that was actually there

The other writer of `readiness_score` is the admin backfill route, and it wrote the score and the
contributor breakdown with **no model stamp at all** — 27 of the owner's rows carry a readiness score
with no readiness stamp, and nothing else produces that shape.

That is precisely the case Q-273 added the stamp for. A backfill writes across months of history in
one pass; without a stamp, the boundary between scores computed under one model and the next is
unmarked, and no later correlation can separate an input change from a model change.

The route's own comment explained why it could not stamp: `model_versions` was "replaced wholesale by
the upsert", so writing it would clobber body-comp and illness provenance on the same row. That was
true when the comment was written and stopped being true when Q-273 changed the column to merge per
pillar with `||` inside the statement. The comment was never updated, so a correct fix looked unsafe.

## What shipped

`app/api/admin/backfill-derived-scores/route.ts` now writes
`modelVersions: { readiness: READINESS_MODEL_VERSION }` on the readiness upsert, matching the live
route exactly, and the stale comment is corrected to say why `source` is still left alone and
`model_versions` no longer needs to be.

One new case in `backfill.test.ts`, whose file-level thesis was already *"a backfilled day must be
indistinguishable from a live-computed one"* — which, for provenance, it was not. It seeds another
pillar's stamp on the row first, so it pins both halves: the readiness stamp is written, and the
other pillar's survives. It asserts `summary.readiness.written === 1` before touching the row,
because the readiness composite needs a daily summary and without one the audit reports `no-score`
and every later assertion passes vacuously. Mutation-verified: dropping the stamp fails this test and
no other.

## Deliberately not done

**The 58 rows with no readiness score at all.** More than half the owner's derived history has never
been scored, because the live route only ever writes today. The backfill route is the tool for it and
now stamps correctly — but running it rewrites months of history in one pass, and a re-scored trend
is not silently reversible, so it is an owner action. LB-53 keeps that as its `Gate: owner` residual.

## Not exercised

Admin-only route; no device surface, no UI. Production was read, never written — every measurement
above came from `claude_ro` via the read-only db-query endpoint, which is row-scoped to the owner, so
the counts are one user's rows. The writer map is read from source and is complete.

## Gates

lint 0 errors · `pnpm check:rules` 67 of 67 · backfill suite 6 passed.
