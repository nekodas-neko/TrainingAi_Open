# 2026-09-16 — BF-168 and BF-169: two ways the app is unsure a workout finished (BugFix intake)

Docs-only. Two reports in one message, and only one of them is solved.

## BF-169 — the stamp waits for the exercise library

*"Some workouts show the completed sign straight after the workout. But some days dont… It may be
some specific excercises or how long it takes to leave the last screen."* Both guesses are right and
they are the same cause.

```tsx
{trainedToday && muscleActivations.length > 0 && <CompletedStamp />}
```

`muscleActivations` is empty until `library.length > 0` — a separate fetch. So the stamp is gated on
the exercise library arriving (*"how long it takes"*), and on that session's exercises producing
assignments at all (*"specific exercises"*).

**Every other completion signal on the same card uses `trainedToday` alone**: the green ring, the
screen-reader text, and the button reading **Start Again**. The card says "complete" three ways while
the one visual he looks for is missing — visible in his own screenshot, which shows Start Again and
no stamp.

It is not a careless line. `:432` guards the *heatmap* on the same array, correctly, because a
diagram with no assignments is nothing; the stamp is drawn over that diagram and inherited the
condition. Fix: gate the stamp on `trainedToday` alone, leave `:432` as it is.

## BF-168 — the leave prompt on a screen with nothing to leave

*"After excercise is conplete it still asks for confirmation to leave"*, with the dialog over the
session-select screen.

```ts
if (isWorkoutActive(getState()) && window.location.pathname.startsWith("/workout"))
// isWorkoutActive = !!workoutStartMs && mode !== 'done'
```

**`/workout` is the session-select tab as well as the workout screen**, so the path term cannot tell
"in a workout" from "looking at the list".

**The exact state was not reproduced, and the entry says so.** `resetSession()` clears both fields;
the completion path sets `mode = 'done'`; the mount-time reset depends only on `[sessionType]` so it
does not run on a return to the tab; `rolloverDay` touches neither. Something leaves the pair set and
reading did not find it.

**One observation narrows it**, and it is a question rather than a finding: the card behind the
dialog offers **Start Again**. If that was tapped, a new session legitimately began and the dialog is
*correct* — while the card still reads COMPLETED, which is why it looks wrong. That makes it a
labelling problem with a different fix, so the entry asks before anyone builds.

The entry also warns against widening `isWorkoutActive`: the same predicate guards the guided-walk
and activity prompts in that listener and the `beforeunload` warning, and BF-166 records that this
guard is the only thing between a back press and a discarded session.

## Not exercised

Docs only. Both mechanisms were read in the shipped source; neither was reproduced, and BF-168 is
explicitly unresolved on its trigger.
