# 2026-08-02 — a provisional readiness factor rendered its weight as if it were a score (Q-45)

_Branch `fix/provisional-contributor-bar` · PR #1007 · v1.250.9 · domain `readiness`_

Filed during Q-43 (#994) and taken as the next ready item after the run-list's item 11.

## What was wrong

`CompositeBreakdown` (`components/health/readiness-breakdown.tsx`) fell back to
`Math.round(weightPct / 0.17)` when a contributor had no real sub-score, and `FactorBar` rendered
that number in the trailing slot — the same slot, same weight, same tabular font a real 0-100
sub-score uses. A user with no resting-HR data at all saw **"Resting heart rate 88"**, with the bar
88% full in brand colour. Nothing on the row said it wasn't a measurement.

Three things made it worse than a cosmetic slip:

- **The 0.17 divisor was stale.** It normalised against a top weight that no longer exists — the
  2026-07-22 recalibration moved the heaviest factor to 0.16 — so the number was not even a faithful
  rendering of the weight.
- **Provisional factors sorted as if scored.** A provisional contributor carries the neutral `50`
  placeholder, and the sort read it, so they interleaved among real scores at the 50 mark.
- **Q-43 made it common.** It was always reachable, but Q-43 routes anyone without a ring — and
  anyone inside the 14-night baseline warm-up — through the provisional path.

The detail cards below the bars were already honest: `ContributorDetail` renders **"Learning"** for a
provisional factor. Only the summary row lied, which is why this survived.

## What changed

`FactorBar` gains two optional props — `valueLabel` (text after the bar, defaulting to `value`) and
`muted` (render it in muted-foreground rather than the bar colour). The three call sites that pass
real scores are untouched.

`CompositeBreakdown` now, for a factor with no real sub-score:

- fills the bar to the factor's **weight** and labels it `15%`, so bar and label agree. Keeping the
  old relative-to-top normalisation would have left a nearly-full grey bar next to a "15%" label, and
  a nearly-full bar still reads as "good" whatever the label says;
- sorts provisional factors **last**, by weight, rather than by their `50` placeholder;
- adds one line under the bars: *"Factors still learning your baseline show how much they count (%)
  instead of a score."*

The stale `0.17` is gone rather than corrected — nothing normalises against a top weight any more.

## Verification

Reproduced on the dev server at the S25 viewport (412 × 915), where six of nine contributors are
provisional. Before: `Resting heart rate 88`, `HRV balance 88`, `Body temperature 59`, interleaved
among the real scores. After:

```
Previous day activity  42      ← real scores, worst first
Activity balance       42
Previous night         82
Resting heart rate     15%     ← provisional, by weight
HRV balance            15%
Body temperature       10%
Sleep balance          10%
Morning check-in       10%
Recovery index          9%
```

Checked in **both dark and light** theme — the muted label is legible in each.

Nothing native, offline-first or safe-area related is touched; this is presentation-layer only, and
the readiness payload is unchanged.
