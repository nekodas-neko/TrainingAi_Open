# Every client component computes "today" in the user's timezone (Q-477 slice 4 — sweep complete)

**Branch:** `fix/client-timezone-sweep-components` · **Lane B** · v1.363.0

## What shipped

The rest of the sweep: **27 files, 44 call sites.** Ratchet **47 calls across 28 files → 3 calls in
1 file.** The baseline now holds exactly one entry, and it is not a component.

Slices 1–3 did the calendar marker, the write-path sheets, and session-select + the workout screens.
This is everything else — health, nutrition, running, activity, admin, the stats hub, the sync
provider, and a dozen leaf cards.

## Two things a find-and-replace would have got wrong

**`weekly-stats-hub.tsx` needed a format conversion, not a swap.** Its `todayKey` compares against
`day.dateKey` from `/api/weekly-stats`, which emits `yyyy/MM/dd` — **slashes**. `localDateString()`
also emits slashes, so the old code matched. `todayInTz()` returns dashes, so a plain substitution
would have made `isToday` never true and silently killed the today-highlight, with nothing failing.
It is `todayInTz(tz).replace(/-/g, "/")` — the same shape `session-select-content` already used.

**`log-value-sheet.tsx` was another `metric-log-sheet`.** Its local branch wrote `todayInTz(tz)`
while the POST body sent `localDate: localDateString()` — the device's zone. Two different answers
for one save, exactly the shape slice 2 found. Now both use the same `date`; the `localDateString`
import is gone.

Neither was visible from the ratchet's count — both came out of reading each call site.

## Module-scope helpers (no hook available)

Three more functions take `tz` as a parameter now, following the pattern established in slice 3:

- `linkPrescribedRun` (`done-activity-screen.tsx`)
- `readSeed` (`session-explain-client.tsx`)
- **`warmCache` (`sync-provider.tsx`)** — the important one. It writes the `{ date, data }` envelope
  that `cachedFetchToday` reads back. If the warm stamps one zone and the reader checks another,
  **every warmed `today:` key is a permanent cache miss** — the whole point of the warm pass
  defeated, silently.

## Verification

- `pnpm tsc --noEmit` clean. `eslint` — **zero warnings introduced** across all 27 files (twelve
  hook dependency arrays gained `tz`, a stable context value, so no re-run churn).
- Full unit suite: **3945 passed, 0 failed.**
- `pnpm check:rules` — **Ran 55 of 55**; ratchet reports "baseline held" at 3/1.
- Drove a browser as a `Pacific/Kiritimati` user on a **UTC device** (user-day 08-25 ≠ device-day
  08-24) across **eight routes** — `/`, `/health`, `/nutrition`, `/workout`, `/more`,
  `/session-explain`, `/running`, `/activity`. All render, **zero page errors**. Home shows
  "Tuesday 25 August" — the user's day.

## Not exercised

**Per-site save behaviour was not driven for all 44 sites** — this slice verifies non-regression
across a wide surface. The *mechanism* was proven end-to-end in slice 2 (#406), where two POST
bodies carried the user's `2026-08-25` and the rows landed on it.

The two format/dual-answer bugs above are fixed by reading and typechecking; **I did not drive the
weekly-stats today-highlight or the log-value-sheet POST to confirm them at runtime.** They are the
two sites most worth a device/browser check by whoever picks this up.

Nothing checked on the S25.

## What is left, and why it is not a conversion

**`lib/stores/workout-store.ts` (3 calls)** — a Zustand store, so no hook. Deliberately untouched:
`storedDate` exists only to detect a day rollover, and a mismatch makes `rolloverDay()` clear
`todayLogged`, dropping the day's completed-set ticks. A wrong-zone stamp can both miss a rollover
and fire a spurious one.

The pure functions are already parameterised — `applyRehydrateFixups(state, today, now)` and
`rolloverDay(today)` both take the date, and `workout-screen.tsx` already passes `todayInTz(tz)`.
What has no answer is the three places that *supply* the stamp: initial state, one reducer, and
`onRehydrateStorage`, which runs at store creation **outside React, before any provider mounts**.

Two shapes, neither free — (a) reconcile on mount, which adds a `rolloverDay` call whose clearing
behaviour must be proven safe, or (b) a module-level "current user tz", which is the global Q-477's
own header warns against. The full analysis is on the backlog entry. Pick deliberately and verify
the clear path.
