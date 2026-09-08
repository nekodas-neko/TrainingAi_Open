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
