# 2026-08-05 — Q-75: eight surfaces stop publishing untested claims about the owner's body

**Domain:** platform · readiness · sleep — v1.258.2, JS/server-only (no APK rebuild)

`correlationInsight` backs all seven `/api/health-trends` views plus `/api/sleep-performance-correlation`.
It took the highest- and lowest-average bucket, required three observations each, and rendered a
confident sentence whenever they differed by more than **one raw unit** — a threshold that is
unit-blind, so one percentage point in a percent-of-baseline view weighed the same as one whole point
on a 1–5 scale. No significance test. No sample size shown. No control for anything.

The 2026-08-05 data review checked five strong-looking production correlations against controls the
engine does not apply. **All five failed.** Three vanished once the date trend was removed, one was
an artefact of degenerate rows, and one reversed direction under correct variable coding. The engine
would have shipped every one as a finding about the owner's own body.

## The gate

Four checks in order, each with its own copy — because *"we checked and found nothing"* and *"we did
not check"* must never read the same, which is exactly what the single old fallback string did:

| check | withheld as | when |
|---|---|---|
| bucket eligibility | — | fewer than 2 buckets with ≥ **5** observations (was 3) |
| sample size | `sample` | fewer than 20 paired observations |
| significance | `significance` | two-tailed p > 0.05 for Pearson r |
| calendar confounder | `confounded` | r survives, but partial r controlling for day index does not |
| effect size | `effect` | best and worst buckets differ by ≤ 1 unit (the original check, kept) |

A claim that survives all four now renders with its sample size attached — `… (45 paired days)`. The
route responses carry `stats: { n, r, p, partialR, partialP }` and `withheld` so a caller can show or
audit the numbers.

**The confounder control is the one that mattered.** Overnight HRV correlates with the calendar at
r = 0.79 in this user's data, so anything else drifting with date correlates with HRV for free. Six
of the eight views now pass a day index; `soreness-volume` does not, because
`sorenessVsVolumePoints` returns bare pairs with no date attached — stated in a comment at the call
site rather than silently omitted. Significance still applies there.

**Why Fisher z rather than a Student-t.** The exact test needs an incomplete beta function; Fisher z
with a normal CDF is a few lines and is accurate from roughly n ≥ 10. This is a *filter*, not a
published statistic — its job is to stop an unchecked claim reaching the owner — and the n ≥ 20 floor
refuses anything small enough for the approximation to matter. Recorded in the function's own
comment so the next reader doesn't have to re-derive the trade.

`pearson` returns **null**, not 0, for a constant series. Zero would read as "measured, no
relationship"; null is "cannot be measured", and the gate treats them differently.

## Verified end-to-end, not just in unit tests

The unit tests (22, up from 9) cover each gate independently, including a deterministic
calendar-confounder fixture and the escape hatch that keeps the old behaviour when no pairs are
supplied — that path must never start claiming significance it never computed.

But the interesting question was whether the **wiring** works — whether the raw pairs actually reach
the engine from a real route. Seeded 45 days into the local DB where readiness and perceived recovery
both rise with the calendar and nothing else, then called `/api/health-trends?view=subjective-recovery`
through an authenticated browser session:

```
insight : This pattern disappears once the calendar trend is removed —
          both measures have simply been drifting together over 45 days.
withheld: confounded
stats   : { n: 45, r: 0.784, p: 0, partialR: 0.108, partialP: 0.483 }
buckets : <50 → 1.5 (n 10) · 50–65 → 2.6 (n 14) · 65–80 → 3.5 (n 16) · 80+ → 4.6 (n 5)
```

**r = 0.784 raw, 0.108 once the calendar is partialled out** — the same shape the review measured for
HRV vs date (r = 0.79). The old engine would have published *"You feel most recovered (4.6/5) after
80+ readiness nights, vs 1.5/5 after <50"* as a finding. Seeded rows removed afterwards.

All ten correlation endpoints return 200. Full suite: **395 files, 3,129 tests, no failures and no
flakes.** Typecheck, lint (0 errors) and all four custom-rule checks pass.

## What this changes for the owner

Several trend views will go quiet, and that is the point — they were quiet-worthy all along. A view
that now says *"No reliable relationship across 45 paired days"* is not a regression from one that
said something confident; it is the first honest answer it has given.

Raising `minCount` 3 → 5 also removes a class of headline where a single bucket of exactly three
observations set the sentence.

**Not done here:** the review's Q-76 (degenerate sleep rows reaching every sleep consumer) is a
separate defect and one of the five failure modes above. The gate does not fix bad input, only
unjustified conclusions — a correlation computed over degenerate rows can still be significant.
Q-77/Q-78/Q-79 propose new views; they now inherit the gate rather than the flaw, which is why this
item was ranked ahead of them.
