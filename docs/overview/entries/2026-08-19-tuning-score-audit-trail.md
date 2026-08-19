# 2026-08-19 — Can each score be re-audited later? (Q-525, Q-526)

**Agent:** Tuning 🎶 · **Branch:** `tuning/score-audit-trail` · **Docs-only.**

Every calibration review this month **reconstructed** contributor sub-scores from raw inputs instead
of reading them. This checks whether that was necessary. Over 96 `oura_daily_derived` rows:

| score | scored rows | trail stored | re-auditable? |
|---|---|---|---|
| sleep | 36 | 10 real sub-scores | ✅ |
| readiness | 35 | sub-scores **+ `provisional` flags** | ✅ |
| illness | 46 | all 4 biomarker z-scores, every scored row | ✅ |
| **activity** | 23 | **`{base, adjustment, trained}`** — the blend wrapper | ❌ Q-526 |
| resilience | 13 | — | Q-508 (dormant) |
| **chronic stress** | **0** | — | ❌ Q-525 — never produced a value |

## Q-526 — activity stores the wrapper, and it has already cost a measurement

`readiness-payload.ts` persists the blend wrapper into `activity_contributors` rather than
`computeActivityScore`'s six components — **which are in memory on the same request** as
`activityResult.components`, and are served to the client. They are just not written.

The cost is concrete rather than theoretical. Yesterday's contributor audit had to rebuild all six
from raw inputs, and could only do so **at today's goals** — `strengthFreqGoal` went 3 → 5 and the
volume target changed basis on 2026-08-11. So *"what did `strengthFreq` score on 2026-08-02?"* is
**unanswerable**, and the audit had to report a predicted sd ceiling instead of the real historical
spread. Sleep and readiness had no such problem on the same days. **Illness is the counter-example
that proves the point:** its stored biomarkers are exactly what let Q-506 diagnose a poisoned
temperature baseline from history rather than from a live capture.

**Sequenced before Q-505**, and Q-505 now says so. The redesign changes the contributor set; land it
first and the old model's history is gone permanently, along with the before/after comparison that
would show whether the redesign worked. The fix is one line at the existing persist site — merge,
don't replace, since `base`/`adjustment`/`trained` is real information.

## Q-525 — chronic stress has never produced a value

`chronic_stress_score` is NULL on all 96 rows. Third dormant score, after the illness radar (Q-506)
and resilience (Q-508).

The gate is stricter than it reads: `computeChronicStress` needs 21 complete nights of granular BLE
signals in a trailing 31-night window, and the step's own comment records the binding part — *"the
intermediate history is built from THIS pass's stashed signals"*. **Twenty-one good nights existing
is not enough; they must be present in one pass**, so a nightly incremental rollup can never satisfy
it however long it runs.

First action is deliberately a check, not a fix: confirm whether 21 qualifying nights exist at all.
If they do, this is a trigger problem needing no code. If they don't, it is coverage, and belongs
with Q-510. **A dormant score is not automatically a broken one** — the gate may be correctly
refusing to score on insufficient data, and relaxing it before knowing which would be the worse
error.

**Not Q-507.** That is `STRESS_HIGH_DAY_THRESHOLD_MIN`, *daytime* stress minutes driving the session
override, which does fire — on the wrong days. This is the separate vendored cumulative model. Noted
in both entries because the shared word invites a merge.

## A correction made before it shipped

The first pass of this review claimed illness stored no contributors, from a column grep filtered on
`%contributor%`. Illness stores them as `illness_biomarkers` — 46 of 46 scored rows. Caught by
reading the persist site instead of trusting the column-name pattern, which narrowed the finding from
"two scores keep no trail" to the correct "one score keeps the wrong one".

## Files

- `docs/reviews/2026-08-19-score-audit-trail.md` (new)
- `docs/implementation-backlog.md` — Q-525, Q-526 filed; Q-505 gains the Q-526-first constraint
- `docs/domains/activity/README.md`, `docs/domains/readiness/README.md`
- `scripts/check-doc-index-size.js` — backlog baseline 10916 → 10983
- `docs/agents/state/tuning.md`

## Not exercised

Docs-only; no code path changed. All measurement is `claude_ro`, **row-scoped to the owner** — 96
rows, one athlete. **Not checked:** whether the local SQLite mirror of these columns matches
Postgres (a device question), and whether the 25 rows lacking `model_versions` predate stamping or
lost it to the Q-518 clobber — that belongs to Q-518.
