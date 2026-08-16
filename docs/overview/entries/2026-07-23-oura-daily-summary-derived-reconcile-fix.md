## 2026-07-23 — Fix: on-device Sync failure, oura_daily_summary/derived schema drift (v1.208.3)

**Branch:** `claude/oura-ondevice-hybrid-phase-2-f4ahnd`. Root-cause fix for the real on-device "Sync failed"
bug that the two prior error-surfacing PRs (#761, #769) were built to diagnose.

### The bug (confirmed on a real device)
"Sync now" on the owner's S25 failed. #761 surfaced the swallowed error (`no current transaction`); #769
found that was itself a masking symptom and unmasked the true failure:

> `SQL failed [INSERT INTO oura_daily_summary (...)]: table oura_daily_summary has no column named
> hrv_baseline_mean_x8`

**Rebuilding the APK did not fix it** — which ruled out the initial (reasonable) hypothesis that a stale
native Capacitor/SQLite plugin version was the cause, and confirmed this was a JS/schema bug.

### Root cause
**#725** (weeks earlier) extended `CREATE_OURA_DAILY_SUMMARY_LOCAL` (+13 baseline/`n_history` columns) and
`CREATE_OURA_DAILY_DERIVED_LOCAL` (+17 columns) in place, and shipped the fix behind a **v18 corrective
`DROP TABLE` + re-`CREATE`** migration. But a versioned migration only runs **once per device** — any device
that had already advanced past v18 *before* #725 shipped never re-runs it, and keeps the pre-#725 (17/19-column)
table forever. **The new columns were never registered in `RECONCILE_COLUMNS`** — the only mechanism that
self-heals unconditionally on *every* app open, not once per schema version. This is precisely the "17 tables
once missing from reconcile" bug class CLAUDE.md documents as this project's most-repeated local-schema
failure mode. Confirmed from the error itself: the first missing column named (`hrv_baseline_mean_x8`) is
exactly the first #725-added column after the old table's last column (`breath_avg_rpm`) — proof this device
is running the exact pre-#725 17-column schema.

### The fix
Registered all missing columns in `RECONCILE_COLUMNS` (`lib/sqlite/migrations.ts`):
- **`oura_daily_summary`**: 13 columns — the 12 `*_baseline_mean_x8`/`*_baseline_dev_x8` pairs + `n_history`.
- **`oura_daily_derived`**: 17 columns — `readiness_source`, `activity_contributors`, `training_load_high`,
  `worn_hours_ble`, `night_hrv_baseline_ms`, `illness_biomarkers`, `stress_high_minutes`,
  `recovery_high_minutes`, `chronic_stress_contributors`, `resilience_daily_stress`,
  `resilience_daily_restorative_time`, `resilience_daily_sleep_recovery`, `resilience_granular`,
  `resilience_confidence`, `vascular_age`, `pwv`, `body_comp`.

`reconcileSchema()` runs after every DB open via idempotent `PRAGMA table_info` + `ALTER TABLE ADD COLUMN` —
this self-heals on the device's very next app open. No wipe, no new schema version, no APK rebuild required.

### Known, non-blocking, deliberately-deferred
- Three columns (`illness_flag`, `illness_score`, `resilience_level`) changed **type** at #725 (not just
  added) on an affected device — reconcile can't retrofit a type change (it only adds missing columns).
  SQLite's loose column typing means read/write still works fine; not fixing now — out of scope for
  unblocking Sync.
- `oura_bucket`'s PK correction (the other half of #725/v18: `(tier, bucket_start_ds)` →
  `(tier, bucket_start_ms)`) likely also never applied on an affected device. Moot today — no local writer
  exists for `oura_bucket` until D2 ships. Flagged for when that lands.
- `/api/sync/oura-timeseries` (Track-B) still has no client driver — unrelated to this incident.

### Verification (sandbox)
- New regression test (`migrations.test.ts`): asserts every one of the 30 columns is present in
  `RECONCILE_COLUMNS`, tied explicitly to this incident (mirrors the existing "bug #85 guard" test style).
- `check-reconcile.js`: 34 tables / **101** columns tracked (was 71). `tsc`: only the 2 pre-existing
  `onnxruntime-web` errors. Changed-file eslint clean. `lib/local-store` + `lib/sqlite` + `lib/sync` green
  (72 tests).
- **Cannot be verified end-to-end in the sandbox** — this is precisely a real-device schema-drift bug that
  no fresh in-memory SQLite instance can reproduce (a fresh DB always gets the current, complete schema).
  **NOT yet confirmed fixed** — the owner needs to retry Sync/Restore once this deploys; that's the actual
  proof, not this PR's tests.

### User-visible → bumped
`package.json` 1.208.2 → **1.208.3** (patch, bug fix) + `lib/changelog.ts` entry.
