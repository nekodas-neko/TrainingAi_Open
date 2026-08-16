# 2026-07-21 — "Sync failed" toast root cause: Oura-BLE rollup saturating the DB pool

**Branch:** `claude/sync-error-investigation-gx4i9d` · **Version:** 1.188.1

Owner reported the home-screen **"Sync failed — will retry automatically"** toast and supplied
Railway logs. The sync routes themselves were healthy — the toast was a *symptom* of DB-connection
starvation driven by the Oura-BLE ingest path.

## Diagnosis (from the supplied logs)

- **HTTP logs:** `POST /api/oura-ble/samples` returning **499** (client-aborted) at **29–30 s**, even
  the "successful" ones at 12 s; `/api/sync/pull` all 200 but some at 6 s; `/api/sync/push` absent.
- **Network-flow logs → prod_DB:** `NO_SOCKET` and `TCP_INVALID_SYN` — the app intermittently
  failing to open TCP connections to Postgres (connection-ceiling / pool-exhaustion signature).
- **Root cause:** `/api/oura-ble/samples` ran `aggregateOuraRawSamples` **inline before responding**,
  and that rollup (a) fanned its tag reads out as a **10-way `Promise.all`** — one rollup checked out
  all 10 pool connections (`max:10`) at once, starving every other request (incl. the outbox
  `/api/sync/push`+`/api/sync/pull`) — and (b) was slow enough (12–30 s) to blow the native client's
  **30 s `readTimeout` → 499**. Because the ring's resume cursor only advances on a 2xx, a 499 held
  the cursor and **re-drained the same batch → re-ran the same rollup**: a self-sustaining retry storm
  that kept the pool pinned (→ the `NO_SOCKET`/`TCP_INVALID_SYN` DB-refusals) and intermittently made
  the outbox sync return null → the toast. No data was ever lost (raw rows insert before the rollup;
  re-sends dedup).

## What landed (both server-side JS — ship via Railway, no APK rebuild)

- **Single-connection rollup read** (`adapter.ts` `aggregateOuraRawSamples`). The 10 `rowsByTags`
  reads collapse into **one** `SELECT ... WHERE tag IN (…15 tags…)` partitioned in memory by tag
  (tags are disjoint; order preserved). One rollup now uses **one** connection, not ten.
- **Time-boxed, backgrounded rollup** (`app/api/oura-ble/samples/route.ts`). The rollup is raced
  against `ROLLUP_RESPONSE_DEADLINE_MS = 10 s` (well under the 30 s `readTimeout`). The POST returns
  **2xx** as soon as the durable insert is done — whether the rollup finishes inline (`aggregated`
  populated) or hits the deadline (`aggregateCoalesced: true`, rollup finishes in the background). A
  **per-user in-flight guard** (`rollupInFlight` map) prevents overlapping runs (concurrent
  `delete`+`upsert` on `sleep_sessions`/`body_metrics`) when batches arrive back-to-back. Rollup
  errors now surface only from the backgrounded `.catch` (`console.error` + `reportServerError`), so
  the response's `aggregateError` field is always null now (native client never read it).
- Added failure-matrix row **I19** to `docs/oura-ble-operations.md §1` for this signature.

## Verification

- Full suite green: **1901 tests / 273 files pass** (with local Postgres so the DB-gated Oura-BLE
  integration tests run — 29 aggregation tests confirm the single-query partition is
  behaviour-identical). tsc + lint clean (0 errors); `check-reconcile` + `check-push-mutations` OK.
- **Exercised against `pnpm dev` over real HTTP** (admin session on the local dev DB):
  unauth → 401; junk frames → 200 `stored:0` (no rollup); biometric `0x50`/`0x76` frame → 200
  `stored:1` with the **rollup branch firing** (`aggregated` populated), ~0.37 s; and — with the
  deadline temporarily set to 1 ms — the **deadline branch** → 200 `aggregateCoalesced:true`,
  `aggregated:null`, proving a slow rollup returns a fast 2xx instead of a 499.
- **NOT exercised in-sandbox:** the actual native POST path (the real 499/cursor-hold behaviour is a
  device concern), and a genuinely >10 s rollup under production data volume (the deadline branch was
  proven via the forced-1 ms deadline instead). Device-smoke after deploy: trigger a ring drain
  (pull-to-sync on the S25 APK), confirm `/api/oura-ble/samples` returns 2xx promptly (no 499) and
  the home "Sync failed" toast no longer appears while the ring is draining.
