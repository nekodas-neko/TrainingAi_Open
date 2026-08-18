# 2026-08-18 — Review: a write that updates the server but not the local store

**Agent:** Review 📖 · **Branch:** `claude/review-server-only-writes` · **Docs-only.**
**Filed:** Q-488 · **Review:** [`docs/reviews/2026-08-18-server-only-writes-to-local-first-domains.md`](../../reviews/2026-08-18-server-only-writes-to-local-first-domains.md)

## Why

Sweep 22 closed both halves of Q-262's staleness test and named what it cannot catch: a write that
updates the DB without touching the local store. This is that sweep.

## Q-488

`health-content.tsx:684-700` deletes an activity via the API, toasts "Deleted", invalidates caches —
and never touches the local store. The originating screen is *correct*, which is why this survived:
`refreshDayOverlay` reads `cachedFetch('day-log:<date>')`, a server-read cross-domain aggregate, so
the activity vanishes there at once. Nothing on that screen could reveal the problem.

The local `activity_logs` row is untouched, and three surfaces read it local-first — session-select's
week activity, nutrition's calories-burned total, and the activity-history card. `pullDelta` is
throttled to 5 minutes un-forced and nothing in the delete path forces one.

It self-heals: the server delete is a soft delete with a `user_id`-scoped tombstone, and `applyDelta`
removes the local row under the correct `sync_status='synced'` guard. A visible inconsistency, not
data loss.

## The rule that is not written down

`CLAUDE.md` states the forward direction — *"if a domain WRITES to the local store, its UI MUST READ
from the local store"*. The inverse is what bites: **a domain the UI reads local-first must have every
write update the local store — including deletes, and including writes made from a screen that itself
reads server-side.** That last clause is the reason this was invisible.

## Clean

The Health Connect metrics PATCH (`health-connect-sync.ts:212`) is also server-only, but its full
chain checks out — all four fields are in the pull mapping *and* in `RECONCILE_COLUMNS`, so the
enrichment arrives on the next pull, which is the intended shape for supplementary data. That route is
also one of the only two dynamic routes that validate their UUID, consistent with Q-482. And the
delete/tombstone mechanism itself is present and correct.

## Not verified

Local dev and source reading. **Not reproduced on-device** — `getLocalStore` returns null in the web
sandbox, so the local-first readers fall through to their API fallbacks and the inconsistency cannot
appear there. The 5-minute floor is read from `MIN_SYNC_INTERVAL_MS`, not observed.
