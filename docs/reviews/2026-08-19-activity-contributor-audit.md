# The Activity Score, contributor by contributor — and why it still barely moves

**Date:** 2026-08-19 · **Agent:** Tuning 🎶 · **Pillars:** `[activity]` `[heart-rate]` `[nutrition]`
**Continues:** [`2026-08-19-zone-minutes-move-hours-coverage.md`](2026-08-19-zone-minutes-move-hours-coverage.md)
(Q-522, Q-523), which measured two of the six contributors. This finishes the other four.

**This answers Q-277** — *"v2 fixed the mechanism Q-137 blamed and the outcome did not move."* It did
move, measurably; the reason it did not move **much** is that after every fix, **about half the
score's effective weight still cannot vary.**

---

## 1. Every contributor, measured

90 days to 2026-08-19, `claude_ro` (row-scoped to the owner). Sub-scores reconstructed from stored
inputs using the shipped formulas and the **current** goals — `stepGoal` 10,000 (see §3),
`strengthFreqGoal` 5, `sessionVolumeGoalKg` 5,200 → `volumeTargetKg` 26,000.

| contributor | weight | mean | sd | at ceiling | verdict |
|---|---|---|---|---|---|
| **steps** | 18 | 53.6 | **33.4** | 16 / 90 | ✅ **the best contributor in the score** |
| **strengthVolume** | 20 | 81.4 | **23.8** | 32 / 88 (min 6) | ✅ works — Q-190's fix delivered |
| **strengthFreq** | 25 | 95.0 | 13.1 | **69 / 88 (78%)** | 🟡 compressed — and deliberately so (§2) |
| **moveHours** | 12 | ~97 | — | **48 / 59** | ❌ saturated (Q-522) |
| **zoneMinutes** | 10 | ~6 | — | **53 / 59 days at *zero*** | ❌ floored (Q-523) |
| **activeEnergy** | 15 | — | — | — | ❌ **absent on 43 of 51 days** (Q-521) |

Underlying spreads, for reference: steps mean 6,044 (sd 4,715, range 464–23,740); `sessions7d` mean
5.13 (range 1–8); `volume7d` mean 22,086 kg (range 1,473–32,588).

### Effective weights are not the nominal ones

`activeEnergy` is usually absent and `zoneMinutes` is suppressed on strength days, and the model
renormalises over whatever remains. On a typical day that leaves **75** of nominal weight:

| contributor | nominal | **effective** | informative? |
|---|---|---|---|
| strengthFreq | 25 | **33%** | no — 78% at ceiling |
| strengthVolume | 20 | **27%** | **yes** |
| steps | 18 | **24%** | **yes** |
| moveHours | 12 | **16%** | no — saturated |

**51% of the effective weight carries information; 49% does not — and the single largest effective
weight is one of the inert ones.**

---

## 2. `strengthFreq`'s ceiling is a design consequence, not a defect — and that matters

The obvious move is to raise `strengthFreqGoal` or extend `STRENGTH_FREQ_CURVE` past ratio 1.0.
**Neither should be done**, and `daily-goals.ts` already argues why: the goal of 5 is set *at* the
owner's measured typical (4.9/wk) rather than above it, because more sessions is not monotonically
better and the model already tapers past the ACWR optimal band — *"a goal of 6 would have one part of
the model rewarding what another punishes."* The curve flat-lines from ratio 1.0 to 1.5 for the same
reason: 100 means **optimal**, not **maximum**.

That reasoning holds. The consequence is the finding: **for a consistently-training user, 33% of the
Activity Score's effective weight is structurally unable to vary**, and no calibration of that
contributor can change it without contradicting the model's own stated philosophy. **This is a
constraint on Q-505's redesign, not a bug for it to fix** — if the redesign wants more range, it has
to come from somewhere else.

---

## 3. Two different step goals, and the personalised one contradicts its own evidence

`users.steps_goal` = **7,000** (the owner set it). `getDailyGoals()` ignores that column and derives
the goal from `activity_level = 'moderate'` → `STEP_GOAL_BY_ACTIVITY.moderate` = **10,000**.

| surface | goal used |
|---|---|
| `components/health/goals-progress-card.tsx` | **7,000** (profile) |
| `app/api/daily-digest/route.ts` — *"Steps: N/7000 today"* | **7,000** (profile) |
| **Activity Score** `steps` contributor | **10,000** (derived) |
| `app/health/activity/activity-content.tsx` progress bar `max` | **10,000** (derived) |
| `app/api/cardio-week` weekly target | **70,000** (derived × 7) |
| AI `health-insight` prompt — *"goal 10000"* | **10,000** (derived) |

On a 7,200-step day the Goals Progress card and the digest say the goal is met while the Activity
screen's own bar reads 72% — **the same metric, two targets, both shown to the owner.**

**And the derived number disagrees with the evidence `daily-goals.ts` cites for it.** That file's
header names Paluch 2022 — step benefit plateaus at ~7–8k/day — and `DEFAULT_STEP_GOAL` is **8,000**,
consistent with it. But the *personalised* path returns 10,000 for `moderate`, so **the fallback used
when the profile is empty is better calibrated than the personalised value that replaces it.**
Measured against the owner: 10,000 is reached on **16 of 90 days (18%)**; their own 7,000 on **31 of
90 (34%)**.

Filed as **Q-524**. The reconciliation is a decision (which number wins), not a calculation, so this
review does not pick one.

---

## 4. What this predicts, and what production shows

Reconstructing the composite from the measured contributors at effective weights gives a predicted
**sd ≈ 10.2** (steps and strengthVolume are effectively independent: **r = −0.016**, n = 88).

Stored `oura_daily_derived.activity_score`, 23 days:

| period | n | mean | **sd** | range |
|---|---|---|---|---|
| before the goal fix (≤ 2026-08-11) | 15 | 74.7 | **5.0** | 66–81 |
| after (≥ 2026-08-12) | 8 | 77.1 | **7.4** | 64–91 |
| all | 23 | 75.5 | 5.9 | 64–91 |

**Q-137/Q-190 worked — sd rose ~48% and the range widened at both ends.** Two honest qualifications:
**n = 8** post-fix, so this is directional, not settled; and history is **not** back-filled, so 15 of
the 23 stored days are still scored under the old goals — the same trap the sleep recalibration hit,
where the shipped improvement is invisible in stored history.

The gap between the predicted 10.2 and the observed 7.4 is what the inert 49% costs. For scale, the
recalibrated Sleep Score replays at sd 16.6 and Body Battery measures sd 29.6
([`cross-pillar table`](2026-08-19-cross-pillar-score-ranges.md)). **Activity will remain the most
compressed score in the app until Q-521/Q-522/Q-523 free up the weight it cannot currently use.**

---

## 5. Filed

- **Q-524** — two step goals on two screens, and the personalised one (10,000) contradicts the
  Paluch 7–8k evidence its own file cites while the fallback (8,000) matches it.
- **Q-505** amended with §1's table, §2's constraint, and the Q-277 answer.
- **Q-277 closed and removed.** Its "first action" was *"for each scored day, dump the per-component
  parts and count how often each lane is present and what its realised range is"* — that is §1. Its
  "leading hypothesis, untested" (renormalisation collapses the score onto saturating lanes) is now
  **tested and confirmed**, with the correction that `strengthVolume` and `steps` do *not* saturate.
  The investigation is finished; the remedy lives in Q-505 and Q-521/522/523. This is the same
  disposition Q-277 itself prescribed for Q-137: *"should be re-scoped or closed in favour of this;
  do not work both."*

**Deliberately not filed:** anything about `strengthFreq`'s ceiling (§2 — it is a documented,
coherent trade-off, and re-opening it would be manufacturing a finding), and any proposed step-goal
number (§3 — that is the owner's call between two values that both already exist in the app).
