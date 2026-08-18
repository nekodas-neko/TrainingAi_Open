# A claim I published this morning was false by lunchtime

**Date:** 2026-08-18 · **Branch:** `tuning/model-version-clobber` · **Agent:** Tuning 🎶
**Type:** docs-only — defect evidence · **Filed as:** Q-518

Found by re-running the session-start production read rather than by looking for it. The stamped-row
count had gone 0 → 1 earlier in the session when the readiness route first ran; on a later read it was
**back to 0**.

## What happened

Same row, `oura_daily_derived` for 2026-08-18, twice in one session:

| read at | `model_versions` | `readiness_score` |
|---|---|---|
| 04:38:27 | `{"bodyComp": "atlas_2_1_0", "readiness": "v3:ri5:2026-08-18"}` | 76 |
| 10:18:40 | `{"bodyComp": "atlas_2_1_0"}` | 77 |

Three rows share `updated_at = 10:18:40`, so one job rewrote them all.

## Why

`upsertOuraDailyDerived` sets every column as `COALESCE(excluded.col, existing.col)`. That is right for
scalars — its comment explains it stops a partial recompute nulling a good value — but for a `jsonb`
column `COALESCE` takes the first non-null **document whole**. It cannot merge.

So the merge is left to each caller, and only one of two does it. `readiness-payload.ts` reads the row
and spreads (`{...existingVersions, readiness}`); the body-composition backfill passes a flat
`{ bodyComp: … }` and replaces. **The readiness code did nothing wrong** — it is the only participant
honouring a convention the shared writer does not enforce.

## The correction

PR #85 reported that the merge *"held in production"*. That was true when I measured it and false five
hours forty minutes later. The verification review now carries a dated correction pointing here.

Worth naming the lesson rather than just the bug: **I verified a merge by observing one write, when
the thing that needed observing was the next write by someone else.** A single positive reading of a
shared mutable field proves the writer, not the invariant.

## The fix, and the one not to make

Move the merge into `upsertOuraDailyDerived` — `existing || excluded` for `model_versions` — so the
guarantee is the function's own. That is the pattern this codebase already chose one column over:
`upsertOuraHeartrate`'s comment says *"this makes the guarantee the function's own, so every caller
gets it rather than each one remembering"*, and **Q-280 exists because two of its siblings missed it**.

Patching the bodyComp caller alone restores today's stamp and leaves the next writer to rediscover the
rule, which is exactly how this happened.

## Not exercised

No code changed, and the proposed `||` expression was **written, not run** — no test, no local DB.
**The job that ran at 10:18:40 was not identified directly**: the bodyComp backfill is the only
`model_versions` writer passing a flat object and its payload matches the surviving document exactly,
but no scheduler or trigger was traced, so its cadence is unknown and "short half-life" is an inference
from one observation. `readiness_score` also moved 76 → 77 between the reads and that is **not
explained** — it doesn't affect the finding, which rests on the missing key.
