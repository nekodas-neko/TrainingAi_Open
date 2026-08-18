# Review — a write that updates the server but not the local store

**Date:** 2026-08-18 · **Agent:** Review · **Lens:** staleness outside Q-262's test
**Findings filed:** Q-488 · **Clean results recorded:** three

## Why

Sweep 22 closed both halves of Q-262's staleness test and named what it *cannot* catch:

> a stale-value bug arising some other way — a write that updates the DB without touching the local
> store — is outside what that test catches and has never been looked for.

That is this sweep. `CLAUDE.md`'s offline-first rule states one direction — *"if a domain WRITES to
the local store, its UI MUST READ from the local store"* — and the inverse is what matters here:
**a domain the UI reads local-first must have every one of its writes update the local store**, or
the read source never learns.

## Finding (Q-488) — deleting an activity leaves it in the local store for at least the pull throttle

`app/health/health-content.tsx:684-700`:

```ts
const res = await fetch("/api/activity-logs", { method: "DELETE", … })
toast.success("Deleted");
await invalidateActivityWrites();
refreshDayOverlay(dayOverlay.date);
```

No `store.deleteActivityLog(...)`, no `queueMutation`. The server row is soft-deleted correctly
(`adapter.ts:2374` sets `deletedAt`, scoped to `user_id`), and the surface the user is looking at
updates correctly — `refreshDayOverlay` → `fetchDayOverlay` reads `cachedFetch('day-log:<date>')`,
which is **server-read by design** (a cross-domain aggregate, the sanctioned exception). So the
activity disappears from the day overlay immediately, and the toast is honest about that screen.

**The local `activity_logs` row is untouched**, and three other surfaces read it local-first:

| Surface | Read |
|---|---|
| `app/session-select/session-select-content.tsx:500` | `store.getActivityLogs(weekStart)` — week activity |
| `app/nutrition/nutrition-content.tsx:278` | `store.getActivityLogs(today)` — today's calories burned |
| `components/health/activity-history-card.tsx:91` | `store.getActivityLogs(startOfWeekInTz())` |

So the deleted activity keeps appearing on those three until a pull carries the tombstone.

**How long.** `pullDelta` is throttled to `MIN_SYNC_INTERVAL_MS` — **5 minutes** — unless a caller
forces it (`sync-engine.ts:77`), and `components/sync-provider.tsx:145,195` calls it **un-forced**.
Nothing in the delete path triggers a pull. So the floor is the throttle window and the real duration
is "until the next natural sync", which is mount/foreground-driven.

**It does self-heal.** `applyDelta` handles the tombstone —
`DELETE FROM activity_logs WHERE id = ? AND sync_status='synced'` (`sqlite-backend.ts:1628`), with the
correct pull-clobber guard on `sync_status`. This is a visible-inconsistency bug, **not** data loss
and not permanent.

**Fix shape.** Delete the local row alongside the API call, the way every other activity write path
already touches the store (`done-activity-screen.tsx`, `exercise-review-sheet.tsx`,
`walk-summary.tsx` all do). One call. Optionally queue the delete so it works offline — today the
delete requires the network, which is a separate and larger question for this domain.

## The rule worth writing down

`CLAUDE.md` states the forward direction. The inverse is the one this finding breaks, and it is not
written anywhere:

> **A domain the UI reads local-first must have *every* write update the local store — including
> deletes, and including writes made from a screen that itself reads server-side.**

That last clause is what made this survive: `health-content.tsx` reads `day-log` from the server, so
its own screen looked right, and nothing on that screen could reveal the problem.

## Clean results

- **`PATCH /api/activity-logs/[id]/metrics`** (Health Connect enrichment, `lib/health-connect-sync.ts:212`)
  writes server-only with no local update — but the full chain checks out: all four fields
  (`distanceKm`, `caloriesBurned`, `avgHr`, `maxHr`) are in the pull mapping
  (`sync-engine.ts:324-334`) *and* in `RECONCILE_COLUMNS` (`migrations.ts:252-259`), so the
  enrichment reaches the device on the next pull. Supplementary data arriving a pull late is the
  intended shape.
- **That route is one of the two dynamic routes that validate their UUID** (`z.string().uuid()` at
  `metrics/route.ts:36`) — consistent with Q-482's finding that only 2 of 30 do.
- **The delete is a soft delete with a tombstone**, `user_id`-scoped, and `applyDelta` applies it
  under a `sync_status='synced'` guard. The mechanism `CLAUDE.md` requires for cross-device deletes is
  present and correct; only the local-write half of the originating device is missing.

## Not verified

Local dev and source reading. **Not reproduced on-device** — `getLocalStore` returns null in the web
sandbox, so the local-first readers fall through to their API fallbacks and the inconsistency cannot
appear here. The 5-minute floor is read from `MIN_SYNC_INTERVAL_MS`, not observed. On-device is the
only real verification.
