# 2026-09-26 — RV-201 ②: the weekly recap is a cached GET, and its prose is computed

**Branch:** `feat/rv201-weekly-digest-offline` · **Lane A** · closes `RV-201` (second half) and
`PS-31(a)`/`PS-31(b)`.

The first half took the model out of `ai/health-insight` (#1726). This is the other surface named
in the same entry, and the same move: `weekly-digest` no longer calls a model, and the route it
exposes is now a GET the client can cache.

## What shipped

- **`GET /api/weekly-digest`, and no POST at all.** Every number in the recap was already computed
  deterministically before the model was ever called — the model only wrote sentences about them.
  `buildWeeklyDigestText` (moved into `packages/shared/src/health/weekly-digest-metrics.ts`) now
  writes them, from the same `WeeklyDigestMetrics`.
- **The method was the point, not tidiness.** `cachedFetch` only caches GETs, so while this was a
  POST the week page's charts had no offline copy to paint from. There is deliberately no POST
  alias: it would be a path a future caller could take and silently lose that.
- **Both surfaces read one shared key**, `weekly-digest:<recap-week-monday>`, through
  `useCachedValue` with `WEEKLY_DIGEST_TTL`. Whichever of Home's banner and `/health/week` opens
  first pays for the request.
- **What went with the model:** the per-week `ai_health_insights` row, the 3-per-minute rate limit,
  and the `degradedFromFacts` catch path. The limiter guarded a paid call; a limiter over
  arithmetic is a way to fail a request for no reason. Rows written before this stay for history.
- **`useCachedValue` gained `reloadToken`** — the retry affordance for a card that failed. A
  refetch, not an `invalidateCache` of the key: purging throws away the best thing left to show,
  and a component calling `invalidateCache` is the #1279 shape the Custom Rules gate refuses.

## Three defects the work surfaced, none of them in the entry

1. **The banner's own `ta_weekly_recap_v1_<week>` localStorage entry was a second cache under the
   app's.** Nothing invalidated it, so a recap fetched before a late-logged Sunday session stood
   until the week rolled over. Gone; the shared key is cleared by four write groups
   (`invalidateWorkoutSummaries`, `invalidateOuraSync`, `invalidateBodyMetricWrite`,
   `invalidateBiometrics`).
2. **A hook cannot be skipped.** Moving the fetch into `useCachedValue` would have made a
   *dismissed* banner fetch on every Home mount, where it previously fetched nothing. The fetch
   lives in a child the dismissed branch never mounts. The source-scan test pins that ordering.
3. **"first week of data" was a false claim about the account.** The percentage is null both when
   there is no prior week and when the prior week logged no tonnage — a deload, or a pure-cardio
   week. The sentence is now reserved for a prior week with no sessions at all.

Two more came out of reading the rendered output rather than the code: the recovery bullet hung
one `overnight HRV` label off the front of a joined list, so a week without HRV read
"Recovery — overnight HRV readiness down 5 to 66"; and a sleep delta below the printed precision
rendered as `+0.0 h`, asserting a change the number beside it contradicted.

**`friendCount` is deliberately not rendered.** The prompt's line was "Friends training that week:
3 friends connected" — the value is how many friends are connected and says nothing about whether
any of them trained. Handing that to a model invited the claim that they had.

## Verification

- Full suite **10,254 passed / 87 skipped, exit 0**; lint **831**, exactly baseline; Custom Rules
  **80 of 80**.
- Mutation pass on the renderer, 3 real mutants + 1 equivalent control: reverting the recovery
  label to a prefix (4 tests died), dropping the sub-precision guard (2), rendering `friendCount`
  (2); the control — `> 0` to `>= 0` on a sign already guarded against zero — survived.
- **`pnpm dev`, which is where the last two defects came from.** GET 200 with
  `Cache-Control: private, no-store`; POST **405**; unauthenticated **401**. In a real browser at
  384 px: Home banner and `/health/week` both render from the GET; with the API stubbed 500 both
  show "Your week in review didn't load" and a working retry that refetches once and paints; with
  a warm cache and the API dead, the week page still paints its digest.

**Not exercised.** A true offline *navigation* — the headline claim — needs the service worker,
which `pnpm dev` does not run: a client-side route change offline never gets its RSC payload, so
the sandbox cannot show it. What was demonstrated is the half beneath it, that the cached value is
written under the shared key and paints when the API cannot answer. Also not exercised: the APK's
native SQLite cache (`getLocalStore` is null in the web sandbox), safe-area, and drifted
production data — the local seed has one sleep row and no sessions, so the empty-week branches got
far more coverage here than the populated ones, which only the route fixture covers.

Also untested by anything: with a **cold** cache and a genuine network failure (as opposed to a bad
response) the banner renders nothing rather than an error. That is `cachedFetch`'s deliberate
contract — "offline is not an error" — and is unchanged by this work, but it means the offline
error state people expect exists only after one successful visit.
