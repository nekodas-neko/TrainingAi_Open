# Activity Score redesign — a daily effort meter with a target, and where over-exertion goes

**Date:** 2026-08-18 · **Agent:** Tuning (design proposal) · **Backlog:** Q-505 · **Lane:** A
**Status:** ✅ **All decisions resolved 2026-08-18** — the owner delegated them (*"we will go with
whatever your recommendation is, knowing we are going for best practice + future proof"*). The
recommendations and their reasoning are kept below so they can be argued with, not just followed.
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

> **✅ DECISION 1 (resolved) — how hard over-exertion hits readiness: fit it, do not invent it.**
> Measure `loadRatio` against **next-day HRV and resting HR** over the owner's history and let the
> data set the penalty, exactly as the sleep curves were set. **If the correlation is absent, ship the
> term at a deliberately small weight and say so in its comment** rather than picking a plausible
> curve — this session has twice shipped a "measure first" result that reversed the obvious answer,
> and an unfitted load penalty on the score that gates training is the worst place to guess.
> Re-measure once ~15 days exist under the new Activity model; the fit is not portable across a
> model change (Q-273).

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

### 2.1 The zone lane is a ceiling DECISION, not a bug — corrected 2026-08-18

> **This section originally called the zone HRmax a One-Formula-One-Place violation — "two parts of
> the app disagree about the same user's max HR". That was wrong, and the correction matters because
> the original framing would have sent an implementer to "fix" a deliberate design.**
>
> `resolveHrProfile` (`packages/shared/src/health/hr-profile.ts`) is already the canonical resolver
> and deliberately returns **two** differently-named answers, with `resolveBatteryHrMax` a third for
> the battery's reserve. Its own comment explains why the *ceiling* must not be the observed max:
> *"anchoring the ceiling on a low observed max would make every hard effort read as >100%."* Three
> named answers to three different questions is the design, not an accident. A change here was
> implemented, then reverted on reading that.

What is true is the **consequence**, and it still gates the zone lane. Zones are computed against
`resolveHrProfile().maxHr`, which resolves to **187** on all 27 days:

| zone | mean minutes/day |
|---|---|
| zone 1 | **554** |
| zone 2 | **1** |
| zones 3–5 | **1** |

**And that reading is honest, not broken.** With a 187 ceiling and a 53 bpm resting HR, zone 2 starts
around **133 bpm**. Measured over **52,647** HR samples since 2026-07-07 (both `ble` and
`chest_strap`): only **134 of them — 0.25% — reach 133 bpm**, and the observed max is **166**. So
zone 2+ really is ~1 minute a day for this owner's training. The code already notes why: resistance
work with rest between sets rarely holds an elevated HR.

Zone 1 does not rescue it either — its interquartile range is **514–582 minutes against a 545
median**, essentially "hours awake wearing the ring".

**So the zone lane needs a ceiling decision before it gets any weight, and it is a tuning question
with a measured consequence rather than a bug fix.** Anchored on the observed max (~166–168) instead,
zone 2 would start near **122 bpm**; 3,695 samples (7%) already exceed 110 bpm, so that plausibly
turns ~1 min/day into tens of minutes. That is a real choice with real trade-offs — the `>100% of
every hard effort` problem `resolveHrProfile` warns about is the cost — and it should be decided and
measured, not assumed.

> **✅ DECISION 3 (resolved) — score the Activity zone lane against `targetAnchorMax`, not `maxHr`.**
> The choice looked like "ceiling vs observed max", but `resolveHrProfile` already returns a third,
> better-named answer for exactly this: `targetAnchorMax` (`observedMax ?? estimatedMax`), documented
> as *"the anchor for **reachable** targets"*. Whether you did meaningful cardio work today is a
> reachable-target question, not a ceiling question.
>
> This resolves the trade-off rather than splitting it. The `>100% of every hard effort` problem
> `resolveHrProfile` warns about does not arise, because the zone lane **buckets minutes** rather than
> expressing an effort as a percentage of max — nothing renders "112% of maximum". The ceiling stays
> the ceiling for the surfaces that do express effort that way. And it is future-proof by
> construction: a fitter user with a higher corroborated max gets higher boundaries automatically,
> with no per-user constant anywhere.
>
> **Adds no fourth concept** — that is the point. Measure the resulting zone distribution before
> assigning the lane a weight: at ~122 bpm for zone 2, the 7% of samples already above 110 bpm suggest
> tens of minutes a day rather than one, but that is an inference and must be measured, not assumed.

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

> **✅ DECISION 2 (resolved) — band against TODAY'S TARGET, not an absolute scale.** A correct rest
> day scoring 30 must not render red "Low"; under a target-relative band it reads green/"on target",
> which is what it is. The cost is real and worth naming: the colour stops comparing days to each
> other, so a green rest day and a green training day mean "you hit your target", not "you did the
> same amount". That is the right trade for a score whose whole purpose is now a per-day target.
> **Do not change the shared `scoreBand()`** — it is correct for Sleep and Readiness, which remain
> absolute. Activity needs its own band function, which is also what stops this decision leaking into
> the other two pillars. `[app-shell]` + `[activity]`.

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
