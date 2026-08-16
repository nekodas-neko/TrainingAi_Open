# 2026-08-08 — An offline-completed workout now gets its per-set HR attribution

**Domain:** platform / workouts — v1.270.5, JS-only (no APK rebuild)

## The gap

Q-123(a), from the 2026-08-07 full-app review (§3.1). The web completion route fires two side
effects: the Oura HR sync **and** an inline per-set/per-workout attribution pass. The outbox's
`complete_workout` branch (`adapter.ts:3928`) fired only the sync half — and only when the push
request carried an `origin`+`cookie`, since it reached it by POSTing back to
`/api/oura/hr-sync`.

That is a silent regression of the Q-11 Defect B fix (v1.266.1), which landed on the web route and
was never mirrored to the push branch — exactly what the "sync-push must mirror the web route" rule
requires in the same PR. It only bites when the direct POST fails or the phone is offline, which is
precisely what the outbox exists for.

## The fix

Q-122 (PR #1141, yesterday's item) had already extracted the whole pipeline into
`syncAndAttributeSessionHr` (`lib/workout/post-completion-hr.ts`), so this branch became a
two-line change: lazy-import the shared function and call it, replacing the `ctx`-gated self-fetch.
Sharing one function is the thing that stops these two paths drifting a third time.

**`ctx` is gone entirely.** Its only remaining consumer was that loopback, so the parameter is
removed from `pushMutations` in the adapter, from the `WorkoutRepository` interface, and from the
one call site in `app/api/sync/push/route.ts`. A dead request-context parameter threaded through
the sync entry point is an invitation to reintroduce the pattern.

## (b) and (c) are deliberately not in this PR

Both remaining Q-123 items live entirely in `components/activity/exercise-review-sheet.tsx`:
the auto-detected-activity sheet saves server-only with no `queueMutation`, and it builds its
`dateStr` from device-local `getFullYear()/getMonth()/getDate()` instead of `todayInTz()` — a
persisted-data bug, not a display one. `components/` was another agent's territory while this
landed (their Q-135 touches this same file at `:93`), so editing it here would have produced an
unpredictable conflict. The backlog entry stays open with both items and a note recording that (a)
shipped.

## Verification

`tsc --noEmit` clean · `eslint` on all four touched files matches the pre-existing baseline exactly
(11 warnings before and after, verified against a stashed tree) · `check-push-mutations.js` OK ·
full suite 406 files / 3220 tests, one failure (`scale-ble-multi-reading.test.ts`) that **also
fails on a stashed clean tree** — it needs a second user row the local seed lacks. Pre-existing,
unrelated.

**New DB-backed test** (`push-mutations-complete-workout-hr.test.ts`) seeds a workout session, an
exercise log, a set with real `set_start_ms`/`set_end_ms` windows and 45 minutes of
minute-by-minute `oura_heartrate` rows, pushes a `complete_workout` mutation through
`repo.pushMutations`, and asserts both `workout_hr_stats` (with a non-zero `readings_count`) and
`set_hr_stats` rows appear. It polls, because the attribution pass is fire-and-forget by design.

**Confirmed it actually tests the fix**: with `adapter.ts` stashed back to the pre-fix version the
test fails (no rows ever appear); with the fix it passes. Skips cleanly without `DATABASE_URL`, so
CI's Tests job is unaffected.

**Not exercised:** the real Oura sync half — the local dev DB has no Oura token, so
`syncHrForSession` returns 0 and the test proves the attribution half only (which is the half that
was missing). No on-device verification — server-side only, no native/safe-area/gesture surface.
