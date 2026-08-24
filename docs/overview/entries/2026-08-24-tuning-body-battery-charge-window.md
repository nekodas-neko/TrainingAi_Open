# 2026-08-24 — the Body Battery charge window closed, and daytime stress is recorded only as a day total

*Tuning · docs-only · branch `claude/tuning-agent-orientation-jx0zah`*

Owner asked two things in one message: whether daytime stress is a real number that could go on the
HR graphs, and why Body Battery had been sitting at 0 since well before 9:19pm.

**Daytime stress is real and already rendered** — populated 31 of 31 days, and
`components/body-battery/stress-strip.tsx` has been drawing today's series inside the Body Battery
card the whole time. The owner did not know it was there. What is *not* recorded is the per-bucket
series: `summarizeStressDay` keeps three daily scalars and discards the 30-minute buckets, so
"which hours are worst" is unanswerable from storage. The daily scalar alone will not stand in for it
— its range is −0.14 … +0.23 (sd 0.100) on a [−1,+1] scale, while 22 of 31 days carry high-stress
minutes averaging 50/day.

**The battery floors because the charge window is unreachable.** Charging needs
`HR ≤ restingHr + 0.05 × reserve` = **57.8 bpm**, against a 5th-percentile waking HR of **62** and a
median of **86** — a time-weighted **0.5%** of the waking day. Today: anchor 57, charged **1**,
drained **79**, empty by ~12:30pm. Both causes are the data being right: resting HR fell 67 → 52, and
`hrMax` fell 187 → 168 on 2026-08-05 when observed-peak resolution took over. Q-515's mechanism,
now with a consequence anyone can see.

Filed **TN-2** (fit an explicit waking-rest bpm offset — owner signed off on the direction, bracket
+8 … +12 with a pass test), **TN-3a** (persist the buckets, back-fill from the rollup path),
**TN-3b** (the HR-chart overlay and an hours view, blocked on TN-3a), and **TN-4** — 31 × HTTP 500 on
`/api/body-battery` across ten hours on 2026-08-23 that stopped on its own and is recorded as
unexplained rather than closed.

Two method notes worth more than the findings. A per-sample percentile on this HR series is **not** a
per-time percentile — the ring power-gates its PPG, and the uncorrected number read ~20% where the
time-weighted answer is 1.6%. And the first replacement tried, +18 bpm, overshot into a permanently
full tank (mean 90.8, a third of days pinned at 100); "it floors too often" invites exactly that.

Review: [`docs/reviews/2026-08-24-body-battery-charge-window-collapse.md`](../../reviews/2026-08-24-body-battery-charge-window-collapse.md).

**Not exercised:** no code ran. SQL against production plus source reading — no `pnpm dev`, no
device, no APK, no native or offline path. The replay is a SQL re-implementation of the route's
arithmetic, agreeing with stored values to 13 points mean absolute error; it is evidence for a
proposal, not a substitute for fitting against the shipped TypeScript.
