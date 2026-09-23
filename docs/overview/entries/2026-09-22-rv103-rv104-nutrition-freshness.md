# 2026-09-22 — RV-103 / RV-104: nutrition freshness (`fix/rv103-rv104-nutrition-freshness`)

Batch `nutrition-freshness`, both entries from Review sweep 53. Both are the Q-402 shape — the
eviction lands and nothing asks for a new value — so neither fix adds an invalidation. Every key
involved was already in `invalidateNutritionWrite()` and always had been.

## RV-104 — the weekly chart and adherence, subscribed rather than remembered

`nutrition-weekly-summary` and `nutrition-adherence` were fetched **only** from `fetchMountData`,
whose effect deps are stable, on a screen the tab shell never unmounts. So the 7-day calorie chart
and the adherence percentages held their launch-time values until the app was restarted; a tab
switch did not help, because `useRefreshOnTabShow` re-runs `fetchData` (logs + balance), never
`fetchMountData`. The asymmetry that made it visible: the delete path had learned to refetch the
weekly summary by hand and the add path had not.

Fixed as a shape, not a site — `app/nutrition/use-nutrition-derived-refresh.ts` owns both fetches
and subscribes both keys through `useInvalidationRefetch`, so every write path present and future
refreshes them. The delete path's hand-rolled refetch is gone. BF-177 was patched site-by-site
three times; a fourth site was always going to appear.

**Verified on the running app**, not inferred: `e2e/rv104-weekly-refetch-after-log.spec.ts` logs a
food and asserts both endpoints are requested without navigating. It was confirmed to **fail with
the subscription disabled and pass with it** — and the dev server's own log shows
`POST /api/nutrition/food-logs 201` followed by `GET …/weekly-summary` and `GET …/adherence`,
which the add path never produced before.

## RV-103 — the refetch that could not report its own failure

Three defects, all in `app/nutrition/use-energy-balance-refetch.ts`:

1. `void cachedFetch(...).catch(() => {})` — per RV-84 `cachedFetch` never rejects, so that was
   dead code standing in for error handling. Now `fetchWithRetry`, whose `onExhausted` (RV-85) is
   the one moment a caller can tell a slow load from a failed one; `EnergyCard` renders a failure
   line and a Retry.
2. `d => setBalance(d ?? null)` wrote **null** on an empty payload, and `balanceForDate` is gated on
   the payload's date — so the budget and the macro targets *disappeared* rather than going stale.
   Now `if (d) setBalance(d)`.
3. **Found while reproducing it, and it would have made the whole mechanism inert:** the unmount ref
   was set in a cleanup and never reset, so StrictMode's simulated unmount latched it `true` for the
   life of the screen and `isCancelled()` killed every retry. Driving the real screen with the
   balance route aborted counted **one** request where four were due.

### What is NOT established, and why the spec for it was deleted rather than shipped

`cachedFetchCore`'s network-throw branch computes `const online = cached === null && navigator.onLine`
and fires `onError` only when `online`; its `!res.ok` branch is gated the same way. **So no caller
can be told that a revalidation failed whenever a cached value was painted** — and `fetchWithRetry`
has the mirror-image blind spot, counting a cached paint as a response. Together they mean RV-103's
suggested fix, *"pass `onError`"*, cannot reach the case it was written for.

Driving `/nutrition` with `/api/nutrition/energy-balance` aborted, the same code both reported and
stayed silent on consecutive runs, decided by whether the entry happened to be in the cache when the
refetch ran. **The flake was the finding.** Exhaustion was observed firing once in five runs. A spec
that green-lights a mechanism half the time is a tax on every future session, so it was dropped
rather than retried into submission; the report path is wired and strictly additive (absent the
flag nothing renders, which is today's behaviour) and is recorded as unproven rather than done.

Filed as **LB-128** for Lane A, which owns `lib/sqlite/cache.ts`: an ungated `onRevalidateError`
for the case where the caller knows the cached value is out of date because it just wrote. The
entry carries the warning not to simply ungate `onError` — every existing caller reads it as "I
have nothing to show", and `useCachedValue` renders an error state on it.

## Not exercised

Native SQLite / Capacitor (the web path takes the API fallback throughout), safe-area insets,
Samsung WebView rendering, drifted production data, real Oura/Health Connect tokens. **No device
sitting** — the failure line and its Retry at the S25 width are owed, and RV-103 keeps that.
