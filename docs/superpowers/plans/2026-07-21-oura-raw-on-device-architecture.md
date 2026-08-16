# Plan — Oura raw data on-device; Railway holds only calculated fields (Phase 0 spec)

**Type:** architecture spec + phased plan (Phase 0 = docs-only, in-sandbox).
**Parent brief:** [`docs/superpowers/specs/2026-07-21-oura-raw-on-device-architecture-brief.md`](../specs/2026-07-21-oura-raw-on-device-architecture-brief.md) (owner directive).
**Branch (this docs PR):** `claude/oura-raw-device-architecture-7taq90`.
**Implementer branch (Phase 1, later):** `feat/oura-raw-on-device-phase-1`.

> **Read first:** CLAUDE.md (all DB/sync/offline/SQLite/BLE sections),
> [`docs/oura-ble-operations.md`](../../oura-ble-operations.md),
> [`docs/db-volume-cleanup-handover.md`](../../db-volume-cleanup-handover.md),
> [`docs/superpowers/plans/2026-07-15-oura-data-architecture-and-culling.md`](2026-07-15-oura-data-architecture-and-culling.md),
> the `oura-native-ble` skill.

This document answers the brief's §5 ("what is calculated data?" + the tier ladder), and specifies
the **durability model**, the **forward-only ring-cursor contract change**, the **silent-cutover
strategy**, and the **plan for the 437k existing Railway rows**. It refines the brief's phasing. It
ships **standalone** — no device code lands in this PR.

---

## 0. The one-paragraph summary

Invert the pipeline. Today the native Kotlin service drains the ring and POSTs raw frames to Railway;
the ring's forward-only history cursor advances only when the **server** returns 2xx. We move raw
`body_hex` onto the phone's SQLite (device-only, single copy, acceptable to lose), advance the cursor
on **local** commit instead, decode + roll up **on-device** (the *decoders* are already TypeScript;
the *neural rollup* is not — see the Review Outcome below), and mirror only the **calculated**
finished/binned forms to Railway as a disaster-recovery backup. A device wipe then loses *re-decode
ability* over the un-backed-up raw window, but **never** the derived metrics (conditional on the
durability fixes in the Review Outcome). This ends the unbounded `oura_raw_samples` growth on Railway
(437k rows, ~91% of the DB, +50 MB/week) that motivated the whole project.

The single highest-risk correctness point: **the ring cursor must advance only past events that are
durably committed to local SQLite.** Get it wrong and a drained history span is silently lost forever
(the ring buffer is forward-only and finite). Everything below is organised around getting that right.

---

## Review Outcome (2026-07-21) — READ THIS FIRST; supersedes the affected sections below

Four independent adversarial reviews (cursor-contract/data-loss, durability/cutover, tier-ladder/rollup
fidelity, rule-compliance) were run against this spec. **The core inversion is sound and the §4
cursor-on-local-commit direction is a genuine robustness improvement — but the spec as first written
has one plan-shaping premise error, one durability overstatement, and a set of permanent-data-loss
holes that must be closed before any Phase-1 device code.** The sections below (§2–§8) are kept for
context but are **corrected/overridden by this outcome**.

### Decisions locked (2026-07-21, owner-delegated)
Owner directive: *"most future-proof + best performance/update; mimic how Garmin / Samsung Health /
Apple Health do it"* (the **device-primary** camp — the phone is the source of truth and does the
compute *including ML*; the cloud is backup + cross-device sync + full-history restore, never a compute
dependency — **not** MyFitnessPal's cloud-primary thin-client model). Resolved:

- **D1 → on-device neural (WASM).** Compute everything on the phone, ML included. Recompile the ONNX
  models to `onnxruntime-web` and run them in the WebView. Matches Garmin (watch firmware), Apple Health,
  and Samsung Health — per-night analytics run on the device; the cloud never computes. **Refinement that
  also wins "best update":** the model weight files are served as **WebView assets from Railway** (a
  static file download — *not* compute) and cached by the service worker for offline. So improving a model
  = a **Railway deploy, no APK rebuild** — better on the update axis than Garmin's firmware pushes. **Gate:
  a validation spike goes first** — prove WASM numerical parity with the server models on real nights +
  measure S25 nightly perf (an 8 MB model overnight on a flagship is expected fine; the real risk is float
  parity). If parity fails, fall back to heuristic-on-device and revisit — but do not build Phase 1 on
  WASM until the spike passes. This overrides the earlier server-enhancement recommendation.
- **D2 → full-history cloud backup + restore (not 90-day-capped).** Mirror the calculated forms to Railway
  as the complete backup; a wiped/new phone restores the **entire** history — like iCloud/Samsung
  Cloud/Garmin Connect. So: (1) build the full offline sync chain for all 4–6 finished forms; (2) add a
  **full-history restore path** (paginated, bypassing the 90-day incremental `getSyncDelta` clamp);
  (3) never prune device raw until its derived is `sync_status='synced'` to Railway; (4) keep server ingest
  running until the device path is proven, then retire (conservative, never-lose-data cutover).
- **Raw retention → storage-aware, not a hard 30 days** (supersedes §2.1). Keep raw `body_hex` on-device as
  long as the phone has room (prune oldest only under real storage pressure, surfaced in the device-storage
  UI). Maximizes the ability to reprocess history with a better model/decoder later — the point of
  "future-proof." The cloud never holds raw.
- **437k legacy rows** (§6): pull to device (raw's new home) → per-day audit that the calculated forms are
  complete in the cloud backup → confirm-first drop of the server raw table. Unchanged, gated as written.

The remaining items below are pinned engineering rules (no further decision needed).

### D1 (DECIDED — on-device WASM; see above) — the rollup is NOT just the decoders; it runs native ONNX models a WebView can't
`aggregateOuraRawSamples` transitively runs **2 neural models under `onnxruntime-node`** (a native Node
addon, header-marked *server-only*; `lib/oura-models/onnx/` holds ~10 `.onnx` files / ~31 MB but the
*ingest rollup* invokes exactly these two — verified 2026-07-21): **SleepNet**
(`sleepnet_moonstone_1_2_0_core.onnx`, 8 MB — its output *replaces* the heuristic hypnogram today and is
the only BDI/apnea source, `adapter.ts:4383-4389`) and **dHRV imputation** (`dhrv_imputation_1_1_0.onnx`,
feeds daytime-stress → resilience, `daytime-stress.ts:87`). `illnessFromSummaries` is z-score math (not
ONNX); step/energy models are used on other surfaces, not this rollup. A Capacitor WebView has no
`onnxruntime-node`/`node:fs`/`process.cwd()`. So
"roll up on-device" is a real fork, not a decoder move:
- **(a) onnxruntime-web / WASM on-device** — unproven float bit-exactness vs the node goldens, 31 MB
  shipped under the WebView CSP, and an 8 MB model per night on the S25 (unbudgeted perf/battery).
- **(b) [RECOMMENDED] hybrid — device runs the deterministic/heuristic rollup; neural refinement stays a
  server pass** that *upgrades* the finished forms when online. The device path gives instant local-first
  + offline; the server ML enhancement lands on next sync. **This reframes the north star honestly:**
  "Railway redundant" means **raw** is gone from it — the server still runs the ML enhancement, so it is
  not literally idle. Keeps screens identical to today (models still run).
- **(c) heuristic-only on device** — a *silent nightly quality regression*: loses neural staging, BDI, and
  dHRV-driven resilience. Breaks §5's "identical screens" promise. Not recommended.

The pure-TS pieces **do** port cleanly (`stageSleepDetailed`, `medianGated`/MET windows, `illnessFromSummaries`
z-scores, `computeChronicStress`, `computeDailySummaries`, `computeRecoveryIndex`, step estimation). Only
SleepNet + dHRV are the problem. **Owner call:** confirm (b) — device deterministic rollup + server neural
enhancement — vs investing in (a). This is the single largest hidden cost in the plan.

### D2 (DECIDED — full-history backup + restore; see above) — "restore from Railway" doesn't exist yet, is 90-day-capped, and the cursor/prune/cutover ordering must change
The durability guarantee (§3) is stated as present fact but is **not** true against current code:
- `SyncDelta` carries only `sleepSessions` + `ouraDaily` (both reduced subsets — the local `sleep_sessions`
  lacks every Oura column; `repository.ts:222-231`). `oura_daily_summary`, `oura_daily_derived`,
  `oura_heartrate` have **no pull-delta domain at all** → not restorable today.
- `getSyncDelta` clamps every pull (even a full resync) to **90 days** (`adapter.ts:2970-2972`). After §6
  drops the 437k raw rows, any derived metric older than 90 days is **single-copy on the fragile local
  store** — the store CLAUDE.md documents as silently-dead-twice.
- The cursor advancing on **raw** local-commit does not make **derived** durable — derived isn't durable
  until the (possibly much later, foreground-only) WebView rollup + outbox push to Railway. Retiring
  server ingest (Phase 4) exposes a permanent derived-loss window.

**Resolution to adopt (owner to confirm the cutover appetite):**
1. **Never prune raw until its derived is `sync_status='synced'` on Railway** — prune predicate is
   `rolled_up=1 AND synced=1 AND age>window`, *never age alone* (closes the pre-rollup-prune loss).
2. **Do not ship the local-commit cursor gate before the derived→Railway push is built and device-proven.**
   Merge Phases 1+2, or have Phase 1 **keep dual-writing raw to Railway** so the server rollup remains the
   derived backstop until the device push is trusted. §5.1/§8 are internally inconsistent on this — §8's
   phase split is overridden here.
3. **Build the full offline chain for all 4–6 finished forms** (local table + `sync_status` +
   clobber-guard = payload = shared write fn in `pushMutations` = `getSyncDelta` = `pullDelta` =
   `applyDelta`) — this is the largest correctness surface in the project, not one Phase-2 bullet.
4. **Resolve the 90-day restore cap** — either widen the restore window for these tables or add a
   full-history restore endpoint; otherwise state plainly the guarantee is "last 90 days" and everything
   older is device-only.
5. **Keep server raw ingest until the device derived-durability is proven end-to-end** (Phase 4 is the last
   step, gated on real-night verification), and the §6 drop stays confirm-first.

### Pinned engineering rules (must-fix; no architecture change)
- **Cursor/data co-location (CRITICAL).** The resume cursor lives in SharedPreferences; raw would live in a
  separate `oura_raw.db`. They can die independently → *data lost, cursor survives* (not covered by ops-doc
  I9). **Store the cursor inside `oura_raw.db`, advanced in the same transaction as the batch insert** (or,
  on open, force the cursor back when the DB is empty-but-cursor-nonzero).
- **`PRAGMA synchronous=FULL` on `oura_raw.db`.** WAL `NORMAL` isn't durable across battery-death, but the
  cursor advances anyway — the point-of-no-return must sit behind a real fsync (this user's ring/battery
  dies for real; R2/R6).
- **Single SQLite library owns the raw file.** The WebView never opens `oura_raw.db`; it reads un-rolled
  rows and issues prunes **via a native plugin bridge**. Demote §10-Q1 from "open question" to "decided:
  bridge" (avoids two-SQLite-libs-on-one-WAL + two-writer `SQLITE_BUSY`).
- **Disk-full is now a data-loss vector** (full phone → insert fails → can't prune → ring buffer wraps →
  R4 loss). Add a low-disk alarm + reserved-headroom prune to §7, and a new R4 ops-doc row.
- **HRV formula (fidelity).** Headline nightly HRV = `medianGated` over the ring's **own 5-min rMSSD in the
  `0x5d` event**, MET-gated — **NOT** recomputed from IBI. The spec's "recompute rMSSD from `ibi_ms[]`,
  drop IBI past 5-min" is wrong: it would shift every displayed HRV and starve the real per-event-IBI
  consumers (SleepNet staging, respiratory rate, chronic-stress) which need IBI **across the whole night**.
  Correct §2.2/§2.3 accordingly and re-anchor IBI retention to those consumers.
- **No two sources of truth for intraday HR/HRV.** Pick `oura_heartrate`/finished forms **or** `oura_bucket`
  — not both — and don't sync the redundant copy to Railway. Note `oura_heartrate` carries 15-sec workout
  bins the fixed-width ladder can't represent, so it isn't a pure bucket projection.
- **`body_metrics`/`oura_daily` are multi-source** (per-column `sourceMap` priority merge; Oura must not
  stomp manual/Health-Connect). A device outbox writer **must mirror that merge**, or it deletes manual
  weight/body-fat and HC steps (the sync-push-mirrors-web-route rule).
- **Steps is not a ladder "sum."** It's a raw-`body_hex`-dependent window-classify + max-merge
  (`pairStepFeatures` needs the archival hex, not `decoded`). Drop `steps` as an `oura_bucket` field; keep
  it a per-day finished form.
- **MET gating precedes promotion.** A bucket `met_mean` hides the >1.8 threshold crossings that gate
  HRV/RHR 60-s windows — MET's exclusion role must be consumed at fine resolution *before* any promotion.
- **On-device clock anchor.** The `(ringDs↔utc)` anchor is server-maintained at ingest today
  (`adapter.ts:3928-3943`); it must move on-device, forward-only (R6), or every derived timestamp is wrong.
- **§6 drop gating.** The "finished forms already complete server-side" premise is unverified: the normal
  rollup is 35-day-windowed and `fullHistory` times out at the gateway. Gate the drop on a **per-day
  finished-form completeness audit** + a **batched** backfill job; do a **staged rename-then-drop**, not a
  hard `DROP`; and reconcile with the parallel `body_hex`→`bytea` migration (`db-volume-cleanup-handover.md`
  §5) — pick one strategy for those rows.
- **`oura_raw.db` migration discipline.** It sits *outside* `RECONCILE_TABLES`/`check-reconcile.js` (which
  guard only the `trainingai` DB) — the highest-risk store would be the least protected. It needs its own
  idempotent-`ADD COLUMN` + reconcile pass, stated explicitly.
- **Ops-doc I10 ("redecode forever") is downgraded** to the on-device raw window — a decoder fix or a *model
  version bump* (SleepNet/step/illness/dHRV are all versioned) can now only re-derive the last ~window
  days, not all history. Rewrite the I10 guarantee in the same PR.
- **CI gates:** the new push domains must pass `check-push-mutations.js` (shared write fn, no raw `sql` in
  `pushMutations`); the local bucket tables must pass `check-reconcile.js`; claim **Postgres migration 136**
  (highest on `main` is 135; 130 is free but claim forward) and local SQLite **v17**.

### Sound as-is (no change)
Cursor-on-local-commit is the right direction and removes the I2/I3/I19 network-wedge classes; the §4.3
invariant *list* is correct and the R-1/I18 hole-safety fix repurposes cleanly; dedup-on-re-drain is
preserved; Option A (native-owned raw store) beats B/C; sleep-as-binned-stages captures the full ribbon;
"no cron, fire from app-foreground" matches module-map §0 (but drop the "BLE-sync-completion" half — the
WebView is dead during a background drain).

The full per-reviewer findings with severities and file:line anchors are in **§11 (appendix)**.

### Confirmation review (2026-07-21) — post-hardening pass over the current docs + merged code
A second review (3 passes) verified the hardening itself. Outcome:
- **~17/29 findings genuinely resolved; none papered-over.** Every pinned rule *inside Phase 1* is concretely realized (cursor co-location, `synchronous=FULL`, single-owner bridge, prune predicate, HRV/MET/RHR/steps fidelity, clock anchor).
- **Shipped-code flaws found and fixed** (PR fixing v17): the `oura_bucket` PK was on the resettable ring-decisecond counter (collision → forever-tier corruption) — re-keyed on `bucket_start_ms`; the local `oura_daily_summary/derived` mirrors had type/column drift vs `schema.ts` — made faithful mirrors; the WASM parity test used random noise — re-anchored to the TorchScript golden.
- **Plan gap fixed:** the prune's `synced` flag was never written — now set natively on the best-effort POST's 2xx (Task 2 Step 2b).
- **The one substantial planning gap that remains:** the **durability guarantee** — the six-finished-form offline sync chain (`local table = payload = getSyncDelta = pullDelta = applyDelta` + shared write fn) **and** the **full-history restore path** (bypassing the 90-day `getSyncDelta` clamp) — is **decided but not yet designed**. It is the largest correctness surface in the project and needs **its own Phase-2 plan document** before Phases 2–4 are plannable. Until then, "planning stage complete" is true for **Phase 1 only**, not for the durability model that justifies the whole inversion. Phase 1 is safe regardless because it keeps the entire server pipeline as the backstop (no read-flip, no raw-off-Railway, no drop).

---

## 1. Current architecture (audited — precise anchors)

### 1.1 Raw ingest + cursor contract (native-owned, server-durable)
- Native `OuraRingService.kt` drains ring history (`get_history` 0x10 / `history_batch_done` 0x11,
  `OuraProtocol.kt:105-163`), buffers history-event frames (tag ≥ `0x41`), and **POSTs each ~255-event
  batch itself** to `POST /api/oura-ble/samples` on Railway (`OuraRingService.kt:459-484`). The WebView
  is out of the data path on native-ingest APKs.
- **Two decoupled cursors** (`OuraRingService.kt:84-101`): in-memory `drainCursor` advances per batch
  (`:348`) so the drain pulls at BLE speed; the **persisted resume cursor** `history_cursor_ds` (Android
  SharedPreferences file `oura_ble`) advances **only** via `confirmStored(ds)` (`:560-568`) after the
  server returns **2xx with a `stored` count** (`postDrainBatch`, `:378-409`).
- Hole-safety: `@Volatile drainIngestFailed` is set synchronously on the ingest thread the instant a
  POST fails (`:391`), so no later batch can confirm past a failed span (deep-review R-1 fix, ops-doc
  I18). Single-threaded ingest executor → in-order confirms. Monotonic `confirmStored` (`:564`).
- Dedup: Postgres `UNIQUE (user_id, ring_timestamp_ds, tag, body_hex)` +
  `onConflictDoNothing` (`insertOuraRawSamples`, `adapter.ts:3917-3973`). **Re-draining an unconfirmed
  span is always loss-free** — this is what makes cursor-hold-and-re-drain the universal safe fallback
  (ops-doc I8/I9).
- Ingest drops pure telemetry/debug tags server-side (`shouldDropRawEvent`, `raw-storage.ts:13-48`);
  the native cursor watermark is computed over **all** history frames, so dropped-only batches still
  advance the cursor (they return `stored: 0`, not `null` — a 2xx). `decoded` is no longer persisted
  (Lever 1; `insertOuraRawSamples` sets `decoded: null`).

### 1.2 Server rollup (`aggregateOuraRawSamples`, `adapter.ts:4033-5003`)
Reads `oura_raw_samples` for a fixed `ROLLUP_TAGS` set in one query, **decodes `body_hex` transiently
in-memory** (`decoded ?? decodeEventBody(tag, hexToBytes(bodyHex))`, `:4078-4079`), bins at several
grids, and writes the finished/derived tables. This is the exact logic to port to the WebView.

| Metric | Source tags | Bin grid | Aggregation | Destination |
|---|---|---|---|---|
| Sleep night | `0x72/0x75` cluster (+`0x76`) | per-night (gap-split >2h, ≥3h, ≤16h) | window detect + 5-min hypnogram | `sleep_sessions` (`ble:<startDs>`) |
| Hypnogram | own `stageSleepDetailed`/`sleepNetStages5Min` | **5-min** epochs | staged codes 1=deep 2=light 3=REM 4=awake | `sleep_sessions.sleep_phase_5_min` |
| HRV (rMSSD) | **`0x5d`** (ring's own 5-min rMSSD) | **5-min** pairs | **quality-gated median of the `0x5d` rMSSD, MET-active excluded** — NOT recomputed from IBI (IBI-recompute feeds only chronic-stress) | `body_metrics.hrv_ms`, `oura_daily_summary.hrv_avg_ms` |
| Resting HR | `0x60/0x80/0x5d` | **5-min** bins | lowest qualifying non-MET bin avg (≥3 beats) | `body_metrics.resting_heart_rate` |
| HR series | `0x60/0x80/0x86` | **5-min** (→ **15-sec** inside workout ±10min) | mean/bin | `oura_heartrate` (source `ble`) |
| SpO₂ | `0x6f` firmware %, `0x8b` R/PI → `spo2PctFromR` | per **local day** | day aggregate | `body_metrics.spo2_pct` |
| Skin temp | `0x46/0x69/0x75` | per-epoch → nightly | mean/dev | `oura_daily_summary.temp_*` |
| MET | `0x50` | **1-min** grid | mean; >1.8 = active exclusion | daily-summary `met_avg`, HRV/RHR gating |
| Steps | `0x7e/0x7f` gait features + `step_live_windows` | per **local day** | max-merge model estimate | `body_metrics.steps` |
| Wear time | HR-beat density | **15-min** bins | on-finger density | `oura_daily.non_wear_time_sec` |
| Illness / BDI / resilience / chronic-stress / body-comp | derived from above | per **local day** | model fns | `oura_daily_derived` |

### 1.3 Existing finished/derived tables (do **not** duplicate — subsume)
| Table | Grain | Migration | Holds |
|---|---|---|---|
| `oura_daily` | per day | 084 | cloud scores; BLE writes only `non_wear_time_sec` |
| `oura_daily_summary` | per day | 116 | measured physiology + 8× EMA baselines |
| `oura_daily_derived` | per day | 123 (+127/128) | scored/analysis outputs (readiness/sleep/activity, illness, resilience, bdi, body_comp) |
| `sleep_sessions` | per night | 085/112/120 | stages, HRV, HR, efficiency, `sleep_phase_5_min` |
| `body_metrics` | per day | — | `hrv_ms`, `resting_heart_rate`, `spo2_pct`, `active_calories`, `steps` |
| `oura_heartrate` | per point (5-min / 15-sec) | 090 | intraday HR series (`source`), ~180d retention |
| `oura_accel_chunks` | per chunk | 122 | raw accel magnitudes, 7d prune |
| `step_live_windows` | per window (ds) | 119 | tier-2 step counts, 30d prune |
| `rr_intervals` | per beat | 124 | **chest-strap only** — not Oura-fed |

### 1.4 Local store (`lib/local-store/` + `lib/sqlite/`)
- `@capacitor-community/sqlite`, DB name `trainingai`, **version 16** (append `toVersion: 17`), WAL set
  **post-open** (never in an upgrade txn). Version is derived from the last `MIGRATIONS` entry
  (`sqlite-service.ts:45`).
- `RECONCILE_TABLES` / `RECONCILE_COLUMNS` / `reconcileSchema()` run after **every** open and are the
  real schema authority after a partial upgrade. **`scripts/check-reconcile.js` fails CI** if a
  migration-created table/column is missing from reconcile — mechanical enforcement of "register in the
  same commit".
- Write path: `store.upsertX` + `queueMutation` → `mutations_outbox` → `pushMutations`. Pull path:
  `applyDelta` per-domain loops with tombstone branch + `sync_status='synced'` clobber-guard.
- **No existing local raw/BLE/heart-rate table.** `oura_daily` exists locally as a **pull-only
  read cache**. The tiered store is net-new; there is no local precedent for high-cardinality data or
  local retention/pruning — we build the first.

### 1.5 Footprint UI
`GET /api/oura-ble/db-stats` → `getOuraStorageStats()` returns
`{ tables: [{table,rows,bytes}], rawSamples: {totalRows,decodedRows,decodedBytes,bodyHexBytes} }`;
`components/oura-ble/db-footprint-card.tsx` renders it. We add a **local** mirror of this shape.

---

## 2. THE central design — "what is calculated data?" + the tier ladder

### 2.1 Principle: raw hex is opaque; only decoded numbers roll up
`body_hex` cannot be averaged — it is an encoded blob. The device keeps raw hex for a **short re-decode
window**, and the *decoded numeric values* are what climb the ladder. Two distinct on-device stores:

1. **`oura_raw_local`** — one row per ring event (mirrors the Postgres table shape): `ring_timestamp_ds`,
   `tag`, `event_name`, `body_hex`, `measured_at_ms`, `rolled_up` flag. **Device-only, single copy.**
   Retained for a bounded **re-decode window** (recommend **30 days**; owner-tunable) then pruned — long
   enough that a decoder fix can back-fill recent nights, short enough to bound device storage. This is
   the *only* store that is acceptable to lose.
2. **`oura_bucket`** — the tiered calculated series (§2.3). Small, permanent, **mirrored to Railway**.

### 2.2 Per-tag → calculated-field map (the bucket's payload)
Enumerated against `lib/oura-ble/decode.ts` and the rollup's `ROLLUP_TAGS`. High-volume tags first
(row counts from the volume handover §2):

| Tag(s) | Event | Decoded fields | Bucket field(s) | Ladder aggregation |
|---|---|---|---|---|
| `0x8b` (103k) | spo2_r_pi | `r[]`, `perfusion_index[]` | `spo2_pct` (via `spo2PctFromR`), `perfusion_index` | mean (min for spo2) |
| `0x60`/`0x80` (120k) | IBI / beat | `ibi_ms[]`, `hr_bpm[]`, `quality[]` | `hr_mean/min/max`, **`ibi_ms[]` (fine tier only)** | HR mean/min/max; **IBI kept only ≤5-min tier for rMSSD** |
| `0x5d` | hrv_event | `rmssd_ms[]`, `hr_bpm[]` | `hrv_rmssd_ms` | **median (5-min); NOT averaged upward** |
| `0x6f` | spo2_event | `spo2_percent[]` | `spo2_pct` | mean |
| `0x86` | aohr | `bpm[]` | `hr_mean/min/max` (daytime) | mean/min/max |
| `0x46`/`0x69`/`0x75` | temp | `temps_c[]` | `skin_temp_c` | mean |
| `0x50` | activity_info | `met[]` | `met_mean`, `met_minutes` | mean + count (so MET-minutes reconstruct) |
| `0x72` | sleep_acm | `acm_mad[]` | `motion_mad` | mean (sleep-staging input) |
| `0x7e`/`0x7f` (35k) | step features | model input | `steps` | **sum** (via step-estimate model, per local day) |
| `0x4b`/`0x4e`/`0x5a` | sleep phases | `phases[]` | `hypnogram` | final binned stages (dormant on Ring 5) |
| `0x76` | bedtime_period | window ds | (sleep window detect) | not a bucket field |

**⚠️ CORRECTED by Review Outcome (D1 pinned rules) — the original text below is WRONG; do not
implement it.** Reality: the **headline nightly HRV** (`body_metrics.hrv_ms`, `oura_daily_summary.hrv_avg_ms`)
is `medianGated` over the ring's **own pre-computed 5-min rMSSD carried in the `0x5d` event**
(`adapter.ts:4252,4439`) with MET exclusion — it is **not** recomputed from IBI. A *separate*
IBI-recomputed series (`computeHrv5MinSeries`) feeds only chronic-stress. Per-event `ibi_ms` **is**
required — but by **SleepNet staging, respiratory rate, and chronic-stress, across the whole night** —
not by headline HRV, so it cannot be dropped at a 5-min tier. Preserve `0x5d`-median as the displayed
HRV; retain per-event IBI for its real consumers.

~~Original (incorrect): HRV rMSSD is recomputed from IBI intervals, never averaged; rMSSD finalised at the
5-min tier from IBI and IBI dropped past it.~~

### 2.3 The tier ladder
The brief's ladder — `10s → 1min → 5min → 30min → 1hr → 12hr → 24hr` — is a **unified bucket at
per-field native resolution**, honest that not every field populates every tier:

- **Finest tier is the metric's own cadence**, not a forced 10s: IBI arrives every few seconds (asleep),
  HRV is inherently 5-min, MET is 1-min, temp ~1-min, SpO₂ periodic. The "10s" tier is where sub-minute
  metrics (HR from IBI) land; slower metrics first appear at their natural tier.
- **Promotion:** a bucket promotes to tier N+1 when it ages past tier N's horizon (recommended
  horizons: 10s→**48h**, 1min→**7d**, 5min→**30d**, 30min→**90d**, 1hr→**1y**, 12hr/24hr→**forever**).
  Irreversibility is fine — the coarser bucket replaces the finer ones past each threshold. Aggregation
  is **per field** (table above): HR mean/min/max, SpO₂ mean, MET mean+minutes, steps sum, rMSSD median,
  temp mean.
- **Sleep and session domains store finished binned forms, not raw events** (brief §8): the 5-min
  hypnogram, per-night summary, and per-period stats — exactly the `sleep_sessions` /
  `sleep_phase_5_min` shape. These do not roll up the numeric ladder; they are written once in finished
  form.

`oura_bucket` schema (single wide table, nullable per-metric). **PK is `(tier, bucket_start_ms)` — NOT
`bucket_start_ds`** (the ring decisecond counter resets on re-key/dead battery, so a post-reset low-ds
bucket would collide with a historical one and silently overwrite a forever-tier; `bucket_start_ms` is
wall-clock via the forward-only anchor, collision-proof). As-shipped in local v18 (`migrations.ts`):
```
oura_bucket(
  tier TEXT,               -- '10s' | '1min' | '5min' | '30min' | '1hr' | '12hr' | '24hr'
  bucket_start_ms BIGINT,  -- wall-clock epoch ms via clock anchor  ← PK with tier
  bucket_start_ds BIGINT,  -- ring deciseconds (non-key; informational)
  local_date TEXT,         -- user-tz day (for day-keyed sync + queries)
  hr_mean REAL, hr_min REAL, hr_max REAL,
  hrv_rmssd_ms REAL,
  spo2_pct REAL, perfusion_index REAL,
  skin_temp_c REAL,
  met_mean REAL, met_minutes REAL,   -- steps is NOT here — it's a raw-hex-derived per-day finished form
  motion_mad REAL,
  ibi_ms TEXT,             -- JSON array; retained by the raw re-decode window for SleepNet/respiratory/
                           -- chronic-stress (which need per-event IBI across the whole night), NOT dropped at 5min
  sample_count INTEGER,
  updated_at TEXT, sync_status TEXT   -- offline-first trio (no deleted_at: buckets aren't user-deleted)
)
```
Fine tiers (10s/1min) are device-only extra resolution the server never had; the coarse tiers are the
long-horizon trend the finished tables don't hold.

### 2.4 What Railway gets (backup only)
Railway holds the **calculated finished forms only** — the existing table set, now **populated by device
push** instead of server rollup:
- `sleep_sessions`, `body_metrics`, `oura_daily`, `oura_daily_summary`, `oura_daily_derived`,
  `oura_heartrate` (5-min / 15-sec-workout points).
- **R4 resolved (no two sources of truth):** intraday HR is owned by **`oura_heartrate`** (the ≤5-min /
  workout-bin series that already exists server-side and holds the 15-sec workout resolution the
  fixed-width ladder can't). Railway also gets the **coarse `oura_bucket` tiers (≥30min only)** — the
  long-horizon trend `oura_heartrate` does *not* carry — so the two are **non-overlapping** on Railway,
  not duplicative. The fine bucket tiers (10s/1min/5min) stay device-only; no screen reads bucket HR for
  a range `oura_heartrate` already covers.
- **NOT** the fine tiers, **NOT** `body_hex`. Raw never returns to Railway.

Net effect: Railway's Oura footprint drops from raw-dominated (~200+ MB, unbounded) to the bounded
finished-form set (~tens of MB, ~365 rows/day-table/user/yr). That is the "Railway effectively
redundant" end state — it holds a small backup copy, nothing more.

---

## 3. Durability model (load-bearing — make it explicit)

| Data class | On-device | Railway backup | Loss on device wipe |
|---|---|---|---|
| Raw `body_hex` (`oura_raw_local`) | **source of truth**, single copy, 30-day window | **never** | Re-decode ability over the un-pruned window (acceptable) |
| Fine buckets (10s/1min) | source of truth | **never** | Sub-5-min resolution (acceptable — never existed on server) |
| ≥5-min buckets + finished daily/nightly forms | source of truth (local-first read) | **yes** (outbox push) | **Nothing** — *conditional* (see D2) |

> **⚠️ CORRECTED by Review Outcome D2.** The "Nothing" cell is true **only** once (a) the derived push to
> Railway exists for *all* finished forms (today `SyncDelta` carries only `sleepSessions`+`ouraDaily`,
> reduced subsets), (b) the value has actually reached Railway (`sync_status='synced'` — not merely
> rolled up locally; a dead-lettered/pending push is an un-backed-up loss window), and (c) within the
> 90-day `getSyncDelta` restore clamp. Un-rolled-up or un-pushed derived, and anything >90 days after the
> §6 raw drop, is single-copy on the local store. See D2 for the required ordering/fixes.

The owner-accepted tradeoff, stated plainly: a wiped/dead phone loses the ability to *re-decode raw* and
the sub-5-min series, but **every derived metric the app displays is recoverable from Railway**. This is
what makes moving the only raw copy onto the fragile local store acceptable — and it is why **the
derived→Railway push must never be dropped** (brief §7 guardrail).

Corollary: the local store's known failure mode (silently dead from a migration bug, twice) must not be
able to lose the derived metrics. Two protections: (1) the ≥5-min tier + finished forms are backed to
Railway, so a dead local store is re-hydratable; (2) the raw-drain cursor holds (does not advance) when
the local write fails — see §4.

---

## 4. The forward-only ring-cursor contract change (HIGHEST RISK)

### 4.1 The change
**Today:** `history_cursor_ds` advances via `confirmStored(ds)` after the **server** returns 2xx
(`OuraRingService.kt:378-409`). "Durable" = committed to Postgres.
**New:** `history_cursor_ds` advances after the batch's frames are **committed to local SQLite**.
"Durable" = committed to on-device `oura_raw_local`. The derived→Railway push is decoupled and
**does not gate the cursor**.

This is a *strict improvement* to robustness: the cursor no longer depends on the network at all,
eliminating the I2/I3/I19 network-wedge classes (session cookie expiry, Railway deploy, pool-starvation
retry storm) from the cursor path. Local dedup (`UNIQUE(ring_timestamp_ds, tag, body_hex)`) preserves
the loss-free re-drain guarantee locally.

### 4.2 Who writes local SQLite? (the crux native decision)
The native service runs **headless** (foreground service; the WebView/app is often not alive during a
drain). The `@capacitor-community/sqlite` plugin is **JS-side** and unavailable to headless Kotlin. So
the batch's durable write must be something the **native service itself** performs and can confirm.

**Options considered:**
- **(A) Native-owned raw SQLite DB (RECOMMENDED).** The Kotlin service opens its own SQLite file
  (`oura_raw.db`) via Android's `SQLiteDatabase`, inserts the batch (same dedup unique key), and
  `confirmStored(ds)` fires on that local commit. The WebView reads `oura_raw.db` (plugin pointed at the
  same file in read/rollup passes, or a plugin bridge method returning un-rolled rows) to decode + build
  buckets. **Preserves native autonomy** (drain + durable-store works with the app closed) and gates the
  cursor on a write the service fully controls. This is the load-bearing native change.
- **(B) Native forwards frames to the WebView, which writes via the plugin.** Rejected — the WebView is
  dead during background drains, so the cursor could never advance headless. Breaks the entire point of
  the foreground-service design.
- **(C) Keep POSTing but to an on-device loopback.** Effectively (A) with more moving parts. Rejected.

**Decision: (A).** `oura_raw.db` is native-owned; the WebView is a *reader* for decode/rollup and a
*pruner* (marks `rolled_up`, deletes past the re-decode window). The main `trainingai` store holds the
`oura_bucket` tiers + finished forms (written by the WebView rollup, synced by the outbox).

> Whether `oura_raw.db` is a **separate file** (recommended — isolates high-churn raw writes from the
> product store, avoids two-writer contention on `trainingai`) or a table inside `trainingai` opened by
> a second native connection (WAL required, contention risk) is a Phase-1 on-device decision. The spec
> recommends **separate file**; Phase 1 validates concurrent native-write + WebView-read on the S25.
>
> **⚠️ CORRECTED by Review Outcome (pinned rules).** Additional non-negotiables the first draft omitted:
> (1) the resume cursor must live **inside `oura_raw.db`**, advanced in the **same transaction** as the
> batch insert (SharedPreferences + a separate raw file can die independently → *data lost, cursor
> survives*, which ops-doc I9 does not recover); (2) `PRAGMA synchronous=FULL` on this DB (WAL NORMAL
> isn't battery-death durable, but the cursor advances anyway); (3) the WebView **never opens this file**
> — it reads un-rolled rows and prunes **via a native bridge** so a single SQLite library owns it;
> (4) the **prune predicate is `rolled_up=1 AND synced=1 AND age>window`, never age alone** — a catch-up
> or full-resync drain delivers old-timestamped events that an age-only prune would delete *before* the
> rollup runs; and (5) disk-full must alarm + reserve headroom (a full phone can't insert *or* prune →
> ring buffer wraps → permanent R4 loss). `rolled_up` may only be set after the derived output is durable
> on Railway (there is no cross-DB transaction between `oura_raw.db` and `trainingai`).

### 4.3 Invariants that MUST be preserved (each already paid for on-device)
1. **Advance only past durably-committed events.** `confirmStored(ds)` fires only after the local insert
   transaction commits — never on the ring's batch-done (0x11) alone (ops-doc BLE-1 / the brief's
   highest-risk point).
2. **Never jump a hole.** Keep `@Volatile drainIngestFailed`, set synchronously the instant a **local
   write** fails, re-checked before `confirmStored` (the R-1/I18 fix — repurposed from POST-failure to
   local-write-failure). A later batch that stored must still hold if an earlier batch in the drain
   failed.
3. **Monotonic cursor**, single-threaded ordered writes, dedup on the unique key. Unchanged.
4. **A local-write failure holds the cursor and re-drains** (dedup absorbs) — same safe fallback,
   now for `SQLiteException`/disk-full instead of non-2xx.
5. **The derived→Railway push failing must never hold the cursor** — it is downstream of durable local
   storage and retried by the outbox.

### 4.4 Tests
Port the golden vector tests with the decoders (kept green). Add: a cursor-hold test where the local
insert throws (cursor must not advance); a hole-safety test (batch 2 fails locally → batch 3 must not
confirm past it); a dedup test (re-drain of an unconfirmed span inserts 0 new rows, advances correctly).
Native behaviour is **device-gated** — unit tests are necessary, never sufficient; run
`docs/device-smoke-checklist.md` + the ops-doc §4 1:1 verification after the APK rebuild.

---

## 5. Silent cutover strategy

No user disruption, no data loss. The transition is invisible because the health screens keep reading
the same finished forms (now local-first, Railway fallback) and the derived data is continuous.

1. **Ship the new APK** with (a) native local-write + local-commit cursor gate, (b) WebView decode/rollup
   + bucket build, (c) derived→Railway outbox push. The **server ingest route stays live and unchanged**
   during transition (dual-accept) so a version-skew window never drops frames.
2. **Seed local from the ring, not from a migration.** On first run of the new APK, run the existing
   **Full re-sync** (drain from cursor 0 — ops-doc §4, already the documented "run once after a
   native-ingest APK is first installed" step). Local dedup makes this free; it repopulates `oura_raw.db`
   with everything still on the ring buffer, and the rollup rebuilds recent buckets. The persisted
   `history_cursor_ds` already in SharedPreferences means normal operation just continues forward.
3. **Backfill Railway from the device**, not the reverse: the first rollup pushes the derived forms
   through the outbox, so Railway's backup is current. (Most finished forms are already server-side from
   the old rollup — the push is a no-op upsert for those days.)
4. **Flip reads to local-first** for the Oura-fed surfaces (per the offline-first rule: a domain that
   writes locally must read locally). Keep the pure web fallback logic-free (Canonical Runtime).
5. **Retire the server raw ingest last** (Phase 4), only after on-device verification that local-commit
   cursor advance is solid across several real nights (§4 runbook, span + 1:1 counts).

No flag-day: old and new coexist until the device path is proven. The user sees identical screens
throughout.

---

## 6. The 437k existing Railway rows

`oura_raw_samples` on Railway is ~432,919 rows of `body_hex` (~200 MB, ~91% of the DB). Under the new
model Railway holds only calculated fields, so this table must go. Its only value is re-decode; the
finished forms it fed are already persisted server-side.

**Recommended: pull-to-device, then drop (confirm-first).**
1. **Preserve re-decode on the device** (where raw now lives): a one-time admin-gated pull of the 437k
   rows into `oura_raw.db` (paginated, dedup-safe). ~200 MB is comfortable on the S25. This keeps the
   archival/re-decode guarantee intact — it *moves*, not deletes.
2. **Ensure finished forms are complete server-side**: run the server rollup once over the full history
   (idempotent) so every day's `sleep_sessions`/`body_metrics`/`oura_daily_*` row exists as backup.
3. **Drop `oura_raw_samples` from Railway** — a migration + the existing admin `vacuum` path to reclaim
   the file. **This is data-dropping → confirm-first per CLAUDE.md**, and it **rewrites the "never prune
   `body_hex`" rule in the same PR** (the rule's premise — Railway is the archival home — no longer
   holds; the device is). The `oura-ble-operations.md` invariant ("`oura_raw_samples` holds every event
   the ring ever recorded") is re-scoped from the server table to `oura_raw.db`.

**Fallback if the device pull is deferred:** leave the server rows in place (aging, un-grown — new raw
stops arriving once ingest retires) and drop them later. Acceptable but leaves ~200 MB parked until then;
the pull-then-drop is cleaner and hits the space goal immediately.

Either way the **drop is the only destructive step and is gated behind explicit owner confirmation.**

---

## 7. Device storage UI (brief §4)

Extend `db-footprint-card.tsx` to show **local** footprint alongside (or instead of, on-device) the
server figures. Add a plugin/local query `getLocalOuraStorageStats()` returning the same shape as
`getOuraStorageStats()`:
`{ tables:[{table,rows,bytes}], rawSamples:{totalRows, ...}, buckets:{perTier:[{tier,rows,bytes}]} }`
for `oura_raw.db` + the `oura_bucket`/finished local tables. Show: raw-window row count + bytes (with
the 30-day prune horizon), per-tier bucket counts, total local DB size, and the re-decode-window
setting. The card already has the render shape (per-table list + `fmtBytes`); we feed it local numbers.

---

## 8. Refined phasing

| Phase | Scope | Ships via | Gate |
|---|---|---|---|
| **0 (this doc)** | Spec + backlog entry | docs-only PR | in-sandbox |
| **1** | `oura_raw.db` (native-owned) + local-commit cursor gate (§4); port decoders/rollup to WebView; `oura_bucket` tiers + finished local tables (+ RECONCILE + `check-reconcile`); tier-ladder promotion job (runs from BLE-sync completion / app-foreground — **no cron layer**) | native (APK rebuild) **+** JS/server | **device** |
| **2** | derived→Railway outbox domain (local table = payload = `getSyncDelta` = `pullDelta` = `applyDelta`); server routes accept derived, stop requiring raw | JS/server (Railway) | web-verify + device |
| **3** | Silent cutover (§5) + 437k legacy handling (§6, drop is confirm-first) | JS/server + one migration | **owner-confirm** for the drop |
| **4** | Local device-storage UI (§7) + retire server raw ingest | JS/server (+ card) | device |

**Every later PR states which half is native (needs APK rebuild) vs JS/server (ships via Railway into
the WebView).** BLE/native/SQLite behaviour is unverifiable in the sandbox — the merge gate for those
halves is the on-device smoke run or a Known-Issues row (Canonical Runtime).

---

## 9. Guardrails / non-goals (carried from the brief)
- **Do not rush to code.** This Phase-0 spec ships first; the cursor + durability design must be right
  before any device write-path change.
- **Keep the Railway derived-backup path.** "Railway redundant" means *raw* is gone from it, not that
  derived sync is removed — it is the disaster-recovery net.
- **Never lose data during cutover.** The ring buffer is forward-only; a botched cursor-advance or a
  local-store open failure silently loses drained spans. §4 invariants are non-negotiable.
- **Decoders stay infallible + golden-pinned** when moved client-side.
- **Verify on the S25.** Green sandbox tests are necessary, never sufficient, for any native/SQLite/BLE
  path.

## 10. Open questions for Phase 1 (device decisions)
1. `oura_raw.db` as a **separate file** (recommended) vs a table in `trainingai` via a second native
   connection — validate concurrent native-write + WebView-read on the S25 (WAL, lock contention).
2. The exact re-decode-window length (recommend 30 days) and per-tier horizons (§2.3) — tune against
   real device storage after a few weeks of data.
3. ~~Whether the ≥5-min bucket tier is worth syncing to Railway on top of the finished forms.~~
   **Resolved (R4, §2.4):** `oura_heartrate` owns intraday HR (≤5-min/workout bins); only the **coarse
   bucket tiers (≥30min)** sync to Railway — non-overlapping, no duplication.
4. Native SQLite write batching/perf during a full-history drain (dozens of back-to-back 255-event
   batches) — confirm local insert keeps pace with BLE-speed draining without wedging.

---

## 11. Appendix — full review findings (2026-07-21, four adversarial reviewers)

Deduplicated, severity-ranked, with file:line anchors. Resolutions are consolidated in the Review
Outcome at the top; this appendix is the traceable record.

### Rollup fidelity / feasibility
- **CRITICAL — ONNX inference can't run in the WebView.** `aggregateOuraRawSamples` runs SleepNet
  (`sleepnet_moonstone_1_2_0.onnx`, 8 MB; replaces the heuristic hypnogram + is the only BDI source,
  `adapter.ts:4383-4389`) and dHRV imputation (`dhrv_imputation_1_1_0.onnx` → daytime-stress → resilience,
  `daytime-stress.ts:87`, `adapter.ts:4910`) via `onnxruntime-node` + `fs.readFile(process.cwd()/…)`
  (`inference/session.ts:4,12,32-34`; 31 MB across `lib/oura-models/onnx/`). Header: *server-only, must
  never reach the client bundle.* → **D1.**
- **HIGH — §2.2 mis-states the HRV formula.** Headline HRV = `medianGated` over `0x5d` ring rMSSD
  (`adapter.ts:4252,4439`; `decode.ts:115-125`), not IBI recompute; IBI recompute (`hrv-5min.ts:70`) feeds
  only chronic-stress (`adapter.ts:4528,4533`). Per-event IBI is needed by SleepNet (`:4349-4351`),
  respiratory/LF-HF (`:4324,4331-4332`), chronic-stress — across the whole night, not a 5-min tier. → pinned.
- **HIGH — `oura_bucket.hrv_rmssd_ms` is a second, ungated HRV** diverging from the MET-gated,
  sleep-scoped nightly value (`daily-medians.ts:38-45`). → pinned (no two sources of truth).
- **HIGH — "subsume not duplicate" incoherent for intraday HR.** §2.4 syncs both `oura_heartrate` and the
  ≥5-min bucket = same numbers, two tables. `oura_heartrate` has 15-sec workout bins (`adapter.ts:4680,4708`)
  the fixed ladder can't represent, and is delete-reinsert keyed on `source='ble'` (`:4727-4738`). → pinned.
- **HIGH — `body_metrics`/`oura_daily` are multi-source** (per-column `sourceMap` priority merge,
  `adapter.ts:1735-1739`; COALESCE non-overwrite). A device push must mirror the merge or clobber
  manual/HC data. → pinned.
- **MEDIUM — steps isn't a "sum."** Raw-`body_hex`-dependent window-classify + max-merge
  (`pairStepFeatures`, `adapter.ts:4620,4626-4670`; `step-estimate.ts:35-52`). → pinned (drop as bucket field).
- **MEDIUM — MET-mean breaks HRV/RHR gating** (>1.8 → next-60 s exclusion, `daily-medians.ts:58-68`;
  `adapter.ts:4241,4281-4284`); gating must precede promotion. → pinned.
- **MEDIUM — RHR/headline physiology are finished daily forms, not ladder fields** (RHR = lowest non-MET
  5-min bin avg, deliberately not a raw min, `adapter.ts:4263-4290`); a coarse-tier `hr_min` is the
  forbidden artifact. The ladder is over-billed; finished-form recompute is where the correctness is. → noted.
- **LOW — sleep-as-binned-stages is sound** (`sleep_sessions`+`sleep_phase_5_min` capture the ribbon,
  `adapter.ts:4447-4469`); only the admin per-epoch `debugNight` dump can't be reproduced past the raw window.

### Cursor contract / data-loss
- **CRITICAL — cursor (SharedPreferences) and raw (`oura_raw.db`) die independently** → data-lost/cursor-survives,
  not covered by ops-doc I9 (`OuraRingService.kt:561-564`). → pinned (co-locate cursor in raw DB txn).
- **CRITICAL — age-only prune races catch-up/full-resync drains of old events** (land with old `measured_at`,
  deleted before rollup). → pinned (`rolled_up AND synced AND age`).
- **CRITICAL — `rolled_up` set before derived durable; no cross-DB txn** between `oura_raw.db` and
  `trainingai`; and "durable in `trainingai`" ≠ "durable on Railway." → pinned (gate on `sync_status='synced'`).
- **HIGH — WAL `synchronous=NORMAL` not battery-death durable, cursor advances anyway** (`sqlite-service.ts:75-78`
  sets WAL not FULL). → pinned (`synchronous=FULL`).
- **HIGH — disk-full couples to the ring's finite buffer** (can't insert *or* prune → R4 wrap). → pinned (alarm + R4 row).
- **HIGH — phase ordering ships the cursor change before the Railway backup exists** (§8 P1 vs P2; §5.1
  contradicts §8). → D2 (merge P1+P2 or keep dual-write raw).
- **HIGH — two SQLite libraries on one WAL file** (framework writer + plugin reader) footgun +
  `SQLITE_BUSY`. → pinned (native-bridge single-owner).
- **MEDIUM — clock anchor is server-maintained at ingest** (`adapter.ts:3928-3943`); must move on-device,
  forward-only (R6). → pinned.
- **MEDIUM — I10 "redecode forever" downgraded** to the raw window; model-version bumps (all versioned .onnx)
  capped too. → pinned (rewrite I10 in-PR).
- **MEDIUM — poison-pill quarantine moves loss from the safe raw path to the silent derived path.** → D2/M1.

### Durability / cutover / legacy
- **CRITICAL — pull-delta restore doesn't exist for 3 finished forms, reduced subset for 2**
  (`repository.ts:222-231`; local `sleep_sessions` thin, `migrations.ts:274-282`). → D2.
- **CRITICAL — 90-day `getSyncDelta` clamp caps any restore** (`adapter.ts:2970-2972`), even full resync. → D2.
- **CRITICAL — §6 drop precondition unverified:** normal rollup 35-day windowed (`adapter.ts:4048,4071`),
  `fullHistory` times out at the gateway (`:4043-4046`); `oura_daily_summary`/`_derived` only exist from
  migs 116/123 → old days may have no row. → pinned (per-day completeness audit + batched backfill + staged drop).
- **HIGH — clobber-guard missing on `sleep_sessions`/`oura_daily` local branches** (`sqlite-backend.ts:850-855,964`)
  — become writer-owned → pull clobbers pending local edits; tables also lack `sync_status` and can't render
  Oura offline today. → pinned.
- **HIGH — dual-accept two-writer race:** server rollup + device rollup both write the finished tables;
  `COALESCE(EXCLUDED,existing)` = first-writer-wins masks decoder-port divergence; `oura_heartrate` dup points
  (`samples/route.ts:114`). → D2 (single-writer cutover).
- **HIGH — the six-table offline chain is named, not designed** (no Oura arm in `pushMutations`,
  `sync-engine.ts:594-642`). → D2.
- **HIGH — WebView/native version skew** (JS ships via Railway instantly; native needs APK rebuild,
  `capacitor.config.ts:8-9`) → local-first read on an empty store = blank Oura screens. → pinned (gate read-flip
  on a native-capability probe).
- **MEDIUM — dead-lettered/not-yet-pushed derived is a silent loss window** (`sync-engine.ts:558-582`; Oura not
  a surfaced dead-letter tier). **MEDIUM — bytea migration interaction** (`db-volume-cleanup-handover.md` §5) —
  pick one strategy. **MEDIUM — staged rename-then-drop** over hard DROP. → pinned.

### Rule-compliance / codebase-reality
- Verified accurate: local DB v16→17; WAL-post-open; `check-reconcile.js`/`check-push-mutations.js` under the
  required **Custom Rules** check (`ci.yml:227,230`); line anchors current; decoders are client-side TS;
  no-cron trigger matches module-map §0 (drop the "BLE-sync-completion" half).
- **A1 = D2** (cursor-advance-on-raw-commit opens a derived-loss window post-cutover).
- **A2** — `oura_raw.db` outside the reconcile/CI safety net. → pinned.
- **A3** — "runs from BLE-sync completion" contradicts §4.2 (WebView dead during background drain) → app-foreground only.
- **B1** — `check-push-mutations` + six full mirror chains (not one domain). → D2.
- **B2/B3** — cache-group invalidation (`invalidateOuraSync`/`invalidateReadinessInputs`, `cache-groups.ts:98,157`)
  + classify each Oura read surface single-domain-local vs sanctioned-server-aggregate. → pinned.
- **B4** — claim Postgres migration **136** (highest 135; 130 free). → pinned.
