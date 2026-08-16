# Oura Raw-On-Device — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the on-device raw store + on-device rollup **in parallel** with the existing server pipeline — raw lands durably in a native `oura_raw.db`, the ring history cursor advances on local-SQLite commit, and the WebView decodes + rolls up into new local tables — **without removing or changing the server path** (raw keeps dual-writing to Railway, so the server rollup stays the backup backstop).

**Architecture:** Device-primary (Garmin / Samsung Health / Apple Health pattern): the phone computes everything including ML; Railway is backup/sync only. Phase 1 is purely **additive** — it adds the device pipeline alongside the server one. Read-flip to local-first, the derived→Railway outbox, retiring server ingest, and the 437k-row drop are **Phases 2–4** and are explicitly out of scope here. This ordering is required by the parent spec's decision **D2** (never ship the local-commit cursor gate before a proven off-device backup exists — here the still-running server rollup *is* that backup).

**Tech Stack:** Kotlin (`android/app/.../oura/`), Capacitor plugin bridge, `@capacitor-community/sqlite` (`trainingai` DB) + a native `android.database.sqlite.SQLiteDatabase` (`oura_raw.db`), TypeScript decoders/rollup (`lib/oura-ble/`, `lib/oura-models/`), `onnxruntime-web` (WASM) for the neural models, Vitest for sandbox unit tests.

**Parent spec (read first):** [`2026-07-21-oura-raw-on-device-architecture.md`](2026-07-21-oura-raw-on-device-architecture.md) — especially the **Review Outcome** section (the locked decisions D1/D2 and the pinned engineering rules) and §11 (findings). **Also read:** CLAUDE.md (Local SQLite Migrations, Offline Sync, Oura Direct-BLE), [`docs/oura-ble-operations.md`](../../oura-ble-operations.md), the `oura-native-ble` skill.

**Sandbox limits (state in every PR which half you touched):** native Kotlin is **compile-gated only** in the sandbox (no Android SDK, Gradle proxy-blocked) and needs an **owner APK rebuild** (`npx cap sync android && ./gradlew assembleDebug`); the Capacitor local store returns `null` on web, so local-store code is **device-verified only**. JS/server ships via Railway into the WebView with no rebuild. Pure TS functions (decoders, rollup math, promotion) **are** unit-testable in the sandbox — those tasks are TDD. Everything touching the ring, `oura_raw.db`, or the WebView SQLite is verified on-device via [`docs/device-smoke-checklist.md`](../../device-smoke-checklist.md) + the ops-doc §4 1:1 runbook.

---

## Task ordering & dependency

```
Task 0 (WASM parity SPIKE — GATE) ──▶ blocks Task 6 (neural in WebView) only
Task 1 (local tables + RECONCILE) ──▶ Task 5, Task 6, Task 7
Task 2 (oura_raw.db + cursor gate) ─▶ Task 3 ──▶ Task 5
Task 4 (on-device clock anchor) ────▶ Task 5
Task 5 (deterministic rollup port) ─▶ Task 6 (neural) ──▶ Task 7 (promotion) ──▶ Task 8 (prune) ──▶ Task 9 (storage UI)
```

Task 0 is the **gate for the neural half only** — Tasks 1–5 (raw store, cursor, deterministic rollup) can proceed in parallel with the spike. If Task 0 fails parity, Task 6 falls back to heuristic-only staging (documented) and the neural metrics (SleepNet stages, BDI, dHRV-resilience) stay server-computed until resolved — the rest of Phase 1 is unaffected.

---

## Task 0: WASM neural-parity + S25-perf spike (GATE for the neural half)

**Why:** The rollup runs 8 ONNX models under `onnxruntime-node` (native addon, server-only) — SleepNet (`sleepnet_moonstone_1_2_0.onnx`, staging + BDI) and dHRV imputation (→ resilience). Decision D1 is on-device WASM (`onnxruntime-web`). Before building on it, prove the WASM runtime reproduces the server numbers on real nights and is fast enough on the S25. If it can't, we learn it in a day, not in Phase 3.

**Files:**
- Create: `scripts/spikes/wasm-onnx-parity.ts` (throwaway harness — delete or move to a test after)
- Create: `lib/oura-models/inference/session-web.ts` (the WASM sibling of `lib/oura-models/inference/session.ts`)
- Reference: `lib/oura-models/inference/session.ts` (the node loader), `lib/oura-models/goldens/` (captured vectors), `lib/data/postgres/adapter.ts:4383` (SleepNet call site), `lib/oura-ble/daytime-stress.ts:87` (dHRV call site)

- [ ] **Step 1: Install the WASM runtime**

Run: `pnpm add onnxruntime-web`
Then commit `package.json` + `pnpm-lock.yaml` together.

- [ ] **Step 2: Write the WASM session loader**

Mirror `session.ts` but with `onnxruntime-web`. It must load the same `.onnx` files. In the spike, read them from disk; in production (Task 6) they load as WebView assets served from Railway.

```ts
// lib/oura-models/inference/session-web.ts
import * as ort from 'onnxruntime-web'

// Model bytes are injected by the caller (Node: fs.readFile; WebView: fetch asset).
export async function createWebSession(modelBytes: Uint8Array): Promise<ort.InferenceSession> {
  return ort.InferenceSession.create(modelBytes, { executionProviders: ['wasm'] })
}

export async function runWeb(
  session: ort.InferenceSession,
  feeds: Record<string, ort.Tensor>,
): Promise<ort.InferenceSession.OnnxValueMapType> {
  return session.run(feeds)
}
```

- [ ] **Step 3: Write the parity harness**

Load each golden night's model input, run it through BOTH `onnxruntime-node` (the current server path) and `onnxruntime-web`, and compare. The pass bar: **per-epoch sleep-stage labels must match exactly**; continuous heads (BDI, dHRV) within a tight absolute tolerance.

```ts
// scripts/spikes/wasm-onnx-parity.ts
import fs from 'node:fs/promises'
import path from 'node:path'
import * as ortNode from 'onnxruntime-node'
import { createWebSession, runWeb } from '@/lib/oura-models/inference/session-web'

const MODELS = ['sleepnet_moonstone_1_2_0_core.onnx', 'dhrv_imputation_1_1_0.onnx']
const STAGE_TOL = 0          // sleep-stage labels: exact match required
const CONT_TOL = 1e-3        // continuous heads: abs tolerance

async function main() {
  for (const model of MODELS) {
    const bytes = await fs.readFile(path.join(process.cwd(), 'lib/oura-models/onnx', model))
    const nodeSess = await ortNode.InferenceSession.create(bytes)
    const webSess = await createWebSession(new Uint8Array(bytes))
    // Load each captured golden input tensor set for this model:
    const inputs = await loadGoldenInputs(model)   // from lib/oura-models/goldens/
    let maxDiff = 0, stageMismatches = 0
    for (const feeds of inputs) {
      const nOut = await nodeSess.run(feeds)
      const wOut = await runWeb(webSess, feeds as any)
      const key = Object.keys(nOut)[0]
      const n = nOut[key].data as Float32Array
      const w = wOut[key].data as Float32Array
      for (let i = 0; i < n.length; i++) {
        const d = Math.abs(n[i] - w[i]); if (d > maxDiff) maxDiff = d
      }
      if (model.startsWith('sleepnet')) stageMismatches += countArgmaxMismatches(n, w)
    }
    console.log(`${model}: maxDiff=${maxDiff.toExponential(2)} stageMismatches=${stageMismatches}`)
    if (model.startsWith('sleepnet') && stageMismatches > STAGE_TOL) throw new Error(`SleepNet stage mismatch: ${stageMismatches}`)
    if (!model.startsWith('sleepnet') && maxDiff > CONT_TOL) throw new Error(`${model} exceeds tol: ${maxDiff}`)
  }
  console.log('PARITY PASS')
}
main().catch(e => { console.error('PARITY FAIL:', e.message); process.exit(1) })
```

- [ ] **Step 4: Run the parity harness in the sandbox**

Run: `pnpm tsx scripts/spikes/wasm-onnx-parity.ts`
Expected: `PARITY PASS`. If it fails, record the max diff / stage-mismatch count in the PR and **STOP the neural half** — Task 6 falls back to heuristic-only staging (see its Step "fallback"), and the neural metrics stay server-side pending a follow-up (e.g. quantization-aware re-export). This does not block Tasks 1–5.

- [ ] **Step 5: Measure S25 perf AND re-run parity on-device (DEVICE)**

CI parity (`wasm-parity.test.ts`) runs onnxruntime-web under **Node's** WASM backend; the **S25 WebView may negotiate different execution-provider options** (SIMD / multi-thread / relaxed-SIMD), which change reduction order and rounding — so CI-green does NOT guarantee the device won't shift a stage. Two things on-device: (a) **pin the EP options** in `session-web.ts` (don't leave SIMD/threads to WebView defaults — set them explicitly so device == CI config); (b) **run the same golden fixtures** (the `ramp` input + `moonstone_ramp_staging.bin`/`_apnea.bin`, `dhrv_imputation_1_1_0_dhrv.bin`) in the WebView and assert the **same exact-match bar** as CI. THEN measure perf: load the WASM SleepNet, run one full night's inference, log wall-clock + a Chrome-remote memory snapshot. **Pass bar:** parity matches the golden exactly on-device AND a night's rollup (both models) completes in < ~10 s on app-foreground without OOM. Record both in the PR. Device-only — cannot run in the sandbox.

- [ ] **Step 6: Commit the spike + decision**

```bash
git add package.json pnpm-lock.yaml lib/oura-models/inference/session-web.ts scripts/spikes/wasm-onnx-parity.ts
git commit -m "spike: WASM onnx parity harness for on-device neural rollup"
```

Record the PASS/FAIL + the S25 timing as a note in the parent spec's Review Outcome and (if PASS) proceed. If FAIL, open a Known-Issues row and route Task 6 to the fallback.

---

## Task 1: Local calculated-form tables + RECONCILE registration (JS/server; device-verified)

**Why:** The device rollup needs local tables to write into. Today the local store has only a pull-only `oura_daily` cache; `oura_daily_summary`, `oura_daily_derived`, `oura_heartrate` have **no** local table, and local `sleep_sessions` lacks every Oura column. Add them all + a wide `oura_bucket` tier table, register them in RECONCILE (CI-enforced), and add accessors. **No PRAGMAs in the upgrade; every table/column also in RECONCILE in this same commit** (CLAUDE.md Local SQLite Migrations).

**Files:**
- Modify: `lib/sqlite/migrations.ts` (add `toVersion: 17` block; add `CREATE_*` consts; register in `RECONCILE_TABLES`, `RECONCILE_INDEXES`, `RECONCILE_COLUMNS`)
- Modify: `lib/local-store/sqlite-backend.ts` (accessors)
- Modify: `lib/local-store/index.ts` (interface additions)
- Modify: `lib/local-store/types.ts` (row types)
- Verify: `scripts/check-reconcile.js` (CI — must pass)

- [ ] **Step 1: Add the local table DDL consts**

Add to `lib/sqlite/migrations.ts` (near the other `CREATE_*` consts). `oura_bucket` carries the offline-first trio (`updated_at`, `sync_status`) — no `deleted_at` (buckets are never user-deleted). Every metric column nullable.

```ts
export const CREATE_OURA_BUCKET = `CREATE TABLE IF NOT EXISTS oura_bucket (
  tier TEXT NOT NULL, bucket_start_ds INTEGER NOT NULL, bucket_start_ms INTEGER NOT NULL,
  local_date TEXT NOT NULL,
  hr_mean REAL, hr_min REAL, hr_max REAL, hrv_rmssd_ms REAL,
  spo2_pct REAL, perfusion_index REAL, skin_temp_c REAL,
  met_mean REAL, met_minutes REAL, motion_mad REAL, ibi_ms TEXT,
  sample_count INTEGER,
  updated_at TEXT NOT NULL, sync_status TEXT NOT NULL DEFAULT 'pending',
  PRIMARY KEY (tier, bucket_start_ds)
)`
export const CREATE_OURA_DAILY_SUMMARY_LOCAL = `CREATE TABLE IF NOT EXISTS oura_daily_summary (
  day TEXT PRIMARY KEY, sleep_duration_hours REAL, sleep_efficiency REAL,
  deep_sleep_hours REAL, rem_sleep_hours REAL, restless_periods INTEGER,
  sleep_latency_sec INTEGER, hrv_avg_ms REAL, rhr_low_bpm INTEGER, rhr_avg_bpm INTEGER,
  recovery_index_hours REAL, temp_mean_c REAL, temp_dev_c REAL, met_avg REAL, breath_avg_rpm REAL,
  updated_at TEXT NOT NULL, sync_status TEXT NOT NULL DEFAULT 'synced'
)`
export const CREATE_OURA_DAILY_DERIVED_LOCAL = `CREATE TABLE IF NOT EXISTS oura_daily_derived (
  day TEXT PRIMARY KEY, source TEXT, model_versions TEXT,
  sleep_score INTEGER, sleep_contributors TEXT, readiness_score INTEGER, readiness_contributors TEXT,
  activity_score INTEGER, active_calories_est INTEGER, training_load_ots REAL,
  recovery_index_hours REAL, illness_flag INTEGER, illness_score REAL,
  daytime_stress_scaled REAL, chronic_stress_score REAL, resilience_level TEXT, bdi_derived REAL,
  updated_at TEXT NOT NULL, sync_status TEXT NOT NULL DEFAULT 'synced'
)`
export const CREATE_OURA_HEARTRATE_LOCAL = `CREATE TABLE IF NOT EXISTS oura_heartrate (
  ts_ms INTEGER PRIMARY KEY, bpm INTEGER NOT NULL, source TEXT NOT NULL,
  updated_at TEXT NOT NULL, sync_status TEXT NOT NULL DEFAULT 'synced'
)`
```

Also add the Oura columns the local `sleep_sessions` lacks (via `RECONCILE_COLUMNS`, the additive Batch-F pattern — no versioned ALTER needed): `oura_id`, `efficiency`, `onset_latency_sec`, `average_hrv_ms`, `avg_heart_rate`, `lowest_heart_rate`, `restless_periods`, `sleep_score`, `respiratory_rate`, `sleep_phase_5_min`, `time_in_bed_hours`, and `sync_status`.

- [ ] **Step 2: Add the v17 migration block + RECONCILE registration**

```ts
// in MIGRATIONS array:
{ toVersion: 17, statements: [
  CREATE_OURA_BUCKET, CREATE_OURA_DAILY_SUMMARY_LOCAL,
  CREATE_OURA_DAILY_DERIVED_LOCAL, CREATE_OURA_HEARTRATE_LOCAL,
] },
```

Add all four consts to `RECONCILE_TABLES`; add an index const `CREATE INDEX IF NOT EXISTS oura_bucket_date ON oura_bucket(local_date)` to `RECONCILE_INDEXES`; add every new `sleep_sessions` column to `RECONCILE_COLUMNS` as `{ table: 'sleep_sessions', column, ddl }` rows.

- [ ] **Step 3: Run the reconcile CI check**

Run: `node scripts/check-reconcile.js`
Expected: exit 0 (every migration-created table/column present in RECONCILE). If it fails, it prints the missing table/column — add it.

- [ ] **Step 4: Add accessors + row types**

In `types.ts` add `LocalOuraBucket`, `LocalOuraDailySummary`, `LocalOuraDailyDerived`, `LocalOuraHeartratePoint`. In `sqlite-backend.ts` add `upsertOuraBucket`, `getOuraBuckets(tier, dateRange)`, `upsertOuraDailySummary`, `upsertOuraDailyDerived`, `upsertOuraHeartrate`, `getOuraHeartrate(dayRange)` — copy the snake↔camel mapping + `ON CONFLICT(pk) DO UPDATE` shape from `upsertSupplementLog` (`sqlite-backend.ts:1673`). Declare them on the `LocalStore` interface (`index.ts`).

- [ ] **Step 5: Typecheck + lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/sqlite/migrations.ts lib/local-store/
git commit -m "feat(oura-local): local calculated-form tables (v17) + RECONCILE + accessors"
```

- [ ] **Step 7: On-device verification (DEVICE)**

After an APK rebuild, open the app on the S25; confirm the local DB opens cleanly (no dead-store banner), `PRAGMA table_info(oura_bucket)` shows the columns, and a forced partial-upgrade recovery still reconciles the tables. Sandbox cannot run the Capacitor SQLite plugin.

---

## Task 2: Native `oura_raw.db` + local-commit cursor gate (NATIVE; device-only)

**Why:** The highest-risk change. Raw frames must land in a native-owned SQLite the headless service controls, the resume cursor must live **inside that same DB and advance in the same transaction** as the insert (parent spec pinned rule: SharedPreferences + a separate raw file can die independently → *data lost, cursor survives*), and the file must be fsync-durable. Phase 1 keeps the existing POST as a **best-effort backup** so Railway stays the backstop — but the POST no longer gates the cursor.

**Files:**
- Modify: `android/app/src/main/java/com/trainingai/app/oura/OuraRingService.kt` (`postDrainBatch` ~378-409, `confirmStored` ~560-568, add the `oura_raw.db` helper)
- Create: `android/app/src/main/java/com/trainingai/app/oura/OuraRawDb.kt` (the native SQLite wrapper)

- [ ] **Step 1: Create the native raw DB wrapper**

`OuraRawDb.kt` opens `oura_raw.db` with `android.database.sqlite.SQLiteDatabase`, sets `PRAGMA journal_mode=WAL` and **`PRAGMA synchronous=FULL`** (the cursor advance is the point-of-no-return; WAL NORMAL isn't battery-death durable). Schema (one file, cursor co-located):

```
CREATE TABLE IF NOT EXISTS raw (
  ring_ts INTEGER NOT NULL, tag INTEGER NOT NULL, event_name TEXT NOT NULL,
  body_hex TEXT NOT NULL, measured_at INTEGER,
  rolled_up INTEGER NOT NULL DEFAULT 0, synced INTEGER NOT NULL DEFAULT 0,
  UNIQUE(ring_ts, tag, body_hex));
CREATE TABLE IF NOT EXISTS sync_state (k TEXT PRIMARY KEY, v INTEGER NOT NULL);  -- k='history_cursor_ds'
```

Expose `insertBatchAndAdvance(rows, batchMaxDs): Boolean` — inserts all rows (`INSERT OR IGNORE` for dedup) **and** upserts `sync_state['history_cursor_ds']=batchMaxDs+1` **inside a single `beginTransaction()/setTransactionSuccessful()/endTransaction()`**, returning true only after `endTransaction()` succeeds (a real fsync under `synchronous=FULL`). On `SQLiteFullException` (disk full) return false — never partially commit.

- [ ] **Step 2: Rewire `postDrainBatch` to gate on local commit**

Replace the server-2xx gate with the local commit. Keep the POST as best-effort backup (fire it, ignore its result for cursor purposes). Preserve the hole-safety machinery — repurpose `@Volatile drainIngestFailed` to a **local-write** failure:

```
val committed = rawDb.insertBatchAndAdvance(batchRows, batchMaxDs)   // durable local commit + cursor
if (!committed) { drainIngestFailed = true; lastDrainCompletedAt = 0L; return }  // hold, re-drain (dedup absorbs)
main.post { if (!drainIngestFailed) confirmStored(batchMaxDs) }       // mirror the persisted cursor (compat)
postFramesBestEffort(batchRows, batchMaxDs)                           // Phase-1 dual-write backup; non-gating (Step 2b)
```

`confirmStored` still writes the SharedPreferences `history_cursor_ds` for backward-compat/status, but the **authoritative** cursor is now the one in `oura_raw.db.sync_state`, read by `startDrain`. On open, if `sync_state` cursor is absent/0 but prefs is non-zero (or vice-versa), take the **minimum** (conservative — re-drain, dedup absorbs) — this closes the independent-death asymmetry.

- [ ] **Step 2b: Native sets `synced=1` on the best-effort POST's 2xx (load-bearing for the prune)**

`postFramesBestEffort` must, on a 2xx, mark those rows durable-on-Railway in `oura_raw.db` so Task 8's prune (`rolled_up=1 AND synced=1 …`) can ever fire. Since the POST is native and the WebView never sees its result, the WebView `markSynced` bridge (Task 3) cannot do this in Phase 1 — the native code must:

```
private fun postFramesBestEffort(batch: List<String>, batchMaxDs: Long) {
  ingest.execute {
    val stored = try { postFramesWithRetry(batch) } catch (e: Exception) { null }
    if (stored != null) rawDb.markSyncedUpTo(batchMaxDs)   // UPDATE raw SET synced=1 WHERE ring_ts <= batchMaxDs
  }
}
```
`markSyncedUpTo` is an `OuraRawDb` method (native), distinct from the Task-3 WebView `markSynced` bridge (which stays reserved for Phase 2's derived-push confirmation). Without this, `synced` stays 0 and raw accumulates unbounded — the exact gap the confirmation review caught.

- [ ] **Step 3: Disk-full handling**

When `insertBatchAndAdvance` returns false for `SQLITE_FULL`, surface it: set a `lowDiskAlarm` status field (shown in the tester + the storage UI, Task 9) and log. Do **not** advance. The pruner (Task 8) reserves headroom so a full phone can still delete rolled-up raw to recover.

- [ ] **Step 4: Compile-gate**

Run (sandbox): `npx cap sync android` then confirm the Kotlin compiles as far as the sandbox allows. Full build + all runtime behaviour is **device-only**.

- [ ] **Step 5: Commit**

```bash
git add android/app/src/main/java/com/trainingai/app/oura/
git commit -m "feat(oura-native): oura_raw.db durable local store + local-commit cursor gate"
```

- [ ] **Step 6: On-device verification (DEVICE — the load-bearing check)**

Owner rebuilds the APK (`npx cap sync android && ./gradlew assembleDebug`). Run the ops-doc §4 **Full re-sync 1:1 runbook**: drain the ring, confirm `oura_raw.db.raw` row counts match the ring's delivered per-event counts (`green_ibi_quality`, `ibi_and_amplitude`, `hrv_event`, `spo2_r_pi`, temp — not just debug tags), and `sync_state` cursor advanced. Then a **kill-mid-drain** test (force-stop the app during a drain) → reopen → confirm the unconfirmed tail re-drains and dedups (no loss, no dupes). This is the "never lose a span" verification and cannot be done in the sandbox.

---

## Task 3: Native bridge — WebView reads un-rolled rows + prunes (NATIVE; device-only)

**Why:** Parent spec pinned rule: a **single SQLite library owns `oura_raw.db`** (avoids two-SQLite-libs-on-one-WAL + two-writer `SQLITE_BUSY`). The WebView must never open the file — it reaches raw through native bridge methods.

**Files:**
- Modify: `android/app/src/main/java/com/trainingai/app/oura/OuraBlePlugin.kt` (add bridge methods)
- Modify: `lib/oura-ble/plugin.ts` (TS plugin interface)

- [ ] **Step 1: Add bridge methods**

`OuraBlePlugin.kt`: `getUnrolledRaw({ limit })` → JSON rows `{ ringTs, tag, eventName, bodyHex, measuredAt }` where `rolled_up=0` (ordered by `ring_ts`); `markRolledUp({ ringTsList })` → sets `rolled_up=1`; `markSynced({ ringTsList })` → sets `synced=1`; `pruneRaw({ olderThanMs, reserveBytes })` → deletes `rolled_up=1 AND synced=1 AND measured_at < olderThanMs` in bounded batches until free disk ≥ reserveBytes; `rawStats()` → `{ totalRows, unrolledRows, bytes }`.

- [ ] **Step 2: Declare the TS interface**

Add the method signatures to the `OuraBlePlugin` interface in `lib/oura-ble/plugin.ts`, guarded (they no-op on web where the plugin is absent).

- [ ] **Step 3: Typecheck + compile-gate + commit**

Run: `pnpm exec tsc --noEmit`; `npx cap sync android`.
```bash
git add android/app/src/main/java/com/trainingai/app/oura/OuraBlePlugin.kt lib/oura-ble/plugin.ts
git commit -m "feat(oura-native): plugin bridge for WebView raw read/mark/prune"
```

- [ ] **Step 4: On-device verification (DEVICE)**

Confirm `getUnrolledRaw` returns freshly-drained rows and `markRolledUp` flips them so a second call returns fewer. Device-only.

---

## Task 4: On-device clock anchor (JS + native; device-verified)

**Why:** The `(ringDs↔utc)` anchor is server-maintained at ingest today (`adapter.ts:3928-3943`); the on-device rollup needs it locally, **forward-only** (R6: a backwards ring clock must not re-anchor), or every derived timestamp is wrong.

**Files:**
- Create: `lib/oura-ble/clock-anchor.ts` (pure TS: `advanceAnchor(current, ringDs, utcMs)` forward-only; `measuredAtMs(ringDs, anchor)` — reuse `measuredAtMs` from `decode.ts`)
- Modify: `lib/local-store/` (persist the anchor in a small local row) + `OuraRingService.kt` (capture SyncTime-ack / batch-max-ds ↔ now)
- Test: `lib/oura-ble/__tests__/clock-anchor.test.ts`

- [ ] **Step 1: Write the failing test (sandbox TDD)**

```ts
import { advanceAnchor } from '@/lib/oura-ble/clock-anchor'
test('anchor only moves forward', () => {
  const a1 = advanceAnchor(null, 1000, 1_700_000_000_000)
  const a2 = advanceAnchor(a1, 2000, 1_700_000_100_000)     // later ds → updates
  expect(a2.anchorDs).toBe(2000)
  const a3 = advanceAnchor(a2, 500, 1_700_000_050_000)      // earlier ds → ignored
  expect(a3.anchorDs).toBe(2000)
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm test clock-anchor` → FAIL (module not found).

- [ ] **Step 3: Implement `advanceAnchor`** — forward-only guard (`if (ringDs <= current.anchorDs) return current`).

- [ ] **Step 4: Run it, verify PASS.** Run: `pnpm test clock-anchor` → PASS.

- [ ] **Step 5: Wire persistence + commit**

Persist the anchor in the local store (a single-row table or the existing anchor mechanism); advance it from the native SyncTime-ack. Compile-gate the native change.
```bash
git add lib/oura-ble/clock-anchor.ts lib/oura-ble/__tests__/clock-anchor.test.ts lib/local-store/ android/
git commit -m "feat(oura-local): on-device forward-only clock anchor"
```

- [ ] **Step 6: On-device verification (DEVICE)** — after a drain, confirm decoded event wall-clock times match reality (compare a known sleep window to the ring's actual timing).

---

## Task 5: Port the deterministic rollup to the WebView (JS; partly sandbox-TDD)

**Why:** Move decode + the pure-TS rollup pieces into a WebView-runnable module. The decoders and deterministic math port cleanly and are unit-testable; the neural half is Task 6.

**Files:**
- Create: `lib/oura-ble/rollup/rollup-device.ts` (the orchestrator: bridge-read raw → decode → buckets + finished forms → local write → markRolledUp)
- Extract/reuse: `lib/oura-ble/decode.ts` (already TS), `lib/health/daily-medians.ts` (`medianGated`, `metActiveWindows`), `lib/oura-models/illness-radar.ts` (`illnessFromSummaries`), `lib/oura-models/cumulative-stress.ts` (`computeChronicStress`), the summary/recovery/step fns currently reachable from `aggregateOuraRawSamples`
- Test: `lib/oura-ble/rollup/__tests__/rollup-device.test.ts`

- [ ] **Step 1: Write the failing fidelity test (sandbox TDD)**

Feed a fixture night's decoded events and assert the pinned fidelity rules from the parent spec's Review Outcome:

```ts
import { rollupNight } from '@/lib/oura-ble/rollup/rollup-device'
import fixture from './fixtures/one-night.json'   // decoded events for one night

test('HRV headline uses 0x5d median-gated, not IBI recompute', () => {
  const out = rollupNight(fixture.events, fixture.anchor)
  // 0x5d rmssd_ms values, MET-gated median — matches the server number for this fixture:
  expect(out.summary.hrvAvgMs).toBeCloseTo(fixture.expected.hrvAvgMs, 1)
})
test('RHR is lowest non-MET 5-min bin avg, never a raw per-beat min', () => {
  const out = rollupNight(fixture.events, fixture.anchor)
  expect(out.summary.rhrLowBpm).toBe(fixture.expected.rhrLowBpm)
})
test('MET gating is applied before any promotion (a >1.8 spike excludes its window)', () => {
  const out = rollupNight(fixture.eventsWithMetSpike, fixture.anchor)
  expect(out.summary.hrvAvgMs).toBe(fixture.expected.hrvAvgMsExcludingSpike)
})
```

- [ ] **Step 2: Run it, verify it fails.** Run: `pnpm test rollup-device` → FAIL.

- [ ] **Step 3: Implement `rollupNight` (deterministic path)**

Port the binning from `aggregateOuraRawSamples` verbatim in structure: 5-min HRV pairs (median-gated over the ring's **`0x5d` rmssd_ms**, not IBI — pinned rule), 5-min RHR bins (lowest non-MET, ≥3 beats), 5-min HR series, per-day SpO₂/steps/MET, wear-time, sleep-window detect + heuristic `stageSleepDetailed` (neural override is Task 6), illness/chronic-stress from summaries. **Steps** re-pairs `0x7e/0x7f` from `body_hex` (not `decoded`) via the existing `pairStepFeatures` — keep that path. Write results to the Task-1 local tables; collect the raw `ring_ts` list to `markRolledUp`.

- [ ] **Step 4: Run it, verify PASS.** Run: `pnpm test rollup-device` → PASS. Also run `pnpm test` to confirm the decoder golden vectors stay green.

- [ ] **Step 5: Wire the orchestrator to the bridge (device path)**

`rollup-device.ts` reads `getUnrolledRaw`, decodes, calls `rollupNight`, upserts the local tables, calls `markRolledUp`. On web (plugin absent) it no-ops. Trigger from **app-foreground** (not cron — module-map §0); reuse the existing `lib/oura-ble/sync.ts` post-drain hook.

- [ ] **Step 6: Cache-group invalidation**

After writing local finished forms, fire `invalidateOuraSync()` + `invalidateReadinessInputs()` (`lib/cache-groups.ts:98,157`) so the health screens don't re-paint pre-rollup data (CLAUDE.md cache rule).

- [ ] **Step 7: Commit**

```bash
git add lib/oura-ble/rollup/ lib/health/ lib/oura-models/
git commit -m "feat(oura-device): port deterministic rollup to the WebView"
```

- [ ] **Step 8: On-device verification (DEVICE)** — after a drain, confirm the local tables fill and the health screens (sleep, HRV, RHR, SpO₂, HR-day) show the night — matching the server-computed values (which still run in parallel in Phase 1) within tolerance.

---

## Task 6: Neural models in the WebView (JS; GATED on Task 0)

> **⚠️ This task's text below is STALE — do not implement it verbatim (corrected 2026-08-02).**
> It says the device neural half is **SleepNet + dHRV**. It is not. **D5 shipped in v1.218.0 and
> replaced Oura's `dhrv_imputation` ONNX with our own per-user regression**
> (`packages/shared/src/health/daytime-hrv-model.ts`), taking it out of the production path
> entirely — `adapter.ts` documents the swap at its call site. The master plan's Review Outcome
> amendment already supersedes this page: the device neural half is **SleepNet + `step_counter`**,
> and D7 deletes dHRV rather than porting it. Anyone following the text below would port a model
> that has already been replaced, and would skip `step_counter`, which is now the primary daily-steps
> source (D0). Read the master plan's Review Outcome block before starting, and treat every
> "dHRV" mention on this page as "`step_counter`".

**Why:** SleepNet staging + BDI and dHRV→resilience are the neural half. Only proceed if Task 0 parity PASSED.

**Files:**
- Modify: `lib/oura-ble/rollup/rollup-device.ts` (call the WASM sessions)
- Modify: `lib/oura-models/inference/session-web.ts` (asset loading)
- Assets: the `.onnx` files served from Railway as WebView assets (a `public/oura-models/` route or Next static), cached by the service worker (`app/sw.js/route.ts`)

- [ ] **Step 1: Serve the models as cached WebView assets**

Place the required `.onnx` files under a static path served by Railway; add them to the service-worker precache list (`app/sw.js/route.ts`) so they're available offline. This is what makes model updates a **Railway deploy, no APK rebuild** (decision D1).

- [ ] **Step 2: Wire SleepNet + dHRV into `rollupNight`**

Load via `createWebSession(fetchedModelBytes)`; replace the heuristic hypnogram with `sleepNetStages5Min`'s WASM output (mirroring `adapter.ts:4384-4389`), produce the BDI head, and run dHRV imputation for the daytime-stress/resilience step.

- [ ] **Step 3: Parity test in the harness (sandbox)**

Extend Task 0's harness to assert the WebView rollup's neural outputs match the server's on the fixture night. Run: `pnpm tsx scripts/spikes/wasm-onnx-parity.ts` → PARITY PASS.

- [ ] **Step 3b (fallback, only if Task 0 FAILED):** skip Steps 1–2; leave heuristic staging in place; add a `projectOverview.md` Known-Issues row: "SleepNet/BDI/dHRV-resilience remain server-computed pending WASM parity." Continue to Task 7.

- [ ] **Step 4: Commit**

```bash
git add lib/oura-ble/rollup/ lib/oura-models/inference/session-web.ts app/sw.js/route.ts public/oura-models/
git commit -m "feat(oura-device): neural rollup (SleepNet/dHRV) via onnxruntime-web"
```

- [ ] **Step 5: On-device verification (DEVICE)** — confirm the S25 sleep ribbon + BDI + resilience match the server output for the same nights, and the nightly rollup stays under the Task-0 perf bar.

---

## Task 7: Tier-ladder promotion (JS; sandbox-TDD)

**Why:** Age fine buckets into coarser tiers per the RRDtool ladder, with per-field aggregation. Pure logic — fully unit-testable.

**Files:**
- Create: `lib/oura-ble/rollup/promote.ts` (`promoteBuckets(buckets, horizons, now)` → coarser buckets)
- Test: `lib/oura-ble/rollup/__tests__/promote.test.ts`

- [ ] **Step 1: Write the failing test (sandbox TDD)**

```ts
import { promoteBuckets } from '@/lib/oura-ble/rollup/promote'
test('promotes 1min→5min: HR mean/min/max, rMSSD median, MET mean+minutes (NO steps — not a bucket field)', () => {
  const out = promoteBuckets(fiveOneMinBuckets, HORIZONS, NOW)
  const b = out.find(x => x.tier === '5min')!
  expect(b.hrMean).toBeCloseTo(avg(hrMeans))
  expect(b.hrMin).toBe(Math.min(...hrMins))
  expect(b.hrvRmssdMs).toBe(median(rmssds))     // median, never average
  expect(b.metMinutes).toBeCloseTo(sum(metMinutes))
})
```

- [ ] **Step 2: Run → FAIL.** Run: `pnpm test promote`.

- [ ] **Step 3: Implement `promoteBuckets`** — per-field aggregation exactly as the test asserts; drop `ibi_ms` on promotion past the tier its consumers need (per the corrected IBI-retention rule).

- [ ] **Step 4: Run → PASS.** Run: `pnpm test promote`.

- [ ] **Step 5: Wire into the app-foreground rollup pass + commit**

```bash
git add lib/oura-ble/rollup/promote.ts lib/oura-ble/rollup/__tests__/promote.test.ts
git commit -m "feat(oura-device): tier-ladder bucket promotion"
```

---

## Task 8: Prune (JS orchestration + native delete; device-verified)

**Why:** Reclaim device space, but **never** prune raw whose derived isn't durably backed. In Phase 1 the server dual-write keeps Railway holding raw, so pruning rolled-up local raw is safe; the predicate still requires `rolled_up=1` and is storage-aware.

**Files:**
- Modify: `lib/oura-ble/rollup/rollup-device.ts` (call `pruneRaw` after a rollup pass)

- [ ] **Step 1: Call the native prune with the safe predicate**

After a rollup pass, call `pruneRaw({ olderThanMs, reserveBytes })` — the native side deletes only `rolled_up=1 AND synced=1 AND measured_at < olderThanMs`. **`synced=1` is set NATIVELY in `oura_raw.db` when the best-effort POST returns 2xx** — this is a Task-2 step (see Task 2 Step 2b), NOT the `markSynced` WebView bridge (the native POST result is invisible to the WebView, so a WebView `markSynced` could never observe it in Phase 1). `markSynced` exists for Phase 2 (when the *derived* push confirms to Railway). Without this native wiring `synced` stays 0 forever and the prune never runs — raw would accumulate unbounded. `olderThanMs` is storage-aware (only prune under pressure), not a hard 30-day cut (decision: storage-aware retention).

- [ ] **Step 2: Commit**

```bash
git add lib/oura-ble/rollup/rollup-device.ts
git commit -m "feat(oura-device): storage-aware raw prune gated on rolled_up AND synced"
```

- [ ] **Step 3: On-device verification (DEVICE)** — fill the device, confirm the pruner frees space by deleting only rolled-up+synced raw, and that un-rolled or un-synced raw is never deleted (inspect via the tester).

---

## Task 9: Device-storage readout (JS; device-verified)

**Why:** Surface local footprint (brief §4) so Phase 1 is verifiable on-device and the storage-aware retention is visible.

**Files:**
- Modify: `components/oura-ble/db-footprint-card.tsx` (add a local section)
- Create: `lib/oura-ble/local-stats.ts` (`getLocalOuraStorageStats()` via the `rawStats` bridge + local-table row counts)

- [ ] **Step 1: Implement `getLocalOuraStorageStats()`** — mirror the server `getOuraStorageStats()` shape `{ tables:[{table,rows,bytes}], rawSamples:{totalRows, unrolledRows, bytes}, lowDiskAlarm }` from the `rawStats` bridge + `SELECT count(*)` over the local finished tables.

- [ ] **Step 2: Render a "On-device" panel in the footprint card** — reuse the existing per-table list + `fmtBytes`; show the raw window row count + bytes, the low-disk alarm, and per-tier bucket counts.

- [ ] **Step 3: Typecheck + commit**

Run: `pnpm exec tsc --noEmit && pnpm lint`.
```bash
git add components/oura-ble/db-footprint-card.tsx lib/oura-ble/local-stats.ts
git commit -m "feat(oura-device): on-device storage footprint readout"
```

- [ ] **Step 4: On-device verification (DEVICE)** — confirm the card shows plausible local numbers that grow with drains and shrink after a prune.

---

## Phase-1 exit criteria (all device-verified on the S25)

- [ ] Full re-sync 1:1 (ops-doc §4): `oura_raw.db` row counts match ring-delivered biometric counts; cursor in `sync_state` advances; kill-mid-drain re-drains + dedups with **zero loss**.
- [ ] The WebView rollup fills the local finished tables; health screens match the still-running server values within tolerance (sleep stages, HRV, RHR, SpO₂, HR-day, resilience/BDI if Task 0 passed).
- [ ] Bucket promotion + storage-aware prune work; prune never deletes un-rolled or un-synced raw.
- [ ] `check-reconcile` + `check-push-mutations` + `tsc` + `lint` + `test` + `build` all green in CI.
- [ ] Every PR states which half it touched (native = APK rebuild; JS/server = Railway) and ran the device smoke checklist for the device-gated halves.

**Explicitly NOT in Phase 1 (Phases 2–4):** flipping reads to local-first, the derived→Railway outbox domain (Phase 1 relies on the existing server dual-write for the backup), the full-history restore path, retiring server ingest, and the 437k-row drop. Phase 1 leaves the server pipeline fully intact as the backstop.

---

## Self-review notes (spec coverage)

- Parent-spec **D1 (on-device WASM)** → Tasks 0, 6. **D2 (full-history backup, ordering)** → deferred to Phases 2–3 by design; Phase 1's dual-write keeps the server backstop so the cursor change ships safely (the D2 ordering rule). **Cursor co-location / synchronous=FULL / single-owner bridge / disk-full** → Tasks 2, 3, 8. **HRV/MET/steps/RHR fidelity** → Task 5 tests. **On-device anchor** → Task 4. **RECONCILE/check-reconcile** → Task 1. **Cache groups** → Task 5 Step 6. **No-cron trigger** → Task 5 Step 5.
- Types are consistent across tasks (`rollupNight`, `promoteBuckets`, `insertBatchAndAdvance`, `getUnrolledRaw`/`markRolledUp`/`markSynced`/`pruneRaw`/`rawStats`, `getLocalOuraStorageStats`).
- Device-gated tasks (2, 3, 4-native, 6-device, 8-device, 9-device) carry explicit on-device verification steps in lieu of sandbox tests, per the stated sandbox limits.
