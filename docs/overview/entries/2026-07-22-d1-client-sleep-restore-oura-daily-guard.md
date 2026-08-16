## 2026-07-22 — D1 client batch (part 1): sleep restore-mapper widening + oura_daily clobber-guard

**Branch:** `claude/oura-ondevice-hybrid-phase-2-f4ahnd` — Phase-2 durability, the device-gated client
batch, first slice: the **restore data path** (the two confirmed review data-loss fixes). Client code —
**device-gated** (`getLocalStore` is null on web; runtime-verified only on the S25). No version bump.

### What shipped (the pull/apply/restore side)
- **Sleep restore-mapper widening (review R6 — the confirmed data-loss fix).** `LocalSleepSession` +
  both pull mappers (`sqlite-backend.ts getSleepSessions`, `sync-engine.ts` pull) + the `applyDelta`
  `sleep_sessions` upsert now carry the **12 Oura columns** the v18 RECONCILE added
  (`oura_id, efficiency, onset_latency_sec, average_hrv_ms, avg_heart_rate, lowest_heart_rate,
  restless_periods, sleep_score, respiratory_rate, sleep_phase_5_min, time_in_bed_hours, sync_status`).
  Before this, a restore returned sleep **stripped to stage-hours** — HRV/RHR/stages gutted. The server
  already emits every field (`db.select().from(sleepSessions)`); only the client wasn't storing them.
- **Sleep `applyDelta` clobber-guard.** The upsert gained `WHERE sleep_sessions.sync_status='synced'
  AND excluded.updated_at > sleep_sessions.updated_at` (was an unconditional `ON CONFLICT(id) DO UPDATE`)
  — so a future device-authored (BLE, `pending`) night can't be reverted by a stale pull. Conflict stays
  on `id` (server row id, stable for the mirror); `oura_id` keying belongs to the device-write path (D2).
- **`oura_daily` clobber-guard (D4 finding).** Added local `sync_status` column (RECONCILE_COLUMNS,
  Batch-F pattern — no version bump; `check-reconcile` tracks it, now 71 cols) + `syncStatus` on
  `LocalOuraDaily`. Converted the `applyDelta` block from `INSERT OR REPLACE` (delete+reinsert, which
  wipes a local `sync_status`) to a guarded `ON CONFLICT(day) DO UPDATE ... WHERE
  oura_daily.sync_status='synced' AND excluded.updated_at > oura_daily.updated_at`. All existing rows
  default `'synced'`, so the guard permits every forward mirror update (no behaviour change today; it
  becomes protective once D2's device writer sets `'pending'`).

### Verification (sandbox — compile + mock-SQL unit tests only)
- New `sqlite-backend.test.ts` cases (mock `runSQL`, assert the emitted SQL + params): sleep upsert
  carries all Oura columns + the clobber-guard + real param values (`oura-abc`/`62`/`1,2,3`);
  `oura_daily` upsert is `ON CONFLICT(day)` guarded, **not** `INSERT OR REPLACE`, contributors stringified.
- `tsc --noEmit`: only the 2 pre-existing `onnxruntime-web` errors — the new required type fields broke
  no other constructor (the only four were the mappers edited here). `check-reconcile` + `check-push-mutations`
  green; full `lib/local-store` + `lib/sqlite` + `lib/sync` suites green (65 tests, no regression).
- **NOT verified on device (the real gate):** native SQLite doesn't run in the web sandbox, so the actual
  local upsert, the v-schema RECONCILE add of `oura_daily.sync_status` on the S25's existing DB, and the
  wipe→restore returning sleep **with HRV/stages intact** can only be confirmed on the S25 APK
  (`docs/device-smoke-checklist.md` + the RST proof). Flagged in `projectOverview.md` Known-Issues.

### Deferred (rest of the client batch — with reasons)
- **`oura_daily_summary`/`oura_daily_derived` `applyDelta` local persistence** — large column surface
  (~29 + ~37 cols), and no local reader consumes them yet (the UI reads server); pure forward infra, its
  own focused PR when a local reader lands.
- **F4 mark-synced arms + device write helpers** (`upsertSleepSession`/`upsertOuraDaily` + `queueMutation`
  at the rollup site) — **D2-blocked**: nothing writes these rows as `pending` on-device yet, so an arm
  would be inert, untested surface (same call as B2's push side). Lands with the D2 device writer.
- **F3 client restore driver loop** (`pullDelta` outer `hasMore` + `?mode=restore` + loop-to-drain +
  restore trigger) — its own focused PR next; pairs with the F3-server route already on main.
- **Track-B push registration + B3 replace-by-day outbox** — D2-blocked, per the B2 entry.
