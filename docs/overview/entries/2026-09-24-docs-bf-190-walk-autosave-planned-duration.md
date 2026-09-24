# BF-190 — a 27-second walk logged as a complete 40-minute session

**Branch:** `docs/bf-190-walk-autosave-planned-duration` · docs-only · BugFix intake

The owner asked why the calories tile on his walk summary read `—`. Tracing it turned up a larger
problem underneath.

**The tile question is unresolved and the entry says so.** The stored row carries **133 kcal**,
derived server-side at insert, so the server half works. But that row was created at 09:59:28
Brisbane and the phone clock in the screenshot reads 9:59 — the shot was taken within about half a
minute of the save, and the tile is designed to start as a dash and fill when the forced pull
returns. A dash at +30 s may be the documented pre-arrival state. BF-107 is reopened with the check
that separates the two cases: re-open the walk from the activity list and see whether the tile fills.

**What the trace found instead.** `activity_logs` holds **two** rows for that walk, both claiming 40
minutes and 133 kcal:

| id | created | start–end | steps | avg HR | kcal |
|---|---|---|---|---|---|
| `b8083d04` | 09:18:27 | 09:18 → 09:58 | — | — | 133 |
| `d0231b08` | 09:59:28 | 09:19 → 09:59 | 3190 | 92 | 133 |

The first was written **27 seconds after its walk started** and claims a 40-minute end time that had
not happened yet. `walk-summary.tsx:130` saves on mount, and the duration and end time it saves come
from `plan.totalSec` — the planned walk, not the clock. So anything that puts the lifter on that
screen early writes a finished session. Calories follow duration (`deriveActivityKcal` uses activity
type and minutes, no HR or steps), which is why both rows read exactly 133.

The day now holds 80 minutes and 266 kcal of treadmill walking against 40 and 133 actually done.

Filed Lane B with the three-line fix (read the clock, not the plan) and a flagged follow-on decision:
whether a sub-minute walk should be saved at all. Recommended a minimum-duration floor matching the
`MIN_SESSION_SEC` pattern `time-audit.ts` already uses for workouts, rather than a confirm dialog.

## Amended after the owner confirmed the trigger

*"I started a walk; then closed it - I guess it didnt fully close it? that should be looked at
too."* So the phantom row came from **End walk**, not a crash — reproducible on demand, and the
defect sits earlier than the mount-save the entry first blamed.

In `walk-active.tsx` the two exits are the same call with the same two arguments. Finishing
naturally at `e >= plan.totalSec` (:142) and confirming **End walk** (:279) both invoke
`onFinishRef.current(samples, cadence)`. `WalkSummary` receives `config`, `samples`, `cadence` and
`startedAtMs` — nothing that says whether the walk ran out or was stopped after 27 seconds. It
cannot tell, so it assumes the plan. The elapsed seconds are in the same component and are dropped
at the boundary.

That makes this an instance of a class CLAUDE.md already names — *"completion callbacks must carry
the written entity"* — and the fix earns that rule another example rather than rediscovering it.

The dialog also already promises what the data does not keep: *"Ending now will stop it early."* The
lifter is told the walk is recorded as stopped early and it is recorded as a full planned session.
Making that sentence true is the acceptance criterion.

The mount-save stays in the entry as the secondary half: with the duration fixed there is still no
beat at which a 27-second walk could be declined, which is why the minimum-duration floor is part of
the fix rather than a nicety.
