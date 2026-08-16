# 2026-08-11 — the volume target stops chasing the athlete (Q-190)

**Branch:** `fix/volume-lane-absolute-anchor` · **Domain:** `activity`, `readiness` · **v1.286.0**
Plan: [`docs/superpowers/plans/2026-08-11-volume-lane-absolute-anchor.md`](../../superpowers/plans/2026-08-11-volume-lane-absolute-anchor.md)

The volume lane scored against `typicalSessionVolumeKg × strengthFreqGoal`, and
`typicalSessionVolumeKg` is the **median of the user's own sessions** (`acwr.ts:37`). Train harder,
the median rises, the target rises, the score stays put — the treadmill §2 of the calibration doc
says the 2026-07-22 rewrite removed. It was removed from the daily-movement lane and left here.

## The trap: the formula had three copies

| site | what it did |
|---|---|
| `activity-score.ts:135` | the model |
| `score-audit/activity.ts:71` | the audit view, *and* printed the derivation in a note |
| `app/health/activity/activity-content.tsx:89` | `max=` on the Volume progress bar |

Changing only the model would have left the audit and the progress bar showing a **different target
from the one being scored, with nothing failing.** So the duplication went first: one exported
`volumeTargetKg(goals)`, called from all three. That half was worth doing even if the anchor had
been left alone.

## The number, measured rather than inherited

Per-session volume, owner's last 8 weeks, **40 completed sessions** — measured for this change, not
taken from the filed entry (which said 4,700):

| median | mean | p75 | min | max |
|---|---|---|---|---|
| **4,438 kg** | 5,032 | 6,782 | 1,533 | 9,421 |

With `strengthFreqGoal = 5`, checked against the measured weekly range:

| session goal | weekly target | weak 16,843 | typical 25,159 | strong 31,083 |
|---|---|---|---|---|
| 4,438 (the median) | 22,190 | 76 | **100** | **100** ← re-saturates |
| **5,200 (chosen)** | **26,000** | **65** | **97** | **100** |
| 6,782 (p75) | 33,910 | 50 | 74 | 92 ← never reachable |

5,200 is the only one of the three that separates a weak week from a typical one *and* leaves 100
reachable. Deliberately **not** personalised by bodyweight: tonnage scales with bodyweight, training
age and exercise selection, and inventing a formula for that would be the "picking numbers badly"
failure in a new costume.

## Two things the type system did not catch

**1. A hand-written copy of `DailyGoals` in the payload type.** `readiness-payload.ts:98` re-listed
the goal fields inline, so adding `sessionVolumeGoalKg` left the UI unable to see the value it needs
to render the bar. Now `DailyGoals & { moveHoursGoal }` — widening the goals reaches the payload
automatically. This *was* caught, by `tsc`, and only because the UI call forced it.

**2. Test fixtures are not typechecked.** `tsconfig.json` excludes `**/__tests__/**`, so the
`DailyGoals` literal in `activity-score.test.ts` was missing the new required field and **compiled
fine** — it surfaced as `NaN` propagating through the score at runtime. Worth knowing generally: an
interface change can silently NaN every fixture and `tsc --noEmit` stays green. A note now sits on
that literal.

## Tests

Three new, all mutation-verified (restoring the median anchor fails the first two):

- **the defining regression** — the same training week scores identically for a beginner (median
  2,000), the owner (4,438) and an advanced lifter (9,000). Before the fix the stronger athlete was
  punished for having got stronger.
- the owner's measured weak / typical / strong weeks separate, with a typical week **below** 100 and
  a strong week still reaching it.
- `volumeTargetKg` is the one formula, including its degenerate guard (never divides by zero).

## Verified

- `tsc --noEmit` clean · **3635 tests** green · all custom-rule scripts pass · eslint clean on the
  touched files (1 pre-existing unused-import warning).
- Against `pnpm dev`: `/`, `/health`, **`/health/activity`** (the screen carrying the new import) and
  `/activity` all 200, no dev-log errors.

## Not exercised

- **A live score.** The seeded user has no scoreable activity, so `activityGoals` comes back null and
  the progress bar has nothing to draw. The routes work; the behaviour proof is the unit tests
  against the owner's measured figures.
- **The APK** — shared code read server-side, no device path, but the Volume bar was not observed
  rendering its new max on device.

## Fourth change to this score today

Q-183 **+5**, Q-137/A lower, Q-188 lower, this one lower on the volume lane (a typical week ~100 →
~97). Any before/after needs a **post-Q-188** baseline, not a figure from earlier today.

## What this closes

Q-190 was the last decided-but-unbuilt item on the Q-137 thread. Remaining: **direction B** (an
HR-derived load lane), still gated on the two measurements in §8 of the calibration doc — non-workout
HR coverage, and whether `training_load_ots` is actually populated.
