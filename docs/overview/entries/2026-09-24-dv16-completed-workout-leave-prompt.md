# DV-16 — a finished workout that reopened as an unfinished one

**Branch:** `fix/dv16-completed-workout-leave-prompt` · **Entry:** DV-16 (Device Verification, sweep 3) · **Version:** 1.465.24

## The report

The owner finished Push, restarted the app, and every tab tap from `/workout` raised *"Leave
workout? Your workout is in progress. Leaving now will end the session and unsaved sets will be
lost."* — 2 of 2 on the S25. The Workout card showed COMPLETED at the same time. Answering *Leave*
would have called `resetSession` on a workout that was already saved.

The entry left the cause open, and was right to: it offered two possibilities and marked them
**not established**.

## Cause

Neither guess was right as framed. The in-memory `mode` does not drift from the persisted one by
accident — it is rewritten deliberately:

```ts
if (state.mode === 'exercise-summary' || state.mode === 'done') {
  state.mode = 'pre'   // so DoneScreen cannot replay its confetti on reopen
  state.summaryData = null
}
```

`isWorkoutActive` was `!!workoutStartMs && mode !== 'done'`, so that rewrite removed the only term
saying the workout had finished. `workoutStartMs` survives the reopen — the staleness branch clears
it only past four hours, and `dateRolledOver` is always false in production because
`onRehydrateStorage` passes `today: null` on purpose (Q-477). The card still read COMPLETED because
that comes from `workoutEndMs`, which nothing had touched.

Two pieces, each correct alone: a confetti guard that owns `mode`, and a nav guard that read `mode`
as durable state.

## Fix

`isWorkoutActive` now also requires `!workoutEndMs`. That stamp is the durable fact the transient
mode is not — written once at completion in `workout-screen.tsx`, and nulled by both `startWorkout`
and `resetSession`, so the guard re-arms on Start Again.

A **third term was added rather than either existing one altered**. An existing test pins that
`pre` must never be excluded, because `pre` is also the mid-workout hub; that constraint is intact,
and the test now asserts the two original terms plus the absence of a `mode !== 'pre'` exclusion,
read from comment-stripped source so the new explanatory comment cannot satisfy it.

Both object-literal call sites (`bottom-nav.tsx`, `tab-swipe-navigator.tsx`) now select
`workoutEndMs` too; the rest pass whole store state.

## Verification, and what was not exercised

Four new tests in `lib/stores/__tests__/workout-store.test.ts` drive the real store: the rewrite
still happens, the finished state is no longer active, a mid-workout state still is, and the guard
re-arms after `startWorkout`. **Control-run against the pre-fix predicate — exactly one goes red**,
so the suite discriminates rather than passing either way.

`npx tsc --noEmit` clean · `pnpm lint` 0 errors · `pnpm check:rules` **Ran 77 of 77** · 58 tests
across the four files touching this surface · `pnpm build` succeeded.

**Not exercised:** the reported path itself. It needs the APK, a real completed day and an app
restart, none of which the sandbox has — `/workout` is auth-gated, so a dev-server GET only
redirects to sign-in. DV-16 keeps its device pass test for exactly that reason, and the entry says
so rather than reading as finished.
