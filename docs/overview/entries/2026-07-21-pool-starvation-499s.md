## 2026-07-21 — "Sync failed" / 499s on aggregate GETs: cold-start + body-battery mitigations (v1.195.4)

**Branch:** `fix/pool-starvation` — owner reported the home "Sync failed" toast + sections not loading,
and supplied Railway HTTP logs (right after a 10:38 PM deploy) showing `/api/progress-summary`,
`/api/workout-data`, `/api/training-load`, `/api/body-battery` returning **499** (client-aborted /
too slow) while lighter endpoints returned 200 — and `body-battery` returning both a 499 and a 200,
i.e. intermittent **DB connection-pool contention**.

### Diagnosis (agent-assisted, code-traced)
Recurrence of the fan-out/thundering-herd class, this time on the **read** side (not the Oura-BLE
ingest, whose prior fix is intact):
- Home and Health each fire ~13–15 aggregate `/api/*` GETs in one near-simultaneous burst, and each
  of the four slow endpoints internally fans out a **6–7-wide `Promise.all`** — every branch checks
  out its own connection from the `max: 10` pool. Two or three firing together demand 20+ connections;
  the overflow queues past the client's abort threshold → 499. (The widest/heaviest — progress-summary,
  body-battery, workout-data — are exactly the ones that lose.)
- **Cold start compounds it:** `ensureSchema()` (the ~130-file migration sweep) ran lazily on the
  *first* request via the memoised `getRepository()`; every early request after a deploy blocked on
  that one promise while it held a pool connection — a clean explanation for 499s *right after* a deploy.
- `body-battery` was the only one of the four that **writes on every read** (two awaited upserts
  before responding) and had the shortest TTL (15 s), so it re-hit the DB most often and held a
  connection longest.

### What landed here (both server-side JS — ship via Railway, no APK rebuild)
- **`instrumentation.ts`** (new) — Next 15 server-boot hook that warms `getRepository()` (→
  `ensureSchema`) once at process start, moving the migration sweep off the first-request path so the
  post-deploy burst no longer races it. Best-effort: `getRepository()` already self-heals a failed
  `ensureSchema` (clears the cached promise, retries next call), so a boot failure is harmless.
- **`app/api/body-battery/route.ts`** — the two best-effort snapshot upserts
  (`upsertOuraDailyDerived` stress summary + `upsertBodyBatteryDaily`) are now **fire-and-forget**
  (each with a `.catch`, settled in the background on the long-lived Node server) instead of awaited
  before the response, so the read returns promptly and doesn't hold a pool connection for the writes.
  TTL raised `max-age=15 → 60` (`stale-while-revalidate=30 → 120`) to match its siblings and cut re-hit
  frequency ~4×.

### Deferred follow-ups (recommended, NOT done here — need real load to validate; recorded so they
### aren't dropped)
- **Cap the client aggregate-fetch burst concurrency** (Home + `fetchAllHealthData`'s ~15-wide
  `Promise.allSettled` in `app/health/health-content.tsx`) to ~3–4 so the outer burst can't demand
  >10 inner connections at once. Highest-leverage remaining fix, but touches the hot first-paint path
  and can't be load-tested in the sandbox — hold for owner sign-off / device testing.
- **Batch `workout-data?tab=all`'s per-session `getSessionPeriodization` `Promise.all`**
  (`route.ts:141`) into one `sessionId IN (…)` query (same fan-out class the prior incident flagged).
- **Combine the always-co-loaded health summaries** (`progress-summary` + `training-load`) into one
  endpoint to cut request count + duplicate `getActiveProgram`/session reads.

### Verification
- `tsc --noEmit`, `eslint` (0 errors), `pnpm test` (**1914 passed**) on a fresh CI-style DB;
  body-battery route tests pass. `pnpm dev` boots with `instrumentation.ts` compiled/registered (no
  boot errors); `/api/body-battery` still serves (401 unauth as expected).
- **NOT verified in-sandbox:** the actual pool contention under production concurrency and the
  post-deploy cold-start timing — those are prod-load behaviours. Device/prod check after deploy:
  watch a fresh-deploy load and confirm the four endpoints return 200 (no 499) and the "Sync failed"
  toast doesn't fire while the ring is idle.
