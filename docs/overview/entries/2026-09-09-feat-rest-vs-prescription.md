## 2026-09-09 — What the plan asks for rest, against what you take (Q-300, Lane B)

**The owner was asked and chose to surface it.** Q-300's residue had been gated on *"once the owner
has seen the framing"* — a gate stated only in prose until earlier today, so the queue tool had been
offering it as startable UI work. Put to them directly with the measurement, they took **a plain fact
card** over dropping it.

**The framing is the finding, and the obvious one is wrong.** Across 344 sets in 27 sessions, 39.8%
are "rushed" against their prescription — but *uniformly*: no session is rush-free, none is mostly
rushed, mean 0.411 with sd 0.138. "You rushed today" is meaningless when every day is that day. What
the same data says instead:

| planned | mean actual | |
|---|---|---|
| 60 s | **75 s** | longer than asked |
| 90 s | 65 s | |
| 120 s | 110 s | |
| 187 s | 133 s | |

Prescribed rest spans 60–187 s; actual spans 65–133 s. The plan is **compressed toward a personal
pace** rather than followed, and at the shortest prescription it is exceeded. That is a fact about
the prescriptions being unrealistic or unnoticed, not about the lifter running late.

**So the card carries no score, no verdict and no nudge.** Prescription, rest taken, signed
difference, set count. The difference is not coloured — red for "less rest" would make it a
scorecard, which is exactly the reading the uniformity rules out.

**One sentence, and it is three-state.** *"Your rest sits in a narrower range than the plan asks
for"* appears only when the actual span is ≤ ⅔ of the planned span. On a single prescription there
is no span, and `compressed` returns **null** rather than false — printing "your rest follows the
plan" there would state the opposite of what is known. That distinction has its own test.

**It reads `set_logs.planned_rest_sec`, not the live style, and that is deliberate.** The snapshot is
what was prescribed *at log time*; deriving it from the style would let a later style edit silently
rewrite what "prescribed" meant for a past set. The `rest-adherence` trend it sits under does derive
from the style — right for its question (does adherence track performance?), wrong for this one.

**A second Lane A gap, and the same one as this morning.** The fields are in the local store and no
route publishes them, so the card is **absent in a browser** and the e2e can only assert its absence.
That is the second device-only, CI-unverifiable surface shipped today — the reta weight-response card
was the first — so it is filed once as a class, **LB-98**, rather than per feature.

**Verification.** 13 unit tests on the pure module, including the production shape, the exceeded
shortest prescription, the noisy-mean floor, and the null-vs-false compression state.
`health-tabs-instant-paint.spec.ts` green (5 passed) — the Trends section takes a new prop and still
renders. `pnpm lint` 0 errors, `npx tsc --noEmit` clean, 120 unit tests in `components/health`,
`pnpm check:rules` **Ran 71 of 71**.

**Not exercised.** The device, which is the only place this card renders at all: the numbers, and
whether a four-row table reads well under the trend bars on a 412 dp screen.

**Version.** 1.445.0 — minor; a new thing on an existing screen.
