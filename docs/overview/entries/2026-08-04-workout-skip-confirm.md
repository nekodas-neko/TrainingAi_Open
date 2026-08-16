# 2026-08-04 — Skip during a workout asks before discarding a set in progress (Q-63)

**Branch:** `fix/workout-skip-confirm` · **Domain:** workouts

## What was wrong

`active-workout-screen.tsx` has two skip buttons, and neither guarded a normal program workout:

- the **pre-set screen** button called `onSkip` directly, with no guard at all;
- the **active/rest bar** button was `soloMode ? withConfirm(onSkip) : onSkip()` — so in solo mode it
  asked, and in an ordinary program workout one tap jumped to the next exercise and took the
  in-progress set and rest timer with it.

Nothing about losing a set is solo-specific. Both now route through `withConfirm`.

## Two judgement calls

**The confirm stays conditional, not unconditional.** The backlog entry said "unconditional
confirm". Read as "regardless of `soloMode`" that is exactly what shipped; read as "regardless of
state" it would be wrong — a dialog on a fresh exercise with nothing logged is friction on a button
pressed repeatedly mid-workout, and a prompt people learn to dismiss by reflex stops guarding the
case that matters. The existing condition (`timerStarted && (phase === 'set' || laps > 0)`) already
describes precisely "there is work to lose", so it is kept.

**The dialog's verb now matches the action.** It is shared with the back button, so it read
"Leave" for a Skip. Title and message hold for both — skipping does leave the exercise, and does
drop sets in progress — so only the confirm label varies.

## Making the guard testable

This repo has **no component-test setup**: vitest runs `environment: 'node'` and there are zero
`.tsx` test files. The safety condition was inline in a ~1,000-line component, so it could not be
exercised at all.

Extracted to `components/workout/leave-guard.ts` as `wouldDiscardWork()`, with 5 tests covering the
pre-timer case, mid-set, rest-with-laps, and the one deliberate "started but nothing to lose" state
(rest with no laps — the set that produced it is already logged). One test asserts the function
takes no mode argument, so the `soloMode ?` branch that caused this cannot return through it.

Standing up jsdom + testing-library to test the component itself was out of scope for a
self-contained UI fix.

## Not verified

**On device.** The change is a call-site rewire and a shared dialog that already ships, but the
dialog was not seen rendered on the S25, and the skip flow was not driven through a real workout.
No native surface is touched, so it reaches the phone through Railway with no APK.
