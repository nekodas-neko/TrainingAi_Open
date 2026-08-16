# Q-190 — give the volume lane an absolute anchor

**Decision taken 2026-08-11** (owner): replace the self-referential median with an absolute
per-session tonnage. This plan is the *how*, written before touching code because the change turned
out to be three sites, not one.

## The problem, restated

```ts
// activity-score.ts:135
const volTarget = Math.max(typicalSessionVolumeKg, 1) * Math.max(goals.strengthFreqGoal, 1)
// acwr.ts:37
const typicalSessionVolumeKg = sorted[Math.floor(sorted.length / 2)]   // median of the user's OWN sessions
```

The target is the user's own median. Train harder, the median rises, the target rises, the score
stays put — the treadmill §2 of [the calibration doc](../../activity-goal-calibration.md) says the
2026-07-22 rewrite removed. It was removed from the daily-movement lane and left here.

## What makes this bigger than one line: the formula has three copies

| site | what it does |
|---|---|
| `packages/shared/src/health/activity-score.ts:135` | the model — computes the score |
| `packages/shared/src/health/score-audit/activity.ts:71` | the audit view — and prints the derivation in a note |
| `app/health/activity/activity-content.tsx:89` | the UI — `max={typicalSessionVolumeKg * strengthFreqGoal}` on a progress bar |

Three implementations of one metric, which CLAUDE.md calls a bug by definition. **This is also the
trap**: changing only the model would leave the audit and the progress bar showing a different
target from the one being scored, and nothing would fail. The duplication has to go first, or the
fix is silently partial.

## The measurement behind the number

Per-session volume, owner's last 8 weeks, **40 completed sessions** (measured 2026-08-11, not taken
from the filed entry):

| median | mean | p75 | min | max |
|---|---|---|---|---|
| **4,438 kg** | 5,032 | 6,782 | 1,533 | 9,421 |

With `strengthFreqGoal = 5`, `volTarget = sessionGoal × 5`. Checked against the measured weekly
range (weak 16,843 · mean 25,159 · strong 31,083):

| session goal | volTarget | weak week | typical week | strong week |
|---|---|---|---|---|
| 4,438 (at median) | 22,190 | 76 | **100** | **100** ← re-saturates |
| **5,200 (chosen)** | **26,000** | **65** | **97** | **100** |
| 6,782 (p75) | 33,910 | 50 | 74 | 92 ← never reachable |

**5,200** is the one that discriminates across the real range: a weak week is clearly weak, a
typical week is near but not at target, a strong week reaches 100. The median re-creates the
saturation; p75 makes 100 unreachable.

## The change

1. **One formula, one place.** Export `volumeTargetKg(goals)` from `activity-score.ts` and call it
   from all three sites. This is the part that must land even if the anchor were left alone.
2. **`DailyGoals` gains `sessionVolumeGoalKg`**, supplied by `getDailyGoals` from a new
   `DEFAULT_SESSION_VOLUME_GOAL_KG = 5200`. Absolute, not derived — that is the whole point.
3. `volumeTargetKg = sessionVolumeGoalKg × strengthFreqGoal`. `typicalSessionVolumeKg` stops
   driving the target.
4. **`typicalSessionVolumeKg` stays as an input** — `blend-activity.ts` still uses it legitimately
   (a relative credit, see the Q-190 sibling note) and the audit still *displays* it. It just no
   longer decides the goal.

## Not personalising it, and why

`getDailyGoals` personalises active energy from BMR, so a per-bodyweight tonnage target is the
obvious next thought. There is no principled formula for it — tonnage scales with bodyweight *and*
training age *and* exercise selection — and inventing one would be the "picking numbers badly"
failure §5 warns about in a new costume. A single evidence-anchored default, overridable later, is
the honest version.

## Tests

- the target **no longer moves** when `typicalSessionVolumeKg` changes — the regression that defines
  this fix.
- discrimination across the three measured weeks (65 / 97 / 100).
- **all three sites agree**: model, audit note and UI max all read the same helper.
- each verified by mutation before being counted.

## Risk

The score drops again for a typical week (~100 → ~97 on this lane). That is the **fourth** change to
the Activity Score today. Baseline comparisons must use a post-Q-188 window.
