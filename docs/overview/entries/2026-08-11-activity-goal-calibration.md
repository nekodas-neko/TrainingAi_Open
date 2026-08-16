# 2026-08-11 — the Activity Score's goals, worked up rather than patched (Q-137)

**Branch:** `fix/activity-score-step-counter` · **Domain:** `activity`, `readiness` · docs only,
no version bump

Q-137 was filed ⛔ *needs an owner decision before code*, with three options. Asked to pick, the
owner said the goals should be **scientifically calibrated** first — so the deliverable is a design
discussion, not a patch: [`docs/activity-goal-calibration.md`](../../activity-goal-calibration.md).

## Every premise re-verified against production, and each got sharper

The entry's numbers were four days old and this session had already found six of eight backlog
premises not surviving contact with the code. These survived:

| filed | measured 2026-08-11 |
|---|---|
| `activeEnergy` lost at the BLE re-key | last input **2026-07-07** — the re-key date exactly, 34 days dead |
| `strengthFreq` pinned at 100 | **4.9 sessions/wk** vs goal **3** → ratio 1.63, and `STRENGTH_FREQ_CURVE` caps at 100 from ratio **1.0**. Pinned *structurally*, not just observed |
| "57 of 100 weight is constant" | holds |

**Restated as an outcome**, which the entry never did: the score's own 30-day spread is **mean 74.3,
sd 5.9, range 60–81**, while steps runs **sd 4,028** on a mean of **6,959**. The input swings ±58%
of its mean; the output moves inside a 21-point band. That is the finding in the form the owner
actually experiences it.

## What the investigation changed about the options

- **Option (a) — re-anchor to the user's baseline — partly reverses a deliberate decision.** The
  model's own header says the 2026-07-22 rewrite moved *away* from self-referential scoring because
  "a lazy week lowered the bar". Any rolling-baseline goal reintroduces exactly that, plus a
  treadmill: train harder, the target rises, the score stays 74. The entry did not flag this. The
  doc proposes fixed *personal* goals instead — absolute meaning kept, target made to fit.
- **Option (c) — a BLE replacement for `activeEnergy` — is bigger than it reads, and also nearly
  free in an unexpected way.** `activeCaloriesEst` already exists end-to-end: Zod schema, column,
  adapter write, `getSyncDelta` mapping, local SQLite column, pull mapping. **0 of 42 days
  populated** — the pipe is complete and the device never computes a value to put in it. So the
  work is Kotlin plus an APK, not wiring. Split out as **Q-184**.
- **The industry has converged, and not on our approach.** Every app that handles strength training
  well measures **HR-derived load** (Whoop Strain, Strava Relative Effort, Garmin Training Load).
  The ones counting threshold-minutes — Garmin Intensity Minutes, Apple Exercise — all bolt a
  second, load-based metric alongside. We have continuous HR from both the ring and the chest strap,
  and `training_load_ots` already on the table.

## One worry closed

Only 15 of 30 days had an activity score, which looked like an ongoing rollup gap. Checked: the
missing days are **contiguous and all precede 2026-07-28**, and every day since has one. That is the
score's start date, not a fault. Recorded so nobody re-investigates it.

## Filed

- **Q-183** — `zoneMinutes` scores a lifter's *structural* zero as a genuine 0 at full weight (10),
  while absent data is correctly excluded and renormalised. Zone 1 starts ~60% HRR, which lifting
  with rest rarely sustains. Owner-approved; goes **first**, because no goal re-anchoring fixes it.
- **Q-184** — the empty `active_calories_est` pipe above.

## Blocked on the owner

Direction A / B / C in §5 of the doc, and if A or C, the actual target values (strength
sessions/week, move hours/day, weekly volume). Steps at 8,000 measures against a mean of 6,959 and
is the one goal doing real work — I would leave it.

## Not exercised

No code changed, so nothing to exercise. The production figures come from the read-only
`claude_ro` views, which are **row-scoped to the owner's account only** — every count here is the
owner's data, not a system-wide claim.
