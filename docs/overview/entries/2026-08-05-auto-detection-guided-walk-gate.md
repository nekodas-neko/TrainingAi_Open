# 2026-08-05 — Auto-detection no longer double-logs during a Guided Walk or manual activity

**Domain:** cardio — v1.266.6, JS-only (no APK rebuild)

## The report

Owner: during a Guided Walk session, the "activity tracking" auto-detection banner fired and
appears to have logged a second, overlapping activity covering the same time window.

## Root cause (Q-95)

A known, already-solved suppression pattern that was never extended to this case.
`dispatchGate()` (`lib/activity/auto-detection-service.ts`) already refuses to arm GPS probing off
a passive motion trigger while a lifting workout is in progress (`isWorkoutInProgress`) — a
stronger, definite signal than any cadence/speed threshold, since the app already knows the user
is mid-session. A Guided Walk is exactly the same case, but the service never imported
`guided-walk-store` and ran completely blind to one being active.

Confirmed this is **not** already covered by the auto-activity-detection false-positive gate
shipped as Q-68 (2026-08-04) — that plan is a *notify-only* veto for a different scenario
(ring-confirm false positives with no GPS corroboration, e.g. during a scale weigh-in) and never
touches `dispatchGate()`'s workout/session gating at all.

**Sibling gap found in passing:** the manual "Other Activity" flow has the identical hole —
`isActivityActive` (`lib/stores/activity-store.ts`) was equally unchecked.

## The fix

Both `isGuidedWalkActive(useGuidedWalkStore.getState())` and
`isActivityActive(useActivityStore.getState())` now join `isWorkoutInProgress` in the same
`motionTrigger` suppression check inside `dispatchGate()`. No new plumbing — both predicates
already existed, in the same pure-predicate style as `isWorkoutInProgress`, already consumed
elsewhere (`mobile-auth-handler.tsx`, `bottom-nav.tsx`) for nav-away guards. They just weren't
checked here.

## Verification

`dispatchGate()` itself isn't exported (module-level mutable gate state, real Zustand stores;
GPS/motion triggers aren't reproducible in the sandbox, as the plan itself notes), so this proves
the composed condition it now evaluates using the real exported predicates rather than
re-implementing the logic: a new test suite in `lib/activity/__tests__/notify-gate.test.ts`
confirms the trigger is suppressed during an active guided walk, during an active manual activity,
and during an active workout (unchanged), and is NOT suppressed once any of those end.

Typecheck and lint clean. Full suite: 400 files / 3,175 tests (5 new) green.

**Not exercised:** no on-device/native surface, and no live device confirmation that a real
significant-motion or ring-cadence trigger during an actual Guided Walk stays suppressed — the
GPS/motion sensor path itself is unchanged, only the existing gate's inputs were widened.
