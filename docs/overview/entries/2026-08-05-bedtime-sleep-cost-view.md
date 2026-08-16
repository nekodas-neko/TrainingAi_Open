# 2026-08-05 — Q-77: the strongest finding in the dataset, and the coding that inverts it

**Domain:** sleep — v1.262.0, JS/server only (no `android/**`, no migration)

`GET /api/health-trends?view=bedtime-sleep`, surfaced as a **Bedtime vs sleep** pill in the Health
screen's Trends card.

The measurement it ships (taken against production before any code was written): bedtime → sleep
duration **r|t = −0.534, p < 0.001, n = 52**, a slope of **−0.70 h of sleep per hour later to bed**,
and the wake time does not compensate. Bucketed: before 22:00 → 8.15 h (n = 13), 22:00–23:00 →
7.74 h (n = 33), after 23:00 → 6.92 h (n = 6). It is the only finding in the review that survives
Bonferroni across the ~60 pairs tested.

## The part that needed a test, not a comment

Bedtimes wrap at midnight. Encoded as a raw clock hour, 00:30 scores 0.5 and 22:30 scores 22.5 — so
the *latest* nights sit at the *bottom* of the scale and the relationship reverses. The review's own
first pass hit this and got **r = +0.75**, reading as "later bedtime → better sleep" at high
apparent significance.

`minutesFromNoon` (`packages/shared/src/health/sleep-consistency.ts`) already anchors at noon and
was written for exactly this. Using it is easy; *staying* on it through a future refactor is the
part a comment cannot guarantee, so the route test flips to raw-clock coding and asserts red:

```
× finds the real relationship and reports it as significant
    AssertionError: expected 0.768 to be less than -0.5
× does not invert across the midnight boundary
    AssertionError: expected 8.6 to be less than 6.5
```

**r = +0.768** against the review's measured +0.75 — the guard reproduces the original failure, not
an approximation of it. A third test seeds ten 12-minute evening dozes on dates that already have a
night and asserts `n` is unchanged; dropped back to raw `listSleepSessions` it fails with
`expected 40 to be 30`.

## Built on the Q-76 helper, not beside it

The view reads `nightSessions(rows, tz)`, which shipped hours earlier in v1.261.0. A nap coded as a
bedtime is a spuriously "early" point with almost no sleep attached — precisely the shape that
steepens the slope and makes the finding look stronger than it is. Significance gating is inherited
from Q-75 (v1.258.2) with no new code: `correlationInsight` already applies n ≥ 20, p ≤ 0.05 and a
partial correlation controlling for the day index, and this view passes its `control` series.

Cache invalidation needed nothing either — the `health-trends:` prefix family is already in the
health-write groups, so a new sleep row clears the view.

## Deliberately not built

**Bedtime → deep sleep** (r|t = −0.301, p = 0.038). It does not survive Bonferroni across the ~60
pairs the review tested, and the bucket bars render one value per bucket, so adding it means a
second series and a second claim of lower quality than the first. Recorded rather than shipped.

## One thing fixed on the way past

`CorrelationBars` signed every value: `+92` for a sleep-efficiency percentage, `+3.0` for a 1–5
recovery rating. Only three of the seven views (`rest-adherence`, `recovery-vs-strength`,
`energy-balance`) are baseline deltas where a sign means anything; the rest are absolute readings,
and this view's `+8.2 h` would have read as a change that did not happen. `SIGNED_VIEWS` in
`trends-section.tsx` now decides, and the red-for-negative colour follows the same flag.

## Verification

Full suite **398 files / 3,148 tests green**. All seven existing trend views plus the new one
exercised against `pnpm dev` with a logged-in session — every one 200, with the new view bucketing
the seed's rows correctly (a 09:00 sleep start is 21 h after noon, so it lands in `after 23:00`,
which is the right answer for that data) and `hasSufficientData: false` because only one bucket
clears the 5-observation floor. That is the gate working.

**Not exercised:** the S25 viewport. The Trends pill row is a horizontal scroller and now carries
eight pills instead of seven; it was not viewed on device or at ≤640px in a browser. No native,
safe-area, gesture or notification surface is involved, so there is no device-verification gate —
but the pill row's overflow behaviour with the extra item is unverified visually.
