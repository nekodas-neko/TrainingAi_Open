# 2026-09-15 — the sleep score pays you to take the ring off

**Tuning.** Docs-only. The owner pushed back on the core/adjustment design with a specific worry:
a user logging only bed and wake times could reach 100, and once staging arrives that alone should
no longer be enough. Checking the worry against the live weights found a worse defect than the one
the design was proposed to fix.

## The measurement

One night — 8 hours, consistent window, poor deep and REM, HRV below the personal baseline — run
through `sleep-score.ts`'s real renormalising formula:

| scored with | contributors | score |
|---|---|---:|
| ring | 10 of 10 | **74** |
| basic watch | 6 of 10 | 84 |
| phone or manual only | 3 of 10 | **92** |

Renormalising over whichever contributors are present means removing the ones dragging the score
down *raises* it. **The app pays 18 points for taking a sensor off.**

## Why that reframes the entry

TN-38 task C was filed on comparability — two users' 78s are computed from different weight sets.
That is true, abstract, and easy to defer. The same defect seen from the owner's angle is
**more information can only ever hurt you**, which is not deferrable and is the argument that
actually lands.

## The shape the objection forces

The core must **not** reach 100. Core tops out near 92 — *"as good as it looks from here"* —
adjustments run roughly −20 to +8 weighted toward deduction, and the night above lands on 74 either
way. A ring user's number is unchanged; taking the ring off now leaves 92 with lower confidence
rather than a free 18 points. 100 comes to mean *confirmed good by everything visible*.

Recorded with the alternative it rules out: capping the core far below 100 so that sensors only ever
add. That pins a phone-only user at 55, which reads as "you sleep badly" when the truth is "we
cannot see" — punishing someone for hardware they do not own is worse than an optimistic estimate
carried with a stated confidence.

**What stays the owner's is the input list per pillar, not this shape.**

## Not exercised

Docs-only; no code changed and nothing run on device. The three scores are one night's sub-scores
put through the real formula — a worked example chosen to expose the direction, not a measurement of
an actual logged night. The 18-point gap is a property of renormalisation and holds for any night
where the deeper contributors score below the shallow ones; it would invert on a night where they
score above.
