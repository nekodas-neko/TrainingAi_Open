# Activity Score — it is not scoring your day, and that is a design question

**Date:** 2026-08-18 · **Agent:** Tuning · **Type:** calibration evidence, docs-only
**Filed as:** Q-505 · **⛔ blocked: owner decision** (not sign-off on a number — a decision about what
the score is *for*)
**Third of three:** [Sleep, shipped](2026-08-18-sleep-score-range-recalibration.md) ·
[Readiness, held](2026-08-18-sleep-score-range-recalibration.md#6-readiness-and-activity--analysed-deliberately-not-shipped) ·
**this**

Activity is the most compressed of the three pillars, and the reason is **not** the one that applied
to Sleep. Sleep needed a range fix. Activity needs a decision about what it is measuring, because a
range fix applied to it would amplify noise rather than reveal signal.

---

## 1. The distribution

`claude_ro.oura_daily_derived.activity_score`, n = 22:

| | value |
|---|---|
| range | 56 – 91 |
| mean / sd | 74.6 / **7.2** |
| bands | 50s:1 · 60s:3 · **70s:11** · 80s:6 · 90s:1 |

Half of all scored days sit in the 70s, and the whole series occupies 35 of 100 points. Against the
owner's stated test — *"days getting close to full and some days being low"* — it fails at both ends.

---

## 2. The finding that makes it concrete

The score barely tracks the day it is scoring. Against same-day steps, over the 22 days where both
exist: **r = +0.417**.

| date | steps | Activity Score |
|---|---|---|
| 2026-08-12 | **828** | **76** |
| 2026-08-16 | **8,935** | **64** |
| 2026-07-30 | 18,761 | 81 |
| 2026-08-18 | 637 | 56 |

**A day with 11× fewer steps scored 12 points higher.** Steps span 29× across the window (637 →
18,761); the score moves 25 points.

That is not a calibration error. A score that is *ranking* days correctly but compressing them can be
stretched — that is what the Sleep fix did. A score whose ranking disagrees with its most variable
input cannot be fixed by stretching, because stretching preserves the ranking.

---

## 3. Why — three measured causes

### 3.1 Most of the weight sits on terms that cannot move day to day

`packages/shared/src/health/activity-score.ts:19-24`:

| contributor | weight | window |
|---|---|---|
| steps | 18 | same day |
| activeEnergy | 15 | same day |
| moveHours | 12 | same day |
| zoneMinutes | 10 | same day |
| **strengthFreq** | **25** | **rolling 7-day** |
| **strengthVolume** | **20** | **rolling 7-day** |

The two strength terms are **45 of 100** by design — and rolling 7-day windows are smooth by
construction. Worse, `strengthFreq` is `sessions7d / goal`, and the owner has logged **exactly one
session per day on 27 consecutive days** since 2026-07-07. That term is very close to a constant.

### 3.2 Two of the four same-day contributors are almost never present

- **`activeCalories` is non-null on 1 of 47 days.** A 15-weight contributor that essentially never
  participates.
- **Zone-2+ minutes are 0 on 22 of 27 days** (median 0, max 25). The code already excludes a zero on
  a strength day — correctly, and for a documented reason — which removes it again.

Contributors that are absent are excluded and the weights renormalise. So on a typical day the live
weights are roughly **steps 24 % · moveHours 16 % · strengthFreq 33 % · strengthVolume 27 %** —
**60 % on the two near-constant rolling terms**, and the single most variable input in the whole
model carries a quarter.

### 3.3 The over-exertion taper has never fired

`adjustment` is **0 on all 22 scored days**. `ACWR_TAPER_START = 1.5`, and the owner's ACWR has not
reached it. The taper is the only place ACWR reaches this score, so in practice the score is its
pre-taper value — which is also what readiness reads (`readiness-payload.ts:329`, the Q-275 finding).
Not a bug; worth knowing that a documented mechanism is inert in practice.

---

## 4. The decision this needs, and why I am not making it

Two coherent answers, and they are genuinely different products:

**(a) It should score *today*.** Re-weight toward the same-day lane — steps, move hours, zone
minutes — and demote the 7-day strength terms to a minority. A rest day after a heavy week then
reads *low*, which is the honest answer to "how active was I today". Consequence: the score becomes
volatile, and a lifter who trains hard but walks little scores badly on training days.

**(b) It should score *recent training*.** Keep the weights; the flatness is then honest, because the
owner's training genuinely is consistent — one session a day, 27 days running. Consequence: the
daily framing is wrong and the fix is presentational (rename, or show it as a weekly figure), not
numerical. A flat line is the *correct* output for a consistent trainer.

**A range calibration is not on this list**, and that is the point of §2. Stretching preserves
ranking, so it would take the "828 steps beat 8,935 steps" ordering and make it more emphatic. The
Sleep technique does not transfer here.

**My recommendation is (a), with a caveat.** The card is on a daily surface next to Sleep and
Readiness, both of which answer "today"; and the owner's steps genuinely vary 29×, so there is real
signal being averaged away. But (b) is defensible and cheaper, and the choice is the owner's because
it changes what the number means rather than how accurate it is.

**If (a) is chosen**, the sequencing is settled by the Sleep work: re-weight first, *then* measure
the new distribution, *then* apply a range calibration only if it is still compressed — and
re-anchor any threshold that rides on the activity scale in the same PR (§5 of the Sleep review is
the worked example).

---

## 5. What was not exercised

- **Nothing on-device**; no code changed.
- **n = 22 scored days** is small, and the window is bounded by how few days carry an Activity Score
  at all — that is Q-278 (the score is absent on more than half of days, and nothing in the UI
  distinguishes "76" from "no score today"). Any re-weighting inherits that coverage problem and does
  not fix it.
- **The contributor sub-scores are not persisted.** `activity_contributors` carries only
  `base`/`trained`/`adjustment`, so §3.2's weight arithmetic is derived from the constants and the
  measured input availability, **not** read back from stored per-contributor values. Persisting them
  the way sleep and readiness do would let the next session measure this directly instead.
- `moveHours` availability was **not** measured — it is asserted as present only in the sense that
  the weight arithmetic assumes it. If it is as sparse as `activeCalories`, the strength lane's real
  share is higher still, and §3.2 understates the problem.
- Every number is **the owner's** (`claude_ro` is row-scoped), 2026-07-07 → 2026-08-18.
