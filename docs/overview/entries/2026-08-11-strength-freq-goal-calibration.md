# 2026-08-11 — one number, two frozen contributors (Q-137/A)

**Branch:** `fix/strength-freq-goal-calibration` · **Domain:** `activity`, `readiness` · **v1.284.0**

`DEFAULT_STRENGTH_FREQ_GOAL` 3 → 5. That is the entire change, and it is smaller than Q-137 planned
because reading the code found the volume goal was never a stored value.

## Why one line moves two contributors

`strengthFreq` (weight **25**, the largest) is scored as `sessions7d / strengthFreqGoal` through a
curve that caps at 100 from ratio **1.0**. Measured over 91 days the owner trains **4.9/wk**, so
against a goal of 3 the ratio was 1.63 and the contributor was **exactly 100 on all 91 days** — it
had never once carried information.

The volume lane is derived from the same number:
`volTarget = typicalSessionVolumeKg × strengthFreqGoal`. At goal 3 that target was
4,700 × 3 = **14,100**, below even a weak week's 16,843 kg, so it clamped to 100 too. **45 of the
100 available weight was constant**, from one constant.

At 5, `volTarget` becomes 23,500 against a measured 25,159 weekly mean — a strong week still
reaches 100, a weak one does not.

## Proven, not asserted

The regression test uses the owner's real measured numbers (median session 4,700 kg; strong week
25,159 over 5 sessions; weak week 16,843 over 3) and pins all three properties:

| | goal 3 (old) | goal 5 (new) |
|---|---|---|
| weak vs strong week, `strengthFreq` | **identical** | weak < strong |
| weak vs strong week, `strengthVolume` | **identical** | weak < strong |
| total score | **identical** | weak < strong |
| strong week reaches the target | — | both lanes = 100 |

The first column is the bug stated as a test: at goal 3 a weak week and a strong week were
indistinguishable. Two further tests in `daily-goals.test.ts` pin the *properties* rather than the
number — that a short week lands well down the curve, and that the goal stays ≤ 6.

## Why 5 and not 6, deliberately

Every other goal in this model is set *above* typical. This one is set **at** it, and the exception
is the point: more sessions is not monotonically better, and the model already tapers the score past
the ACWR optimal band. A goal of 6 would have one part of the model rewarding what another punishes.
At 5 the contributor still discriminates where it matters — 3 sessions gives ratio 0.6 → ~73.

## Verified

- `tsc --noEmit` clean · **3628 tests** green · all custom-rule scripts pass.
- Against `pnpm dev`, signed in: `/api/readiness-score` **200**, `/api/cardio-week` **200**
  (both call `getDailyGoals`), `/`, `/health`, `/activity` all 200, no errors in the dev log.

## Not exercised

- **The owner's actual score.** The local database has a seeded user with different training data,
  so the number it produces is not the owner's. What the runtime pass proves is that the four
  `getDailyGoals` callers still work; the *behaviour* proof is the unit test above, run against the
  owner's measured figures.
- **`/api/admin/day-review`**, which would show the goals and contributors side by side, is
  admin-gated and the seeded user is not an admin.
- **The APK.** No device-specific path here — this is a shared constant read server-side — but the
  Activity card's rendering of a changed score was not observed on device.

## Expect the number to move, and to sit lower

This is the intended effect and should not be read as a regression: the score was pinned near 74
because 45 points of weight could not move. Now they can, so an ordinary week will score below what
it used to. **Q-183 (shipped earlier today, +5 points) pushed the other way**, so any before/after
comparison needs a post-Q-183 window as its baseline.

## Still open on this thread

**Q-188** (move-hours counts a 24-hour numerator against a waking-hour denominator — decided:
restrict the numerator) and **Q-190** (the volume lane is anchored to the user's own median, the
treadmill this model claims to have removed — decided: absolute per-session tonnage). Neither is
touched here.
