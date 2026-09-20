# 2026-09-20 — "generate it at completion?" — he asked for the opposite in July, and BF-179 says he was right

**BugFix intake.** Docs-only. Owner: *"when you select the ai generated workout plan it should be
able to auto create workout as soon as your one is completed right? The only factors would be if you
choose deload or quicker one right? Is there a way we can optimize this?"* Filed as **BF-182**.

## The decision already exists, in the code, with his name on it

`complete-workout/route.ts:47-51`: *"The next prescription for this session is intentionally NOT
generated here — it is generated on demand when the session is next opened, so it is never more than
a few minutes stale and never sits waiting for a decision for days (**owner ask 2026-07-31**:
generation should happen right before the workout, not at the end of the previous one)."*

He is asking for the reverse of his own call. **BF-179 is live evidence the July decision was
right**: a prescription generated early and left sitting is exactly what went stale — dismissed,
expired 2026-09-17, still serving 52% on 2026-09-20.

## His "only two factors" is nearly right, and the distinction decides the design

Deload and duration are not filters over a finished prescription — **both are inputs to it**.
`durationPreset` reaches `generatePrescriptionForSession` and sets `budgetOverrideMin` via
`budgetForPreset`, changing how much work is prescribed; the prescribe route calls it *"a today-only
time-budget choice from the pre-workout screen"*. The deload decision reads the day's readiness at
generation time.

So a prescription built at completion is keyed to **yesterday's readiness** and a guessed duration,
and picking Quick or Long regenerates it anyway. Pre-generating does not remove the wait — it moves
it and adds a stale answer.

## What is actually slow

Nothing warms the prescription before the workout tab opens. `isAiPrescriptionPending` fires
`regeneratePrescriptionInBackground` from `workout-data` **on tab-open**, and the client paints
"preparing your AI workout" while it lands. `/api/next-session/prescription`, the only other reader,
is explicitly read-only and fires no `/prescribe`. **The first thing that ever asks for the
prescription is the screen the lifter is waiting on.**

## Recommendation

Warm it when Home renders the recommendation card — same day, `standard` preset. Generation then
starts seconds-to-minutes before the tap instead of at it, while keeping everything the July
decision bought: same-day readiness, no multi-day sit, no decision waiting. Quick or Long
regenerates, which is a deliberate choice where a visible wait is honest.

Flagged for the implementer: the existing single-flight dedupe was built for a ~3s poll on one
screen. A Home warm racing a tab-open trigger is a different shape, and two concurrent generations
for one session is the failure worth avoiding.

## What was not exercised

Nothing on the S25, and nothing measured at runtime — the trigger chain was read, not timed. The
entry gates on the owner because it revisits his own decision, and carries a device check because
perceived latency is the entire point and the sandbox cannot measure it.
