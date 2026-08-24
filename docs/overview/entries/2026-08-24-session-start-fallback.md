# 2026-08-24 — the midnight session start was still live, not just history (LA-21)

**Branch:** `fix/session-start-fallback` · **Lane A** · one shared function. No migration, no APK.

## What the cull did not fix

The previous PR culled implausible session durations from statistics, on the owner's instruction.
That bounds the damage; it does not stop it happening. And the diagnosis behind it split the eleven
bad sessions into two causes — four the owner's *"left running too long"*, and **seven that recorded
`started_at` at exactly 00:00 local**.

The seven had a cause nobody had traced. It is here:

```ts
const startOfDay = aestMidnight(y, m, d, tz)
const sessionStart = workoutStartedAt ? new Date(workoutStartedAt) : startOfDay
```

`workoutStartedAt` is optional. When the payload carries none, a session that began at 09:00 is
recorded as beginning at midnight — and the resulting eight-to-fourteen-hour span is exactly what the
production rows show.

## And the mechanism, which is the part worth keeping

`components/workout-screen.tsx` sends `workoutStartMs ?? undefined`, and the workout store's
**abandoned-session guard sets `workoutStartMs` to null**. So the guard that exists to stop a
days-old session being resumed is itself what leaves the next log with no anchor at all.

That also explains why the cull alone was not enough: a real workout logged after an abandonment
would have gone on contributing nothing, because its duration would go on being culled.

## The ladder

The fix is not new — `loggedAt`, forty lines below in the same function, already walks a ladder for
the same reason, with a comment saying so. `sessionStart` now walks the same one:

1. **`workoutStartedAt`** — the device's own anchor, and what a normal submit sends.
2. **the first set's start** — already in the payload as `setStartTimes`, and *inside* the session, so
   it loses the warm-up rather than the hours midnight loses.
3. **`now`** — but only when the log is for today. Logging an exercise happens during the session.
4. **midnight** — only for a **back-dated** log, where the start is genuinely unknown and `now` would
   be a worse lie: it would place the session on the wrong *day*.

## Verified

- 4 new tests, one per rung. **Mutation:** restoring the old single-fallback line fails two of them —
  the first-set rung and the today rung, which are precisely the two that were missing.
- Full suite **565 files / 4,647 tests**; `pnpm check:rules` 55 of 55.

## What is left

**The seven historical rows still carry their midnight `started_at`.** This is forward-only. A
backfill would have to reconstruct each span from its exercise logs — which is what `weekly-stats`
already does at read time — so the open question is whether it is worth writing back at all, or
whether the other duration consumers should derive it the way `weekly-stats` does. Kept on LA-21.

**Failure surfaces NOT exercised:** production — the fix is forward-only and the eleven bad rows are
all from May, so nothing changes for them. The abandonment path that triggers the fallback was traced
by reading `workout-store.ts`, **not reproduced on a device**: confirming it would mean leaving a
session open past four hours, restarting the app, and logging an exercise. Nothing native,
safe-area or offline is touched — this is one shared function that both the web route and
`pushMutations` call.
