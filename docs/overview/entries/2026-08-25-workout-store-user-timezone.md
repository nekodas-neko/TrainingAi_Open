# 2026-08-25 — the store stops guessing what day it is (Q-477 complete)

**Branch:** `fix/workout-store-day-rollover-tz` · **Lane B** · no schema, no route.
`check-client-today-timezone` baseline is **empty** — Q-477 is closed.

The last three bare `todayInTz()` calls in client code were `lib/stores/workout-store.ts`'s, and the
entry warned they were a design decision rather than a conversion: a Zustand store has no hook, and
`onRehydrateStorage` runs at store creation, outside React and before any provider mounts.

## The answer was not to thread `tz` in

Both shapes the entry proposed give the store a timezone it has no business knowing — either
`DEFAULT_TZ` plus a reconcile on mount, or a module-level "current user tz" global its own header
warns against. The third option is that **the store stops fabricating a date at all**.

`storedDate` exists for exactly one purpose: to be compared against a "today" so a day rollover can
clear `todayLogged`. It is never displayed and never used for anything else. So it is now written
only by a caller that knows the user's zone:

- `INITIAL_STATE.storedDate` is `''`, not `todayInTz()`. Empty never equals a real date, so the first
  check stamps it — clearing two objects that are already empty on a fresh store.
- `applyRehydrateFixups(state, today, now)` takes `string | null`. `null` means *the caller cannot
  know the zone*, and the date branch is skipped. The transient-mode and stale-anchor fixups need no
  date and still run — a stale `summaryData` still crashes `ExerciseSummaryScreen`, and the done
  screen still re-fires its confetti, so those could not be skipped with it.
- `startWorkout` no longer re-stamps `storedDate`. It marks which day the ticks belong to, not
  anything about a workout, and re-stamping it in an unknown zone is how a wrong zone *hides* a
  rollover that is due.

## The bug underneath was two answers, not one wrong one

`onRehydrateStorage` compared the stored day against **Brisbane** while `workout-screen.tsx`'s
visibilitychange effect compared it against the **user's** zone. For anyone who has pressed
Auto-detect those are different dates, so the app could roll the day over on open — clearing the
morning's completed-set ticks — and then roll it over again on the next resume.

`components/shell/workout-day-rollover.tsx` is now the single place that answers it, from
`useUserTimezone()`, on mount and on `visibilitychange`.

**It is in the root layout, not the workout screen, and that placement is the point.** The check it
replaces ran at rehydrate, which is to say on every app open regardless of which tab that open landed
on. Leaving it behind a mounted `workout-screen.tsx` would have left a user who opens the app on
Session Select after midnight looking at yesterday's ticks — the exact WK-13 symptom, relocated.

## Verified

**Unit** — `lib/stores/__tests__/workout-store.test.ts`, five new cases: a `null` date does not roll
over, a `null` date still applies the transient-mode fixups, a known date still rolls over, the store
starts unstamped, and `startWorkout` does not re-stamp. **28 passed.**

**In a browser**, seeded user moved to `Pacific/Midway` (UTC−11), whose today was **2026-08-24** while
Brisbane was already on the **25th** — so the user's day and `DEFAULT_TZ`'s day were distinguishable.
With a stored day of 2026-08-23 (a genuine rollover owed) and ticks present, opening the app on a
**non-workout** screen:

| | `storedDate` after open | `todayLogged` |
|---|---|---|
| before | `2026-08-23` — no rollover at all | ticks kept |
| after | `2026-08-24` — **the user's day**, not Brisbane's | cleared |

**One assertion in that probe was not discriminating, and saying so matters more than the tick.** The
first case — ticks surviving an open on the user's own day — passed before the fix too, because
zustand's `persist` does not write back the in-place mutation `onRehydrateStorage` makes, so
localStorage still held the ticks the old code had already cleared *in memory*. What the probe reads
therefore lags what the screen shows. The in-memory semantics are covered by the unit cases above,
which call `applyRehydrateFixups` directly; the browser run is evidence for the second row only.

`tsc --noEmit` clean · eslint unchanged on `workout-screen.tsx` (7 pre-existing warnings before and
after) · `pnpm check:rules` **Ran 56 of 56**.

## Not exercised

Not run on the S25 APK. The rollover is plain client state with no native surface, but the resume
path it hangs off (`visibilitychange`) behaves differently in a WebView than in a desktop tab, and a
real app-backgrounding across local midnight is the case that matters. `Gate: device`.

Also not exercised: any user actually *on* a non-Brisbane timezone in production. Every production
row is `Australia/Brisbane`, so this whole entry has always been latent — which is why the button
that triggers it, Profile → **Auto-detect timezone**, is the thing to try first on device.
