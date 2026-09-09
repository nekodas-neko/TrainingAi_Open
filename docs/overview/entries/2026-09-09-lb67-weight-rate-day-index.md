# 2026-09-09 — the weekly weight rate was measuring per weigh-in, not per day (LB-67)

**Branch:** `fix/weekly-weight-rate-day-index` · **v1.441.5** · user-visible.

`computeWeightRateKgPerWeek(weights: number[])` fitted `x = the array index` and multiplied the
slope by 7 as though the readings were one day apart. Rows exist only on days carrying a metric and
the owner weighs in about three days in four, so the slope was *per reading* and reported as *per
day*.

On a 14-day window with a true trend of −0.70 kg/wk: 10 readings reported **−1.04** (1.48× over), 6
reported **−1.76** (2.51× over).

**That changed what the screen said, not just the digits.** `evaluateWeightRateVsGoalBand` calls
anything past 1.0 kg/wk `too_fast`, so an ordinary, healthy −0.70 rendered on Health → Body as
**"Faster than ideal pace"** in amber.

## One formula, not two

The correct version already existed one directory away: `adaptive-tdee.ts` fits against the
weigh-in's day index and its comment names this exact failure. So the app held **two** weekly
weight-rate figures, computed differently, disagreeing by about 1.5× on the same data, on two
screens — which is what the One Formula rule is for.

Both now call `computeWeightRateFit`, which takes dated points, sorts them, drops null weights and
fits against days since the first weigh-in. (Only differences in x affect a slope, so a first-weigh-in
origin and a window-start origin agree — and this one needs no window handed in.)

**Verified before converging, not assumed:** `adaptive-tdee`'s day index is only a *day* index if its
caller supplies contiguous days. `energy-balance-service.ts` builds them with
`for (let d = windowStart; d < date; d = shiftDateStr(d, 1))`, so it does. Had it been gappy, the
"correct" sibling would have carried the same bug in a subtler form.

**Sibling sweep**, per the same rule: the only other `linearFit` callers are `projectRm`, which is
already day-spaced and is about 1RM, and `classifyTrend`, which is index-spaced *by design* with a
comment saying so and pointing dated series elsewhere. Two figures became one; there is no third.

## The standard error, added deliberately

OR-102b ④ was blocked on this formula and needs the *interval*, not the point estimate. Adding
`stdErrKgPerWeek` in the same pass is what stops ④ inventing a third estimator — which is the bug
class that produced this one. That entry is rewritten from "blocked on LB-67" to unblocked.

## The mutation pass found six survivors, and every one was a real gap

The worst score of this sweep, and worth recording rather than smoothing over:

- **The sort was untested.** A least-squares slope is order-invariant, so asserting the rate on a
  scrambled fixture proves nothing about sorting. The sort is load-bearing for `spanDays` (and the
  x origin), which is what the case now asserts.
- **The standard error's units were untested.** "Noisier is larger" holds whether or not the per-day
  error was scaled to per-week, so dropping the ×7 survived. Now pinned to a computed 0.241868.
- **The display rounding was untested.** Every fixture had a truth of exactly −0.7, where rounded
  and unrounded agree — the equal-values trap. A −0.49 case now separates them.
- **The unrounded-slope property was untested in `adaptive-tdee`**, which is the thing my own comment
  claimed mattered. A −0.9 kg fortnight now pins 2533 against the 2528 the rounded weekly rate
  would give.
- **One survivor was an equivalent mutant, checked rather than assumed.** A separate `Number.isNaN(day0)`
  guard is unreachable: a bad `day0` makes every x NaN, which the next guard already catches. The
  dead branch is deleted.

**And a correction to my own comment.** It claimed rounding the weekly rate first would move a
maintenance estimate "by up to ~55 kcal/day". The real bound is **~5 kcal/day**
(0.005 kg/wk ÷ 7 × 7,700), and the measured example moves 5. Both comments now state the measured
figure, and say plainly that the reason to keep the slope unrounded is not the size of that error but
that a display decision should not reach the kcal arithmetic.

**16 of 16 caught** after the fixes; the seventeenth is an equivalent mutant planted as a control.

## Gate

`pnpm lint` 0 errors · `npx tsc --noEmit` clean · `tsc -p tsconfig.tests.json` clean · **Custom Rules
70 of 70** · `pnpm build` clean · full suite **866 files, 8156 passed, 0 failed** · `adaptive-tdee`'s
own 31 cases unchanged, which is what "converged without moving its numbers" means.

**Not exercised:** no device. The Health → Body band is asserted through
`evaluateWeightRateVsGoalBand` in a unit test, not seen on a screen — **the amber "Faster than ideal
pace" has not been observed turning green on the S25.**
