# Why the Calorie Nudge says 2,245 kcal, and why it is wrong

**Filed:** 2026-09-09 · **Agent:** Tuning · **Entries:** TN-27, TN-28 ·
**Owner report:** *"this is the maint calories derived from the app — i don't think it's right. with
RMR at 1350 and calories well under that and barely maintaining weight."*

**The owner is right, and the arithmetic is right.** `2,245` is exactly what
`estimateMaintenance` computes from the data it was handed. The defect is upstream of the formula:
**the module picked the wrong window**, and it picked it by a rule that steers toward the noisiest
answer available.

---

## 1. Where 2,245 comes from

`resolveMaintenance` tries a 28-day window, falls back to 14 days, and returns
`mean intake − (weight slope × 7700)`.

| | **28-day window** | **14-day window (what shipped)** |
|---|---|---|
| days | 2026-08-12 → 09-08 | 2026-08-26 → 09-08 |
| complete-logged days | **10** | **10** |
| **mean intake** | **1,612 kcal** | **1,612 kcal** |
| coverage | 36% | 71% |
| weigh-ins / span | 27 over 27 days | 14 over 13 days |
| weight slope | **−0.038 kg/wk** | **−0.575 kg/wk** |
| **maintenance** | **1,654** | **2,245** |
| 95% CI on that number | [1,526 – 1,781] | [1,990 – 2,500] |

Reproduced exactly: `1,612 − (−0.0822 × 7700) = 2,245`, matching the screenshot to the kcal.

**The mean intake is identical in both windows** — 1,612, to the kilocalorie. The extra fourteen
days contribute no complete-logged day, so they cannot move it. **The entire 591 kcal spread is the
weight slope**, and nothing else.

## 2. The gate rejected the better window on a criterion that changes nothing

`MIN_LOGGED_FRACTION = 0.7` exists to ask *"is the mean intake representative?"* Its denominator is
window length; its numerator, for this owner, is fixed at ten — complete-logging began on
**2026-08-26** and there is no earlier day to find. So **coverage falls mechanically as the window
grows**: 71% at fourteen days, 36% at twenty-eight, with the mean unchanged throughout.

The consequence runs backwards from the intent:

- The 28-day estimate — **27 weigh-ins across 27 days** — is rejected at 36% coverage.
- The 14-day estimate — **14 weigh-ins across 13 days** — is accepted at 71%.
- `resolveMaintenance`'s own comment says it tries the long window first *"for more noise
  cancellation"*; the gate makes the long window strictly **harder** to pass whenever the two share
  their logged days.
- `adaptive-tdee.ts`'s own header warns that *"shorter windows are dominated by water-weight swings
  (a single salty meal moves scale weight ~1 kg, which is 7,700 kcal of apparent error)"*. The gate
  routes to exactly that window.

**And it does so hardest when logging is sparsest** — the case the gate was written to be careful
about is the case in which it picks the least careful answer.

The window sweep shows how much of the output is window choice rather than metabolism:

| window | 10d | 14d | 16d | 18d | 20d | 22d | 24d | 26d | 28d |
|---|---|---|---|---|---|---|---|---|---|
| **maintenance** | 2,414 | **2,245** | 1,965 | 1,909 | 1,814 | 1,774 | 1,742 | 1,651 | **1,654** |

Mean intake is 1,612 in every column from 14 days out. **That is a 760 kcal range produced by
nothing but the number of days the slope is fitted over** — the signature of a slope dominated by
noise, and the reason the module says to prefer the long window.

## 3. Nothing gates the slope, which is the half that actually moves

`MIN_WEIGH_INS` and `MIN_WEIGHT_SPAN_DAYS` check that a slope **exists**. Nothing checks that it is
**precise**, and precision is where the error lives:

- Day-to-day scale noise, as residual from the fit: **±254 g** over 14 days, **±360 g** over 28.
- The 14-day slope's whole signal is a 0.8 kg drop — roughly **twice** that noise.
- Its 95% interval, carried through ×7700, is **[1,990 – 2,500] kcal**.

**The two windows' intervals do not overlap**, so this is not only imprecision: the 14-day window
opens on a local peak (71.35 → 71.90 kg across 08-26…08-28) and closes on a trough, and a
short window that starts high and ends low reports a rate the month does not contain. Over the full
thirty days the trend is **−0.074 kg/wk**, worth **−81 kcal/day** — against the −633 kcal/day the
shipped number is built on.

## 4. What the number probably is

Three independent readings agree, and none of them is 2,245:

| basis | maintenance |
|---|---|
| 28-day window (blocked by the gate) | **1,654** |
| 30-day scale trend against the same mean intake | **~1,693** |
| measured RMR **1,325** × 1.2 sedentary, the app's own formula baseline | **~1,590** + measured movement |

At ~3,300 steps/day, movement above the sedentary assumption is worth roughly 100–200 kcal, which
puts a bottom-up estimate around **1,700–1,800** — consistent with the first two. **2,245 would
require about 650 kcal/day of activity above resting**, which this owner's step count and training
log do not contain.

**Best estimate: ~1,700–1,800 kcal, so the card is 450–550 kcal high.** State the direction and
size with confidence; treat the replacement figure as provisional — ten trustworthy intake days, all
inside two weeks, is not enough to settle it.

**⚠ One error this analysis cannot rule out, and it points the same way as the complaint.** Every
number above trusts the intake log. If portions or cooking oils are systematically under-counted,
true maintenance is **higher** than any figure here — which would make the app's number less wrong,
not more right, since it would still have arrived there by luck rather than from the slope it
actually used.

**⛔ Do not "fix" this by counting part-logged days.** Including every day with any food logged
gives **1,495** over 28 days and **1,954** over 14 — worse in both directions, and exactly the
failure Q-387 documented. The completion flag is doing its job; the window selection is not.

## 5. What the owner is shown

`TdeeAdaptationCard` renders the maintenance figure and a one-tap **Use 2,045** that writes straight
into the calorie goal via `PUT /api/nutrition/targets`. This estimate's confidence is **`low`**
(coverage 0.714, below the 0.85 medium threshold) — and the card **does not render confidence at
all**, while its two siblings, `energy-card.tsx:260` and `calorie-balance-bar.tsx:100`, both print
*"(low confidence, 10 of 14 days logged)"* next to the same number.

**The one surface that can act on the estimate is the one surface that hides how good it is.**

## 6. Proposed direction — owner's call (TN-27)

1. **Prefer the window with the tighter slope, not the higher coverage.** Both windows share their
   mean intake here, so coverage cannot distinguish them; slope standard error can, and it is
   already computable from the fit.
2. **Judge coverage over the days that could have been logged**, not over the whole window. Ten of
   ten since complete-logging began is not the same fact as ten of twenty-eight, and the current
   ratio cannot tell them apart.
3. **Widen the window rather than narrow it when coverage fails.** The failure mode should be *the
   estimate waits or gets calmer*, never *the estimate gets louder* — which is Q-387's own principle
   applied to window choice instead of to day choice.

Cheapest correct subset, if only one lands: **stop falling back from a rejected long window to a
short one**. Reporting `logging_too_sparse` and holding the formula baseline (~1,590 + movement)
would have shown this owner a number within ~150 kcal of the truth instead of one 550 kcal above it.

---

## 7. The recommendation, and the third estimate that settles it

**Owner, 2026-09-09:** *"1600-1800 for me sounds right… from that I wonder if we could estimate the
activity level value or tune how we do ours."* Those turn out to be one question, because **the
activity factor is the sanity gate the maintenance estimator is missing.**

### The app already owns a second, independent estimate — and never consults it

`computeActiveEnergy` measures this owner's movement every day from steps, logged activities and
workouts. Run over the same 28 days (2026-08-12 → 09-08), using the app's own code:

| | |
|---|---|
| `personalRmr` from the measured RMR 1,325, rescaled to today's FFM 52.4 kg | **1,345 kcal** |
| × 1.2 sedentary base | **1,614** |
| average measured movement (3,572 steps/day + training) | **+281** |
| **measured-movement maintenance** | **1,895** |

**No scale weight enters this at all.** It is built from resting rate and measured movement, so it
fails in completely different ways from the intake-and-weight calibration — which is exactly what
makes it a usable cross-check. And it is *already computed*, on the same request, as the formula
fallback. It is simply never compared against the calibrated number that overrides it.

### Read as an activity factor, 2,245 is self-evidently wrong

Divide each estimate by the measured resting rate of 1,345:

| estimate | maintenance | **activity factor** | what that factor means |
|---|---|---|---|
| 28-day calibration | 1,654 | **1.23** | just above sedentary |
| 30-day scale trend | ~1,693 | **1.26** | sedentary–light |
| **measured movement** | **1,895** | **1.41** | lightly-to-moderately active |
| **shipped card** | **2,245** | **1.67** | *hard exercise 6–7 days a week* |

**A factor of 1.67 for someone averaging 3,572 steps a day is not a metabolism, it is an artefact.**
The first three cluster at **1.23–1.41**; the fourth is a fifth again above the highest of them.

### So: gate on the activity factor, not on logging coverage

**This is the recommendation, and it is better than any of TN-27's three window options because it
holds whichever window wins.** `estimateMaintenance` already receives the user's BMR as
`minMaintenanceKcal` (Q-517) and uses it as a one-sided floor. Make it two-sided: reject a
calibration whose implied factor falls outside a plausible band for this user's *measured* movement.

- It would have rejected **2,245** (1.67) outright and fallen back to a number near 1,895.
- Q-517's `below_bmr` floor is the same idea already half-built — a maintenance below resting burn is
  impossible by definition. A maintenance implying training this user demonstrably did not do is
  impossible by measurement, and the app holds the measurement.
- It needs no new data, no new window, and no owner input.

**Order of work:** the factor gate first (it is the one that holds regardless), then TN-27 option 3 —
stop falling back from a rejected long window to a short one. The two window-rule options above it
are genuine improvements and can wait.

### On the self-reported activity level — worth fixing, but not for calories

`users.activity_level` reads **`moderate`**; the measured factor is **1.41**, between light (1.375)
and moderate (1.55). One notch high, as self-report usually is.

**⚠ Its blast radius is smaller than it looks, and overstating it would be wrong.** Q-401 already
removed `ACTIVITY_MULTIPLIERS` from the calorie path, so this field no longer touches the daily
target. What it still reaches:

- **VO₂max — the crosscheck only, not the headline.** `deriveVo2Max` returns Uth-Sørensen (55.0)
  regardless; the Jackson non-exercise crosscheck moves 37.3 → 41.1 between light and moderate.
- **Step goal** — `moderate` maps to 10,000, but the owner set 7,000 by hand and manual wins
  (owner decision, 2026-08-31), so this is already overridden.
- **Water goal** — +250 ml at moderate against 0 at light.
- **The AI coach and readiness payload**, which are told "moderate" as context.

So the fix is worth making and is not urgent: **show the measured factor and offer it, rather than
asking the user to grade themselves.** The measurement exists; the self-report is a guess sitting
next to it.

### What the owner should eat

Goal is `recomp`, so `CALORIE_ADJUSTMENT_BY_GOAL` is **−200**.

| maintenance | daily target |
|---|---|
| 1,654 (calibration, conservative) | 1,454 |
| ~1,750 (midpoint of the three) | ~1,550 |
| 1,895 (measured movement) | 1,695 |

**A target of 1,450–1,700, and the stored 1,660 sits inside it.** Keeping it was the right call;
the **2,045** the card offered was not. If the owner wants the middle rather than the top of the
band, ~1,550–1,600 is the number — but 1,660 needs no correction, which is the more useful answer.
