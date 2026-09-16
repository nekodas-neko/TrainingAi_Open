# 2026-09-16 — BF-168: the leave dialog outlives the screen that raised it (BugFix intake)

Docs-only. BF-168 was filed with one question for the owner, because the answer chose between two
different fixes. He answered: *"No; it was straight after finishing the workout and pressing the back
button."*

That kills the Start-Again theory — no new session had begun, so this is not a labelling problem.

## A second read eliminated three more candidates and none was the cause

- The store's `persist` has **no `partialize`**, so `mode` is persisted and cannot fall back to
  `'pre'` on rehydrate.
- `isWorkoutActive`'s own comment confirms `'done'` is the deliberate and only safe exit: *"'pre' is
  also the hub screen shown during a workout … so it must NOT be excluded here."*
- **No site re-arms `workoutStartMs`** — outside the start handler the only write is the clear at
  `workout-screen.tsx:1698`.

## What the second read did find

**The dialog is never dismissed on navigation.** `confirmLeaveOpen` is set at
`mobile-auth-handler.tsx:48` and cleared **only** by the user tapping Stay or Leave. There is no
effect on `pathname`.

So a prompt raised legitimately on one screen **survives any navigation** and reappears over whatever
is now displayed — which is precisely a "Leave workout?" dialog sitting over the session-select tab,
a screen with no workout to leave. It matches the screenshot rather than merely being compatible with
it.

That makes a testable sequence: back pressed while the last exercise's summary was still up
(`mode === 'exercise-summary'`, `workoutStartMs` set) raises the dialog **correctly**; the app then
reaches `done` and navigates to session-select, and the undismissed dialog rides along. *"Straight
after finishing"* fits that moment — finishing the last set reads as finishing the workout.

## Worth fixing regardless of whether it is the whole story

The missing dismissal is not specific to this path: any of the three guards in that listener can
raise a prompt that then outlives its screen. One effect clearing all three confirm flags on
`pathname` change covers it.

The entry still does not claim the root cause is settled, because it is not — it claims a real defect
that produces this exact appearance.

## Not exercised

Docs only. Read in the shipped source; not reproduced on device.
