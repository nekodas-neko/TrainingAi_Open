# 2026-08-26 — the five Home pillars, answered one at a time (TN-13…TN-16, Q-507 amended)

**Tuning · docs-only.** Owner: *"Overall the pillars are not working great and not very useful.
Requires tuning."* Six specific questions, each answered with a measurement rather than a reading of
the source. Full working: [`docs/reviews/2026-08-26-pillar-review.md`](../../reviews/2026-08-26-pillar-review.md).

## What each pillar turned out to be

**Heart Rate — "my value is 52; what is that?"** The **7-day average** resting HR. Over 50 nights the
nightly value moves **2.11 bpm** night to night and the tile's average moves **0.33** — it discards
**84%** of the daily movement, in the signal that predicts the owner's own check-in better than any
other (r = **+0.557**, best of nine). **TN-13**: show last night's value with its baseline delta.

**Sleep — "60 is way off."** Three causes, and the owner's 75–80 intuition matches the **blend**
(73.15); `SCORE_CALIBRATION` maps that to exactly 57, and TN-5's approved curve gives ≈63. The other
two are TN-10 (the duration curve's comment and anchors disagree by ~15 points) and a real autonomic
dip. **2026-08-19 still holds 3.50 h and still feeds every baseline** — **TN-14**.

**Activity — "how would I make this 100?"** You currently cannot. Over 30 days: mean 75.1, range
51–91, never 100. Two of the six contributors are structurally broken (`zoneMinutes` floored on 53/59
days, `activeEnergy` present on 8/51) and a third is meaningless (`moveHours`, 99.8% of hours qualify).

**Stress — "how real is it?"** It replicates **backwards**. n = 33: high-stress minutes correlate
**+0.386 with readiness** and **+0.477 with the sleep score** — the sleep correlation is stronger and
was untested in Q-507. Q-507 amended.

**Body Battery.** Both halves of the model the owner describes are absent: no overnight recharge at
all (`walkBodyBattery` filters to `tsMs >= wakeTime`), and drain that tracks wear time (Q-521).
**TN-15**, owner-signed-off, supersedes the standing "do not redesign the anchor" guidance.

**Readiness.** The one in the best shape: its two heaviest objective inputs genuinely track felt state.
Its problems are contaminated inputs already queued — TN-6, TN-9, Q-509.

## The part worth keeping: a hypothesis was refuted and not replaced

The obvious explanation for stress pointing the wrong way — better sleep → denser HRV signal → more
buckets scored → more minutes classified as anything — was **measured and refuted**: r = **−0.128**
against HR sample count. No replacement mechanism is established, and the entry says so rather than
reaching for a second story. That is why **TN-16** (the prolonged-stress warning and calm-down prompt
the owner asked for) is filed **parked behind Q-507** instead of built: a warning on this metric would
fire on the owner's best days, which is the Q-504 failure mode exactly.

## Verification

`pnpm check:rules` — **Ran 58 of 58 Custom Rules steps, all passed.** `check-backlog-pointers` OK.
**Failure surfaces not exercised: all of them.** No code ran — SQL against production plus source
reading; no `pnpm dev`, no device, no APK. Every correlation is same-day and single-subject
(n = 30–50); none establishes direction of causation. Counts are the owner's account only
(`claude_ro` is row-scoped).
