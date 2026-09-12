# 2026-09-12 — BF-151 filed: the rep-max finding had no queue entry (BugFix intake)

**Branch:** `claude/bugfix-intake-agent-dk1b8g` · **Agent:** BugFix Intake

Docs-only. The BF-149 fix — inverting a bodyweight rep max through the AMRAP-scaled formula it came
from — shipped with nothing owed, so no entry stayed in the queue. But it left a *finding* behind:
the card should eventually stop inverting at all, because `exercise_logs.avg_reps` already stores the
real reps. That was recorded in
[the BF-149 journal entry](2026-09-12-bodyweight-rep-max-inverse.md) and the PR body and nowhere
else, which the **No orphaned findings** rule does not accept — a documented finding without a queue
entry is a dropped finding.

**BF-151** now carries it. It is Lane A rather than a display change for one reason: the current
session's reps are already on the client (`summaryData.reps`), but the *previous* session's come from
`ex.estimated1rm` in the `workout-data` payload, which carries no reps — so the route has to return
`avgReps` before the card can stop inverting.

The argument for doing it is the one thing a better inverse cannot fix: **5 reps and 6 reps both
store 114.5**, because the rep-factor gain from the extra rep is exactly cancelled by
`amrapScaleFactor`'s 1.0 → 0.97 step at 6. `repMaxFromAmrapOneRm` returns the lower of a tie, which
is the most that stored number supports. Reading the reps removes the question rather than answering
it better.

Filed at the bottom of the queue, above the 🔵 wishlist block — the shipped inverse is correct at the
owner's rep range, so this is precision rather than a defect.

## Not exercised

Nothing to exercise; no code changed. `pnpm check:rules` ran **74 of 74**, and
`check-backlog-pointers.js` reads 342 entries with no duplicates.
