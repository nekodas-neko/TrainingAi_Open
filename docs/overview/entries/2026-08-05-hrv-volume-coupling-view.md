# 2026-08-05 — Q-78: the HRV signal was already on screen, scored against the wrong thing

**Domain:** readiness · workouts — v1.263.0, JS/server only (no `android/**`, no migration)

`GET /api/health-trends?view=hrv-volume`, surfaced as an **HRV vs volume** pill in the Trends card.

Measured against production before it was built: overnight HRV → same-day tonnage **r|t = +0.495,
p = 0.006, n = 30**. Split at the median (48 ms): **4,376 kg mean tonnage below vs 5,799 kg above —
a 33 % difference.**

## Why a second HRV view rather than an edit to the first

`recovery-vs-strength?metric=hrv` already scores the same overnight HRV. It scores it against **mean
1RM percent** — how heavy the lifts were relative to the user's own best — and produces a weaker
result. Volume is where the response shows. These are different questions about the same input, so
the honest shape is two views, not a re-pointed one.

Night RHR agrees in direction (r = −0.491) but does not clear the trend control (p|t = 0.079), so it
is not offered as a metric here. That is the point of having the control.

## Two coding decisions

**HRV as percent of a 28-day baseline, not raw ms.** The review's median split was at 48 ms, which is
a fact about one person's ring. `r` is unchanged by the rescale — only the buckets move — and the
percent coding is what the sibling HRV view already uses, so the two read consistently and neither
carries a boundary tuned to one body.

**Tonnage summed per DAY, not per session.** Two sessions on one date share the single overnight
reading that preceded them; emitting two points at the same x would double-weight that day and
inflate `n` against the significance gate. A test asserts `n` is unchanged when a second session
lands on an already-seeded day.

## What was deliberately not built

The backlog entry named a candidate second use: an input to the prescription engine. **Not done, and
the entry's own reasoning is why** — n = 30 does not survive Bonferroni across the ~60 pairs the
review tested. Surfacing it as an observation is safe; letting it move a prescription is not. The
route comment says so at the point where someone would be tempted.

The view is also gated by Q-75's engine with no new code: n ≥ 20, p ≤ 0.05, and a partial
correlation against the day index. A third test seeds twelve coupled days — enough to clear bucket
eligibility, short of the sample floor — and asserts `withheld: 'sample'` rather than a rendered
sentence.

## Verification

Full suite **399 files / 3,151 tests green**. All nine trend views exercised against `pnpm dev` with
a logged-in session — every one 200, `hrv-volume` bucketing the seed's seven paired days at 1.4 t
and correctly withholding.

One fixture mistake worth recording: the first version seeded `set_logs` and expected the route to
derive tonnage from them. `exercise_logs.volume` is a **stored column** written by the log path, not
computed at read time, so every point came back empty and the view read as broken when the fixture
was. The test now writes the column directly.

**Not exercised: the S25 viewport.** The Trends pill row now carries nine pills; it has not been
viewed on device or at ≤640px. Nothing native, safe-area, gesture or notification is involved, so
there is no device gate — the overflow behaviour is simply unverified visually, same as v1.262.0.
