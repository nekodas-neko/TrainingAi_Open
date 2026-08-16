## 2026-07-21 — D1/A3 (server push half): sleep_sessions push domain

**Branch:** `claude/oura-ondevice-hybrid-5xycdr` — Phase-2 durability Track A, task **A3**, server push half.
Makes `sleep_sessions` a push-capable sync domain (it was pull-only) so device-derived BLE sleep backs up
to Railway. Server-only; no user-visible change; no version bump.

### What shipped (server; sandbox-tested, CI-gated)
- **Domain wiring:** `sleep_session` added to `MutationDomain` + `SYNCED_MUTATION_DOMAINS` + the
  `DOMAIN_LABELS` record (exhaustive → TS-forced).
- **Push branch** → delegates to the shared **`upsertOuraSleep(userId, [row], 'oura_ble')`** (the same fn
  the Cloud sync + BLE aggregate use). Critically NOT a plain upsert: `upsertOuraSleep` does the
  `sourceMap`/`mergeSet` per-field rank merge, so a device BLE push (rank 3) never stomps a higher-ranked
  Samsung-Health/manual (rank 4) field. Natural key `(user_id, sleep_start)`; dedup id `oura_id`. A payload
  missing `ouraId`/`sleepStart`/`sleepEnd` throws → per-item quarantine (never wedges the queue, never
  upserts a bad row).
- **No pull change:** `getSyncDelta` already `SELECT *`s `sleep_sessions` (all Oura columns —
  `average_hrv_ms`, `avg_heart_rate`, `lowest_heart_rate`, `efficiency`, `sleep_score`, etc.) and already
  has its cursor page + `SyncDelta` member. The server side is complete; the restore-mapper **gutting** (the
  client keeps only 6-7 fields on `applyDelta`) is the **client half**, out of scope here.

### Verification
- `pnpm exec tsc --noEmit` 0 new errors (2 pre-existing `onnxruntime-web`); changed-file lint 0 errors;
  `check-push-mutations` green; **126 postgres+sync tests pass**.
- New DB-backed test `oura-sleep-push-sync.test.ts` (4 cases): push lands the BLE row with Oura columns +
  `source_map=oura_ble`; `getSyncDelta` returns it with the Oura columns; the **source-merge guarantee** (a
  seeded manual `avg_heart_rate` survives the oura_ble push while an untouched field is filled); and a
  missing-natural-key mutation is **quarantined** while its valid sibling still processes.
- **Half:** server-only. The device-gated client half (`applyDelta` restore-mapper widening +
  `oura_id`-keyed id-reconciliation + `sync_status='synced'` clobber-guard + `queueMutation`) is batched.

### Next
- A4-server: `body_metrics` — fix the `source='manual'` hardcode to thread `payload.source` (a **live latent
  bug**: an `oura_ble` push is currently misfiled as rank-4 manual and would stomp genuine manual values) +
  `oura_daily`. Then the batched device-gated client halves for the S25.
