# Home stops telling an empty account things that are not true — and one "stray mark" was the night sky

Implementation Lane B, 2026-09-27. `RV-211` items ①②③; ⑤ closed as not-a-defect; ④ parked, ⑥ open.

## What shipped

Rendered on the zero-data account at 412 px dark, which is the only way to reach any of it:

1. **No "Your week in review is ready"** for a week with nothing in it.
2. **Body Battery reads "No data yet · —"** instead of "Good · Steady · 50" — no band, no trend, no
   number, a no-signal icon in place of a battery-level one, and an empty progress track.
3. **The week strip shows "—"** for past days when there is no program, instead of "rest".

## The digest text cannot answer "was this week empty"

`buildWeeklyDigestText` always writes at least *"0 sessions, 0 kg total — first week of data"* and
*"No personal records this week"*, so the banner's `content` is never falsy and the week always
looked ready. The route already returns `metrics` beside the digest, which is what kept this in
Lane B rather than handing it to A.

`weekHasAnything` **ignores `weightChangeKg` and `hrv.source` on purpose**: both are computed across
the *two-week* window, so either can be populated by the prior week alone and would announce a week
that had nothing in it. Every `WeekOverWeek.week` it does read is the recap week's own value.

## The progress bar was not in the entry, and no source guard would have found it

The unit test pins the Body Battery header's conditions and they were all correct — while the bar
underneath still drew a 50% fill, which is the same claim in the more legible of the two places.
The e2e render caught it. That is the case for keeping that spec despite its runtime.

This continues `RV-38` rather than undoing it. That entry found the "Limited data" chip got *weaker*
as the data got worse and fixed it by keying on `!conf.sufficient`; that condition is untouched, and
`noData` only ever adds a stronger statement on top. The unit test pins both, so a future edit
cannot quietly re-gate the chip on `hasData`.

## Item ⑤ is not a defect — it is the background

The "dot between the Resting HR and Sleep rings" is a **star**.
`components/dynamic-background/particles.tsx` draws 18 of them at `Math.random()` positions, 1–2.5
px, mounted globally through the weather overlay. Four are visible in the zero-data render, in four
unrelated places — which is the tell: a per-card mark does not scatter. The "·" in the "Limited
data" chip is that chip's own `SignalLow` glyph at 12 px; there is no `·` character in the file.

**A source grep first said "does not reproduce", and that was the wrong conclusion.** The marks are
real on screen; they are simply not stray. Only rendering it separated the two.

## What the entry did not name, found on the way

The week strip's aria-label said ", rest day" for **every** session-less day, future ones included —
so a screen reader called next Friday a rest day. Fixed with the rest of item ③.

## Not exercised

**Not verified on device.** The three fixes are empty-state only, so the owner's own account is
unaffected by all of them — which also means a device pass adds little here and is not claimed as
owed. What *is* owed is item ⑥, which needs either the seeded render or the phone: the score-ring
row returns null when every score is null, so the zero-data account cannot reach it at all.

## Found on the way out: the E2E job no longer fits its own limit

Waiting on `#1760`'s advisory E2E — which it touched, so the lane's rule said to wait — produced
this instead of a verdict: the job ran **45m16s** and was killed by its own `timeout-minutes`,
annotated *"The job has exceeded the maximum execution time of 45m0s"*. The six specs it named had
all hit "Test timeout", across six unrelated areas, and none of them was the spec that PR added.

**It reports as `cancelled`, not `failure`**, which is also what a superseding push produces — so
the honest signal is indistinguishable from the harmless one unless you read the duration. Three
peer PRs the same hour reported E2E `success` in **42, 42 and 52 seconds**, because
`e2e-ui-touched.js` short-circuits the job when no UI is touched: the suite runs in full only on
the PRs that most need it, which is exactly when it exceeds its budget.

Filed as **`LB-166`**, with `Needs: LB-149` — that entry's 1.0s browser-death signature may be the
same saturation from the other end, and neither is established. `#1760` merged on its five required
green checks, which is what "E2E is advisory" is configured for.
