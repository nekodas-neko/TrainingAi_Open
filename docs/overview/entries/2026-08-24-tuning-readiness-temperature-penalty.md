# 2026-08-24 — readiness carries a −16 point temperature penalty on 89% of days

*Tuning · docs-only · branch `tuning/readiness-deload-trigger`*

Owner sent a Home screenshot — *"Body temp elevated · +0.5°C above your baseline"*, readiness 52,
Recovery recommended — with *"its often triggering deload days. its not trustable yet."* Both halves
of that are right.

`computeBlendedScore` (`readiness-payload.ts:169`) subtracts on an **absolute °C** ladder: −10 past
0.3 °C, −20 past 0.5 °C, score capped at 40 past 1.0 °C. That is a different path from the `tempZ`
one Q-506 covers, and **nothing was queued against it**.

Over the 34 nights holding a stored deviation, the **−10 arm fires on 91.2%, the −20 arm on 67.6%,
and the cap-at-40 arm on 17.6%**. Only 3 nights in 34 escape a penalty, and the stored deviation is
**positive on all 34** — which is not what a deviation from a baseline looks like.

The cause is that the baseline mean never converged. Measured nightly temp is **35.827 °C (sd
0.140)**; the stored baseline reads **35.464 °C**, so it is **0.363 °C low — enough to clear the 0.3
threshold before the night's real variation is considered**. The EMA cold-started at 34.696 °C and
has climbed +0.767 over 36 nights: converging, still short at 50 nights of history. Replacing it with
a trailing mean takes the mean penalty from **−16.3 to −0.4 points/day** and puts 16 of 27 nights
below baseline instead of none.

**The same object's sd is ~13× too wide** (1.82 °C against a true 0.140), which is Q-506 reproduced
from a different table. So one broken baseline is failing two consumers in opposite directions — the
wide sd divides `tempZ` to nothing so the illness radar can never fire, the low mean makes the
absolute deviation permanently positive so readiness is penalised daily. Filed **TN-6** and batched
with Q-506 as `temperature-baseline`, because correcting one half would look like it fixed both.

The 0.3/0.5/1.0 ladder is **not** the lever — against a true sd of 0.140 °C it sits at 2.1/3.6/7.1 sd,
which is defensible. Fourth instance of "the threshold is right, the input is wrong" in this pillar
after Q-506, Q-512 and Q-514.

Review: [`docs/reviews/2026-08-24-readiness-temperature-penalty.md`](../../reviews/2026-08-24-readiness-temperature-penalty.md).

**Not established:** whether the owner was actually ill on any flagged night — the finding is that a
permanently-positive deviation cannot tell illness from baseline error. **Not exercised:** no code
ran; SQL against production plus source reading, no device or `pnpm dev`.
