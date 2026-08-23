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

---

# Same PR — three owner decisions answered, and two asks withdrawn

The owner answered the open decisions. Two of their answers turned out to resolve questions I had
filed as needing *more* input from them, so the asks were withdrawn rather than carried forward.

## Q-523 — "use current recorded high and set a % off it, dynamically"

I had said this needed the owner to label "active days" before a Zone 2 floor could be fitted. **It
did not.** Following their instruction led to a larger defect that fits itself.

`resolveHrProfile` already computes what they asked for, and deliberately splits it in two:
`maxHr` refuses to drop below the age prediction (correct for %-of-max effort — a soft month must not
make ordinary efforts read as maximal), while **`targetAnchorMax` uses the corroborated observed max**
for reachable targets. Measured: age-predicted **187**, observed **167**. Active-minutes should use
the second. Dynamic by construction — it is a rolling 90-day order statistic.

**That alone only takes zero-minute days from 53/59 to 38/59.** The real defect:
`activeMinutesFromZoneSeconds` documents itself as implementing the WHO convention and is **one band
off it** — it calls Zone 2 (≥60% reserve) "moderate", but WHO/ACSM moderate is **40–59%** and 60% is
where *vigorous* starts. **Moderate intensity — brisk walking, stairs, carrying things — maps to no
zone and has been earning nothing by construction.**

Proposed: moderate `[0.40, 0.60)` ×1, vigorous `≥0.60` ×2, off `targetAnchorMax` (99–121 bpm ×1,
≥121 ×2 today). Zero days **53/59 → 6/59**, sub-score **~6 → 63.8 mean, sd 38.7** — which would make
it **the highest-variance contributor in the Activity Score**, above `steps` (33.4). The threshold is
published, not invented, and the sweep is smooth around 0.40 so a small max-HR error doesn't swing it.

## Q-524 — one step goal, AI-defined, manually overridable

`users.steps_goal` becomes the single source; `getDailyGoals()` reads it instead of deriving from
`activity_level`. **The AI half already exists** — `/api/nutrition-goals/recommend` computes a
recommended steps goal and `goal-recommendation-sheet.tsx` writes it to that exact column, with manual
entry beside it. So this is a read-side change plus a fallback, not a feature.

## Q-276 — Body Battery is "energy left"; Readiness is a morning starting number

Resolves to outcome (1): different questions. **Readiness needs no model change to match that
definition** — checked rather than assumed: all nine `READINESS_WEIGHTS` contributors are overnight or
previous-day measures, and nothing reads today's activity. So this is **a presentation change and
therefore Lane B's**, and the "wait for Q-272 before deciding" instruction no longer applies — the
owner decided what each score is *for*, which doesn't depend on where the correlation settles. The
+0.12 end-of-day figure stops being a defect: two numbers answering different questions need not agree.

## Q-72 — the sleep-rating ask, withdrawn

The owner explained the flat ratings: *"upon waking I don't feel instantly super rested or not
rested… generally it's a mid."* Measurement backs them completely. `sleep_quality_feel` is the **most**
variable self-report in the app (sd ~0.8, 5 values used); `perceived_recovery` is 0.36 across 2
values. **(Corrected 2026-08-19 — see the retired-scales note below; `resting_soreness` is a fossil,
not a live field.)** It also tracks
sleep better than the alternatives (vs efficiency **+0.316**).

Objective outcomes were tested too: steps **+0.210**, training volume **+0.028**, RPE **−0.023** — and
the last two are **structurally disqualified**, because volume is prescribed by the app (adherence
73.6% vs 73.1% planned) and `RPE_DEAD_BAND = 1.5` makes RPE deliberately insensitive. A number the app
dictates cannot validate another number the app produces.

**So the fix is the yardstick, not the rating** — which is what Q-72 said and my ask ignored. A rank
comparison of the 6 flagged-unusual nights against the 40 mid ones, re-run after ~3 weeks of history
under the recalibrated model, since every correlation here predates v1.319.0 and history is not
back-filled.

`mood_logs.energy_level` has the better *spread* (ok 35 / good 34 / low 4 / drained 2 — categorical
labels get answered where abstract magnitudes get a 3) and is worth adding as a secondary target. Its
−0.424 correlation with HRV is **flagged as a lead, not a finding**: it is the largest coefficient in
the review, points the wrong way, and Pearson on a 4-level ordinal with 92% of mass in two adjacent
levels manufactures exactly that.

## Added files

- `docs/reviews/2026-08-19-active-minutes-who-threshold.md`
- `docs/reviews/2026-08-19-sleep-validation-targets.md`
- `docs/implementation-backlog.md` — Q-523 answered, Q-524 + Q-276 decisions recorded, Q-72 updated
- `docs/domains/{activity,heart-rate,sleep}/README.md`
