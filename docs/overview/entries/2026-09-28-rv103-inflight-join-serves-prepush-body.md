# 2026-09-28 — RV-103's stale card is the in-flight join, not a dead subscription

**Lane B.** Branch `docs/rv103-inflight-join-serves-prepush-body`. Docs only — no code, no version bump.

## What the entry owed, and what it guessed

`RV-103`'s failure line and Retry shipped and PASSED on device (sweep 4a). One follow-on remained:
deleting a food immediately after a Retry left the card on **1,454** for 16 s+ while the server said
1,534; deletes without a Retry refreshed fine; a tab swap corrected it. The entry's hypothesis:

> It looks like the Retry path leaves the card's refresh subscription dead.

**That is wrong, and checking it is what found the real mechanism.** `useInvalidationRefetch` holds its
callback in a ref, keys its effect on the joined key string, and unsubscribes only on unmount. Nothing
in `retry()` touches it. The subscription fires; its refetch is swallowed one layer down.

## The mechanism

`cachedFetch` **joins** an in-flight request rather than firing a second one — `cache.ts:396`, *"If a
request is already in-flight for this key, join its waiter list"* — and every joiner receives that
request's body.

The delete fires `revalidate()` twice on purpose (immediately, then via `pushThenRevalidate`), exactly
as `log-food.ts` does:

1. **Round 1** invalidates and refetches while the outbox push has **not** landed. Its GET asks a server
   that still has the food and answers **1,454**.
2. **Round 2** invalidates again after the push — and its refetch finds round 1 still in flight, **joins
   it, and is handed 1,454**. No further request is made.
3. The card holds the pre-delete figure until something remounts it. That is the tab swap.

**Why Retry made it reproducible:** `retry()` runs `fetchWithRetry`, whose ladder is 2.5 s + 5 s + 7.5 s,
so a request is far likelier to still be in flight when the push lands. Without a Retry, round 1 usually
resolves first, round 2 fires a genuine request, and the card corrects. **The "16 s+" is that ladder, not
a coincidence** — which is the detail that pointed here rather than at the subscription.

## The clincher

**`clearAllCache()` clears `inFlightRequests`. `invalidateCache()` does not.** A response already in
flight when the cache was cleared is by definition pre-invalidation data, and the reasoning that put
that line in one function applies to the other. That asymmetry is why this reads as an oversight rather
than a deliberate trade.

## Why it is Lane A's, and why the one-liner is only half

The fix is `lib/sqlite/cache.ts` — Lane A's by the path list. Two levels:

- **Cheap:** drop the key from `inFlightRequests` inside `invalidateCache`. Stops new joiners.
- **Complete:** a per-key generation counter — bump on invalidation, capture when a request starts,
  discard the response if it no longer matches. **The cheap version does not close the hole**, because
  the *original* caller still awaits its own promise and will write the pre-push value when it resolves.
  It narrows the window; shipping it as the fix would leave a rarer version of the same bug.

Recorded on the entry so Lane A does not have to re-derive any of it, and so nobody ships the one-liner
believing it is done.

## Not done

**No reproduction was run.** This is traced from source against a device report; the device case is a
delete immediately after a Retry with the balance route slow rather than blocked. I did not attempt the
fix — `lib/sqlite/**` is Lane A's, and a change to the shared in-flight dedup touches every cached read
in the app, which is not a thing to do from the surface lane on a hypothesis I cannot exercise on the
device.

The entry keeps a `Keep:` noting the shipped half, so it does not read as unstarted.
