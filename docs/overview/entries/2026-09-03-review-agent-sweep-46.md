# Review sweep 46 — progression logic: exact adherence is not 1RM-neutral

**Date:** 2026-09-03 · **Agent:** 📖 Review · **Branch:** `claude/review-agent-sweep-46` · Docs only.

The owner asked for workout building and progression **logic**, plus nutrition and home — a
computation sweep rather than the access-control ones that came before it.

`packages/shared/src/1rm.ts` states an invariant in a comment, and the 2026-07-10 workout system
review repeated it as a strength of the module: *"prescriptionFactor making exact adherence
1RM-neutral"*. **It is not.** The neutrality holds for the exact prescribed weight and is broken by the
plate rounding that sits between the formula and the barbell.

Four steps: the prescription ceiling-rounds to the plate step (deliberately — *"slight overload is
better than underload"*); the lifter hits it; `prescriptionFactor` cancels the rep terms and leaves
`weight × 100/pct`, **amplifying the round-up by 1/pct**, 1.43× at 70%; the result exceeds the previous
1RM and becomes the next basis. Step one is documented. Nothing in either file mentions step three.

Measured over 1,201 starting 1RMs from 60.0 to 180.0 kg, 3×8 @70%, lifter hitting the prescription
exactly:

| step | p50 | p90 | max | unchanged | settles in |
|---|---|---|---|---|---|
| barbell 2.5 kg | **+2.60%** | +7.12% | **+13.55%** | 10/1201 | 3 sessions |
| dumbbell 1.25 kg | +1.30% | +5.04% | +10.46% | 20/1201 | 4 sessions |

**It converges rather than running away**, which caps the severity — the fixed point is the smallest
1RM whose working weight lands on a plate multiple. But `log-exercise.ts:327` feeds the estimate to
`upsertPersonalRecordIfBetter`, which is monotone, so the inflation becomes a permanent all-time PR
feeding the strength card, the digests and the year recap. The app cannot distinguish a lifter who got
stronger from one who followed instructions, and records the second as the first.

**The first simulation showed zero drift and was wrong.** It started at exactly 100 kg, where 70%, 60%,
65%, 75% and 85% are all whole plate multiples, so the ceiling never rounded anything — a fixture
chosen for tidiness hid the entire effect. That is why the table sweeps 1,201 starts instead of
quoting one.

**Not filed as "switch to nearest-rounding"**: the ceiling exists for a stated reason and nearest shows
the same ratchet at a lower median. The real question is whether the estimate should be computed from
the *prescribed* weight rather than the rounded one, which would make the invariant true as written —
a scoring decision, so `Gate: owner`.

**RV-44, low severity:** `atwater.ts` was created by LB-9 to end longhand Atwater factors and says so
in its header; `scan-totals.ts` (5 sites) and `meal-split.ts` (4) still write `* 4`/`* 4`/`* 9` and
import nothing. All nine agree and the factors are physiological constants, so **no number is wrong
today** — filed as consistency, not correctness.

**Clean, recorded as results.** Home's `scoreBand` is a single source and nothing re-derives the 70/50
thresholds with local labels — the divergence `CLAUDE.md` records finding twice before. And **AI-10
from the 2026-07-10 review is fixed**: `mround125Up` has zero call sites, superseded by the
equipment-aware `mroundStepUp`, so the card and the bar now round the same way.

**Not exercised:** the device; production — this is arithmetic against the shipped module, and none of
the owner's training data was read. The simulation is the idealised case where every prescribed rep is
hit, which is the intended path and the one case the stated invariant should hold exactly.

Write-up:
[`docs/reviews/2026-09-03-progression-exact-adherence-ratchet.md`](../../reviews/2026-09-03-progression-exact-adherence-ratchet.md).
