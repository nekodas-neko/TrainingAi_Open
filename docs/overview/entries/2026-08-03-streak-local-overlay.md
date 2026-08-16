# 2026-08-03 — an unsynced workout could be masked on the home streak

_Branch `fix/streak-local-overlay` · v1.252.2 · domain `activity` (Q-41's last surface)_

## The entry's premise was half stale — this corrects it

Q-41 said the home streak strip "has the same blind spot for an unsynced workout" as the calendar
did, because it builds from `readCacheSync('calendar-data:<month>')` + `streak-data`. That is not
the whole picture. `session-select-content.tsx` has read 90 days of local workout history since
2026-07-30 or earlier — before Q-41 was filed — via `store.getWorkoutHistory(cutoff)`, and that read
does include pending rows. A workout logged offline on a *fresh* day already showed up.

**What was actually broken is narrower and was not written down anywhere.** That fill merges with

```ts
setCalendarDays(prev => ({ ...local, ...prev }))   // prev's keys win
```

so it only ever *adds days the cache does not already hold*. A day the server already knows about
keeps the server's list verbatim — which means a **second, unsynced workout on a day that already
has a synced one** is invisible until it uploads. The `streak-data` fetch has the mirror of the same
shape (`{ ...prev, ...d.trainedDays }`, server wins), so a refetch re-masks it even if the local fill
had won the race.

That is a real gap on the same surface, so this closes Q-41 by fixing it rather than by striking the
entry — but the entry's stated cause is corrected in the backlog, not repeated.

## What shipped

A second piece of state, `pendingDays`, filled from `readLocalCalendarOverlay` (the pure,
pending-only reader written for the calendar in #1009) for the current and previous month, and
merged into the server payload **at read time** with `mergeCalendarOverlay`:

```ts
const trainedDays = useMemo(
  () => mergeCalendarOverlay(
    { trainedDays: calendarDays, activityDays: {} },
    { trainedDays: pendingDays,  activityDays: {} },
  ).trainedDays,
  [calendarDays, pendingDays],
)
```

`weekStrip`, `streak`, the recommendation card's `todaySessionName` and `StreakCard` all read
`trainedDays` now instead of `calendarDays`.

**Why a separate state rather than merging into `calendarDays`.** Every writer of `calendarDays`
lets the newest server payload win a day key, and that is load-bearing: it is how a workout deleted
on another device disappears here. Making those writers additive would have kept deleted workouts
alive. Pending rows cannot be in the server payload by definition, so keeping them apart and
merging on read gets the union without touching deletion propagation, and survives every refetch
without a re-read.

The overlay re-reads on `refreshTick`, so a pull-to-sync that uploads the row empties the overlay
and the server payload takes over — no double-count, because `mergeCalendarOverlay` dedups by name.

**Window: two months.** A pending row older than that means sync has been down for a month, which
is a different problem than this one.

## Verification

- Two new tests on `local-overlay`: composing two months into one overlay (the month-boundary case
  the streak needs), and `readLocalCalendarOverlay(undefined, …)` returning the empty overlay so the
  merged result is `toEqual` the server payload — that is the proof the web path is byte-identical.
- Dev server, logged in as the seeded user: home renders 200, `/api/streak-data` returns its nine
  days, no runtime errors.
- Typecheck and lint clean (0 errors).

## Not verified

**On device — which is the only place this change does anything.** `getLocalStore` returns null in
the web sandbox, so `pendingDays` is always `{}` there and the merge is provably a no-op; what the
dev server demonstrates is only that nothing regressed on the server-only path. Logging a workout
offline and seeing it in the streak before it syncs needs the APK. A row for it is on the owner
checklist in
[`docs/handoff-2026-08-02-platform-batch-queue-drain-run-2.md`](../../handoff-2026-08-02-platform-batch-queue-drain-run-2.md).
