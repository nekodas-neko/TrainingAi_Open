# Activity Score redesign — a daily effort meter with a target, and where over-exertion goes

**Date:** 2026-08-18 · **Agent:** Tuning (design proposal) · **Backlog:** Q-505 · **Lane:** A
**Status:** ⛔ two owner decisions marked below. Everything else is settled by measurement.
**Evidence for the problem:** [`docs/reviews/2026-08-18-activity-score-calibration.md`](../../reviews/2026-08-18-activity-score-calibration.md)

The owner's brief: Activity should be *"how active I was today"* — steps per hour, total steps, zone
minutes (daily and against a weekly target), exercise minutes, with a possible weekly-to-daily split.
Hitting everything gives 100. It should double as guidance (*"keep your score under X today to get
recovery"*). And the open question they raised: **what should happen when you do too much?**

---

## 1. The over-exertion question — recommendation, and why it is not a preference

**Recommendation: cap Activity at 100, keep it monotone in effort, and put the cost of overdoing it
into Readiness.** That is the owner's own instinct, and there are three reasons it is right, one of
which is decisive.

### 1.1 The decisive reason: a non-monotone score cannot be a target gauge

The owner wants to use this score as guidance — *"keep your score under 60 today"*. If overshooting
pulls the number back down, then **60 is satisfiable two ways**: by doing appropriately little, or by
doing far too much and being tapered back to 60. The guidance becomes unreadable exactly on the days
it matters most.

A gauge you steer by has to be monotone. That is a property of the use case, not a matter of taste,
and it rules out the current taper design regardless of anything else.

### 1.2 It closes a hole that is already documented

**Readiness is structurally blind to training load — that is Q-275**, and it is the largest known
modelling gap in the app. `lib/health/readiness-payload.ts:329` reads the *pre-taper* activity score
deliberately, to avoid double-counting:

```ts
const ownActivityScore = activityResult?.preTaperScore ?? null // pre-taper → readiness composite (no double-count)
```

That reasoning would be sound if load entered readiness somewhere else. It does not — walking all
nine contributors, there is no acute-load term, no recovery-time term, no session-intensity term. So
routing over-exertion into readiness is not a new burden on that score; it fills the exact gap Q-275
identified.

### 1.3 The current mechanism is inert anyway

`adjustment` is **0 on all 22 scored days**. `ACWR_TAPER_START = 1.5` has never been reached. So
today *neither* the activity taper nor readiness reflects doing too much — nothing does. There is no
working behaviour to preserve.

### 1.4 What that requires mechanically

Capping at 100 loses the "how far over" information, and readiness needs it. So the score must expose
an **uncapped load ratio alongside the capped display score** — the same shape the code already uses
for `preTaperScore`:

```
displayScore = clamp100(round(weighted blend))     // monotone, capped, what the user sees
loadRatio    = blend / dailyTarget                  // uncapped, e.g. 1.6 = 160% of today's target
```

Readiness consumes `loadRatio` (and its trailing 7-day shape), never `displayScore`. That keeps one
number for "what did I do" and a separate one for "what did it cost me", which is also what stops the
double-count the current comment worries about.

> **⛔ OWNER DECISION 1 — how hard should over-exertion hit readiness?** The mechanism is settled;
> the strength is not, and it should not be guessed. Proposal: derive it the way this session derived
> the sleep curves — measure `loadRatio` against **next-day** HRV and resting HR over the owner's
> history, and fit the penalty to what actually predicts a worse next morning. If that correlation is
> absent, ship the term at a deliberately small weight and say so, rather than inventing a curve.

---

## 2. What the inputs can actually support — measured, and one is broken

The brief names five inputs. Three are usable today, one needs a fix first, and one has no source.

| input the owner asked for | state | measured |
|---|---|---|
| **total steps/day** | ✅ **best input in the model** | present 43/47 days, spans **637 → 18,761 (29×)** |
| **exercise minutes** | ✅ usable | `workout_sessions` on 27 consecutive days |
| **steps per hour** | ❌ **no source** | `step_live_windows` holds **11 rows in total** |
| **zone minutes / % per zone** | ⚠️ **broken at the source — fix first** | see §2.1 |
| **weekly target hit** | ✅ derivable | needs a per-day split rule, §3 |

### 2.1 The zone lane is miscalibrated, and would be dead on arrival

`daily_zone_minutes` computes zones against **`max_hr = 187` on all 27 days** — the `220 − age`
formula. But Body Battery already resolves this owner's **measured** max at **168**
(`resolveBatteryHrMax`, shipped in Q-57 for exactly this reason). Every zone boundary therefore sits
about **19 bpm too high**, and the consequences are visible in the data:

| zone | mean minutes/day |
|---|---|
| zone 1 | **554** |
| zone 2 | **1** |
| zones 3–5 | **1** |

Zone 1 absorbs the entire day and nothing reaches zone 2. **Weighting zone minutes before fixing the
HRmax would add a contributor that is ~0 on almost every day** — the same failure mode as
`activeCalories` (non-null on 1 of 47 days), which is a large part of why the current score is flat.

And even after the fix, zone 1 alone will not carry much: its interquartile range is **514–582
minutes against a 545 median** — it is essentially "hours awake wearing the ring".

**So: fix the zone HRmax to the measured value first (it is a One-Formula-One-Place violation
independent of this work — two parts of the app disagree about the same user's max HR), re-measure
the zone distribution, and only then decide the zone lane's weight.**

### 2.2 "Steps per hour" already has a working proxy — use it rather than building ingest

`step_live_windows` has 11 rows, so hourly step data does not exist. But
`packages/shared/src/health/hourly-movement.ts` already implements the same idea from HR: a waking
hour counts as "moved" when any reading that hour is above the shared rest threshold. Its own comment
says it exists precisely because the app "doesn't store steps at hourly granularity".

That is the movement-distribution signal the owner wants, it works today, and it was fixed as
recently as Q-188 (the numerator and denominator now agree, so it can carry information). **Use
`moveHours`; do not build hourly step ingest for this.**

---

## 3. Proposed shape

**Activity Score = how much of *today's target* you completed**, where the target is derived from the
weekly plan and adjusted for the day's role (training / rest / deload).

```
dailyTarget  = weeklyTarget × dayShare(dayRole)      // dayShare is where deload/rest days get their lower bar
lanes        = steps · moveHours · exerciseMinutes · [zoneMinutes, once §2.1 is fixed]
blend        = Σ weight × clamp01(actual / laneTarget) × 100
displayScore = clamp100(round(blend))                 // monotone, 100 = hit today's target
loadRatio    = blend / 100                            // uncapped, feeds readiness per §1.4
weeklyProgress = Σ week-to-date actual / weeklyTarget  // shown alongside, not folded in
```

Three properties worth stating because they are easy to lose:

- **Same-day lanes only.** The rolling 7-day strength terms are what flattened the current score
  (45 of 100 weight on near-constant inputs — §3.1 of the review). Weekly context belongs in
  `weeklyProgress`, displayed *next to* the score, not averaged *into* it.
- **100 means "hit today's target", not "did a lot".** A rest day with a low target reaches 100 by
  doing appropriately little.
- **The score is a quantity, not a grade.** Which forces the next point.

> **⛔ OWNER DECISION 2 — what do the colour bands mean now?** `scoreBand()` colours 70/50 as
> High/Moderate/Low on an absolute scale. If a correct rest day scores 30, it renders **red "Low"**
> and reads as failure when it is exactly right. Two options: **(a)** band against *today's target*
> (30/30 = green, "on target"), which is coherent but means the colour no longer compares days to
> each other; or **(b)** keep absolute bands and accept that rest days look red. Recommend (a). This
> is a `[app-shell]` change and touches the shared `scoreBand()` contract, so it needs deciding
> before implementation, not after.

---

## 4. Sequencing

1. **Fix the zone HRmax** (§2.1) — independent bug, unblocks the zone lane, and is worth doing
   whatever else is decided.
2. **Owner decisions 1 and 2.**
3. **Re-weight to same-day lanes**, add `dailyTarget`/`loadRatio`/`weeklyProgress`, retire the
   inert ACWR taper.
4. **Measure the new distribution.** Only if it is *still* compressed does a range calibration come
   into it — and per the review, calibration preserves ranking, so it must come after the weights are
   right, never instead of them.
5. **Re-anchor any threshold on the activity scale in the same PR**, preserving firing rates
   (the `LOW_SLEEP_SCORE` 60 → 42 change in v1.319.0 is the worked example).
6. **Then** add the readiness load term (decision 1), stamping a readiness model version per Q-273 —
   Sleep shipped without one and left an unmarked step in its trend chart; do not repeat that.

## 5. What this proposal does not do

- **It does not fix coverage.** The Activity Score is absent on more than half of days (**Q-278**),
  and nothing in the UI distinguishes "76" from "no score". Re-weighting inherits that.
- **It does not persist contributor sub-scores.** `activity_contributors` carries only
  `base`/`trained`/`adjustment`, so the weight arithmetic in the review had to be derived from
  constants rather than read back. Persisting them the way sleep and readiness do would make the next
  calibration measurable instead of inferred — cheap, and worth folding in.
- **Nothing here is measured on-device**, and no code has changed.
- Every figure is **the owner's** (`claude_ro` is row-scoped), 2026-07-07 → 2026-08-18, n = 22–47
  depending on the column.
