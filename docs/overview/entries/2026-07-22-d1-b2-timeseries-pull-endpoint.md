## 2026-07-22 — D1/Track-B B2+B4+B5 (server): dedicated timeseries pull endpoint

**Branch:** `claude/oura-ondevice-hybrid-phase-2-f4ahnd` — Phase-2 durability Track B, tasks **B2**
(dedicated pull), **B4** (monotonic-updated_at safety), **B5** (concurrent-pool gate). Server-only,
sandbox-verified; no user-visible change (no version bump). The review's highest-risk area.

### What shipped
- **`getOuraTimeseriesDelta(userId, {heartrate?, bucket?, budget?})`** (`slices/oura.ts`) — serves
  `oura_heartrate` + coarse `oura_bucket` on **ONE checked-out pool connection** (the
  `vacuumOuraRawSamples` single-connection precedent; sequential awaits, `release()` in `finally` —
  **never** a `Promise.all` of two pooled reads, the I19 pool-starvation lesson). Exposed via the
  adapter + `WorkoutRepository` interface. These two tables are deliberately **outside** the shared
  `getSyncDelta` fan-out / `SyncDelta` type.
- **Exact keyset `(updated_at, id)` cursor, scoped to this endpoint only.** `WHERE user_id AND
  (updated_at > ts OR (updated_at = ts AND id > id)) ORDER BY updated_at, id LIMIT budget`, hitting the
  `(user_id, updated_at, id)` index from migrations 130/137. The shared scalar `−1ms` cursor in
  `lib/sync/cursor.ts` is **untouched** (pin honoured) — the lossy overlap it needs cross-domain is
  replaced here by an exact tiebreak because this path is single-domain per query.
- **`POST /api/sync/oura-timeseries`** — auth, Zod body (two optional per-domain cursors + optional
  budget), its own rate-limit bucket `oura-timeseries:${userId}` (120/min — generous for a sequential
  restore drain, distinct so it neither starves nor is starved by the pull/push cadence),
  `private, no-store`. Per-domain page bounded by `TIMESERIES_ROW_BUDGET = 2000`; real `hasMore` drives
  the restore drain loop.
- Retention parity: HR is a rolling **180-day** window (existing prune in `upsertOuraHeartrate`); coarse
  buckets are **forever** (no prune). The server `oura_bucket` table is device-fed, **coarse-tier only by
  construction**, so the endpoint needs no tier filter.

### B4 resolution (honest)
The keyset cursor makes per-row-monotonic `updated_at` **non-load-bearing for this endpoint**: a whole
rollup chunk stamped with one `now()` still drains fully because `id` disambiguates ties — proven by the
`sharedUpdatedAt` drain test (the exact batch the scalar cursor would stall on forever). **Accepted bounded
re-pull:** the server HR rollup (`adapter.ts` `upsertOuraHeartrate` via delete-source=ble-in-window +
re-insert) restamps ~the last 14 days' `updated_at` each run, so a synced client re-pulls that bounded
span next sync. Making the device the sole HR writer (so the server delete-reinsert stops) is deferred to
the **C1** single-writer flip, per the B2 amendment — not this PR.

### Deferred (device-gated `[D]` / D2-blocked)
- **Push side.** Push reuses the shared pool-safe outbox, but registering `oura_heartrate`/`oura_bucket`
  in `SYNCED_MUTATION_DOMAINS` + the `MutationDomain` union + a `pushMutations` branch only pays off once
  the **device** actually queues these (B3 replace-by-day outbox), which is D2-blocked (no on-device
  rollup writes these local tables yet). Shipping inert server push handlers ahead of their only caller
  would be untested surface — folded into the client batch where the device queueing + a push round-trip
  test land together.
- **Client apply.** No `oura_heartrate`/`oura_bucket` local tables / `applyDelta` mapping / restore-loop
  consumer exist yet (`getLocalStore` is null on web) — all ride the device-gated client batch + the RST
  wipe→restore proof. **Bucket pull returns empty until then** (dormant infra, like F3-server).

### Verification (sandbox)
- New DB-backed `oura-timeseries-pull.test.ts` (5 cases): **B2** keyset drains a 130-row series in 3
  pages, no dup/skip, ordered; **B4** a 130-row single-`updated_at` batch drains fully; empty series →
  cursorless drained page; coarse bucket round-trips full columns; **B5** 10 concurrent full-restore
  drains each see all 600 rows, `pool.totalCount ≤ 10`, `waitingCount = 0`, no connection leak.
- New pure-mock `route.test.ts` (6 cases): 401/429/400 gates, cursor+budget plumbing, dedicated bucket.
- `tsc --noEmit`: only the 2 pre-existing `onnxruntime-web` errors. Changed-file eslint 0 errors;
  `check-push-mutations` + `check-reconcile` green; `lib/sync` + B1/F1 suites re-ran green (no regression).
- **Half:** server-only, non-destructive. The route is live but has no client caller yet — dormant until
  the device batch wires the drain loop; nothing existing calls `getOuraTimeseriesDelta`.
