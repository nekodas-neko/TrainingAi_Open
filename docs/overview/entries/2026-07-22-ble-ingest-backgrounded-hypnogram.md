## 2026-07-22 — BLE ingest fully backgrounded + read-burst cap (fixes "Sync failed" recurrence + missing hypnogram) (v1.195.5)

**Branch:** `fix/ble-ingest-pool` — owner reported the "Sync failed" toast STILL firing after v1.195.4, plus
the sleep **hypnogram had vanished** on recent nights (a regression). Railway HTTP logs showed
`/api/oura-ble/samples` at **16 s / 499 @ 30 s**, `POST /api/sync/push → 502`, `/ → 499`.

### Diagnosis — one root cause behind both symptoms
`#722` added on-device **SleepNet ONNX inference** (`sleepNetStages5Min`) *inside* the BLE rollup
`aggregateOuraRawSamples` (`adapter.ts:4383`). The I19 fix (v1.188.1) had time-boxed the rollup to 10 s
but still **awaited** that race inline, so the much-heavier rollup + the POST's own raw-insert, under the
concurrent Home/Health read-herd (~15 aggregate GETs each fanning 6–7 queries against the `max:10` pool),
pushed `/api/oura-ble/samples` past the native **30 s `readTimeout` → 499 → cursor-hold → re-drain**. The
same stalled rollup never finished the sleep-staging write, so `sleep_phase_5_min` stayed null → the
hypnogram (which renders from that field) disappeared on recent nights. So the sync error and the
hypnogram were the **same** choke, not two issues. (Failure-matrix row **I20** added to
`docs/oura-ble-operations.md §1`.)

### What landed (server + client JS — ships via Railway, no APK rebuild)
- **Fully background the rollup** (`app/api/oura-ble/samples/route.ts`). Removed the 10 s
  `Promise.race` inline wait — the POST returns as soon as `insertOuraRawSamples` is durable and
  **never awaits** the rollup. The run stays referenced via `rollupInFlight` (with its existing
  `.catch`/`.finally` + per-user in-flight guard) so it — and the sleep-staging write — still land.
  `aggregated` is now always null in the response (the native client never read it); `aggregateCoalesced`
  is always true when a rollup was triggered. Deleted `ROLLUP_RESPONSE_DEADLINE_MS`.
- **Concurrency-cap the Home/Health aggregate-fetch burst.** New `lib/async/run-with-concurrency.ts`
  (Promise.allSettled semantics, in-order, bounded). `health-content.tsx`'s ~13-wide `Promise.allSettled`
  now runs through `runWithConcurrency(thunks, 4)` so it can't demand more than the 10-connection pool at
  once. Cache-seeded first paint is unaffected (each card seeds synchronously from `readCacheSync`); only
  the background revalidation staggers.
- Cold-start slice already covered by the boot-time schema warm-up (v1.195.4, `instrumentation.ts`).

### Verification
- `tsc --noEmit`, `eslint` (0 errors), `pnpm test` (**1917 passed** — +3 for the new concurrency-helper
  unit test) on a fresh CI-style DB, `pnpm build` green (all 195 pages).
- **NOT verified in-sandbox** (prod-load / device behaviours): the actual pool contention under
  production concurrency, the real 30 s→fast-2xx change on the native POST, and the hypnogram returning
  once the background rollup lands `sleep_phase_5_min`. Post-deploy check: watch a ring drain on the S25,
  confirm `/api/oura-ble/samples` returns 2xx promptly (no 499), the "Sync failed" toast doesn't fire, and
  the sleep-stage ribbon reappears on the latest night (tap **Redecode** if a night lags).

### Still deferred (recorded, not done)
- Home screen's own multi-effect fetch burst isn't concurrency-capped (only Health's single
  `Promise.allSettled` was) — revisit if the home 499s persist after this.
- Moving SleepNet inference off the ingest path entirely (a queue / separate worker) if backgrounding
  alone doesn't keep the rollup from lagging under real drain volume.
