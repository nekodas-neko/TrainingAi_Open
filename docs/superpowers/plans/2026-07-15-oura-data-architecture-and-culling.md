# Sub-plan A — Oura Data Architecture: Completed-Form Recording + Ingestion Culling

**Parent:** `2026-07-15-oura-models-program-master.md` · **Branch:** `feat/oura-data-architecture-culling`
· **Phase:** 0 (enabler) + ongoing. · **Type:** DB migrations + rollup plumbing. Some steps are
**data-dropping → confirm-before-merge** per CLAUDE.md.

Solves two things, in this priority order (owner directive 2026-07-15):
1. **PRIMARY — stop the Railway DB growing unbounded** by culling raw data we don't use. This ships
   **first and standalone** (Part 2, Levers 1–3); it depends on nothing else.
2. **Secondary — persist derived metrics in *completed form*** (Part 1), motivated *analysis-first*;
   its read-path optimization is applied only where a measured paint cost justifies it (master §4.1).
   Completed-form's role in the space goal is to *make raw disposable* (derive → store compact → drop
   raw), not to add storage on top of the raw we're keeping.

Grounded in the DB-bloat audit (findings inline below). **Part 2 (culling) is the priority read;
Part 1 (completed form) supports it.**

---

## 1. Current state (audited)

Footprint ranking (worst first):
1. **`oura_raw_samples`** (`schema.ts:687`) — one row per BLE history event, **~1–2M rows/yr,
   unbounded, no prune**. Each row carries **both** `body_hex TEXT` (archival) **and** a `decoded
   JSONB` (best-effort structured decode). The `decoded` blob roughly **doubles** per-row cost.
2. **`oura_accel_chunks.magnitudes int[]`** (`schema.ts:725`) — up to ~80 KB/row; **already pruned
   at 7 days** (`adapter.ts:4217`). Fattest per-row, self-capping.
3. **`oura_heartrate`** (`schema.ts:676`) — many rows (intraday series); **pruned 180 days**
   (`slices/oura.ts:391`, throttled once/24h via `retention-throttle.ts`).
4. **`step_live_windows`** (`schema.ts:712`) — compact but **unbounded, no prune** (schema comment
   claims 7-day but nothing enforces it).
5. Per-day/per-event tables (`oura_daily`, `oura_daily_summary`, `sleep_sessions`, `body_metrics`,
   `oura_workouts`, `oura_tags`, anchors) — naturally bounded (~365 rows/user/yr), leave alone.

Retention today: **no cron/scheduled job anywhere.** Only three ingest-time throttled prunes exist
(accel 7d, heartrate 180d, error_events 30d) via `lib/data/postgres/retention-throttle.ts`
(`shouldPrune` gates to once/24h). Highest migration number = **122**; claim **123+**.

**Archival constraint (hard, CLAUDE.md):** `oura_raw_samples.body_hex` is the only copy of a finite,
forward-only ring buffer; **never delete or mutate it**. `decoded` JSONB, by contrast, is fully
re-derivable from `body_hex` via `redecodeOuraRawSamples` (`adapter.ts:3521`), so it is **not**
archival.

Derived-metric persistence today (derivation audit): `sleep_sessions`, `body_metrics`,
`oura_daily_summary`, `oura_heartrate` hold completed nightly physiology + baselines. But **sleep
score, activity score, readiness, and all contributors are recomputed live** in
`app/api/readiness-score/route.ts` and **never persisted** — the gap this plan closes.

---

## 2. Part 1 — Completed-form recording

### 2.1 New table `oura_daily_derived` (migration 123)
One row per `(user_id, day)`. Holds the **finished** outputs the app currently recomputes, plus new
derived metrics from the other sub-plans, so we have an analysis-ready daily record and instant
paints.

**Create the table ONCE, up front, with EVERY column the whole program will use** (all nullable) —
sweep the six sub-plans and declare their columns in this single migration. Domain PRs then only
*write* to existing columns; they never issue their own `ADD COLUMN`, which removes the
parallel-PR migration-ordering hazard. A metric absent for a day is simply null. Columns:
- Keys: `user_id`, `day` (local date), `computed_at`, `source` (`ble-derived`|`oura-cloud`),
  `model_versions JSONB` (e.g. `{"sleepScore":"1.0","readiness":"1.0"}` — provenance per §4.6 master).
- Scores: `readiness_score`, `readiness_contributors JSONB`, `sleep_score`,
  `sleep_contributors JSONB`, `activity_score`, `activity_contributors JSONB`.
- Derived sub-metrics that are currently ephemeral: `recovery_index_hours`, `training_load_ots`,
  `active_calories_est`, `daytime_stress_scaled`, `illness_flag`, `illness_score`,
  `body_comp JSONB` (fat_mass/ffm/bmr), etc. — each added by the owning sub-plan.
- Every column nullable; a metric absent for a day is simply null.

Cache-group + SWR headers per the CLAUDE.md cache rules; register a `oura-daily-derived:*` key and
add it to the invalidation group of the rollup write.

### 2.2 Write path
`aggregateOuraRawSamples` computes these already (or will, per sub-plans) — it must now **persist**
them via a single idempotent `upsertOuraDailyDerived(userId, day, payload)` (ON CONFLICT `(user_id,
day)` DO UPDATE with `COALESCE(EXCLUDED.col, existing)` semantics so a partial recompute never nulls
a good value). Mirror the `pushMutations`/web split only if a client write path exists (it does not
for BLE-derived — server rollup only), so no outbox domain is needed here.

### 2.3 Read path — perf-gated per surface, not a blanket rule
Converting a surface to **read `oura_daily_derived` first** (compute-and-persist only on a miss) is
worth it **where the live recompute is measurably slow** — the heavy ones: the sleep feature stack,
OTS' 720-min windows, the full readiness composite. For those, read-first removes per-request
recompute and gives instant paint (cache-seed rule). For a metric that is cheap to compute live,
**keep computing it live** — don't add a read-path/invalidation surface just for uniformity
(master §4.1). The daily *snapshot write* still happens for all of them (analysis record); only the
*read* source is the per-surface decision. Keep the pure online-web fallback logic-free (Canonical
Runtime). Measure before converting a surface.

### 2.4 Analysis time-series (compact, durable)
For later analysis the user wants richer-than-daily data without the raw bloat. Persist **downsampled
derived series** the models already produce but we currently discard:
- Per-bin **MET series** (`0x50`) → a compact `oura_met_daily` (or a JSONB array on the daily row) at
  1-min resolution — needed by OTS/energy anyway, and analytically valuable. (Today it's collapsed to
  a day-mean and lost.)
- 5-min **HR/HRV/temp epoch series** already binned in the rollup → persist the epoch arrays
  (compact) rather than only the nightly scalar, for later re-scoring.
These are small (per-day arrays), unlike raw samples.

---

## 3. Part 2 — Ingestion culling (respecting the archival rule)

Ordered by leverage. **Levers 1–3 are safe and reversible; Lever 5 is data-dropping → confirm-first.**

### Lever 1 — Stop persisting the redundant `decoded` JSONB (biggest safe win)
`decoded` is fully re-derivable from `body_hex`. Two options (plan recommends 1a):
- **1a (recommended):** stop *writing* `decoded` at ingest for tags whose decode the rollup consumes
  transiently — decode in-memory during `aggregateOuraRawSamples`, persist only the aggregate, never
  store the JSONB. Keeps `body_hex`. Redecode still works (it re-decodes from hex). ~halves
  `oura_raw_samples` size going forward.
- **1b:** keep writing `decoded` but add a retention pass that **nulls `decoded` on rows older than N
  days** (keep `body_hex`). Reclaims space on existing rows too. **Correction (2026-07-15, shipped +
  device-verified):** "reclaims space" is true only *logically* — `pg_column_size(decoded)` over live
  rows genuinely drops to 0. It is **not** true physically: Postgres MVCC means `UPDATE … SET decoded
  = NULL` leaves the old JSONB payload as a dead tuple on disk until vacuumed, and even autovacuum
  only makes that space *internally reusable*, never shrinks the table file. The owner observed this
  directly — `oura_raw_samples` barely moved (229→230 MB) after clearing the whole backlog. A
  `VACUUM FULL`/`pg_repack` pass (proposed Lever 1c, not yet built) is required to actually shrink the
  file. Full writeup: `docs/oura-ble-operations.md` §1 row I17.
- Do **both**: 1a for new rows, a one-off 1b backfill to null historical `decoded`.
- **Guard:** anything that currently reads `decoded` off *persisted* rows (e.g. redecode, any debug
  endpoint) must be confirmed to re-decode from `body_hex` instead. Audit before shipping.

### Lever 2 — Tag whitelist for raw storage
Pure telemetry/debug/state tags carry **no analytical and no redecode value**:
`0x42 time_sync, 0x43 debug, 0x45/0x53 state/wear_text, 0x56 alert, 0x5b/0x79/0x82/0x83 telemetry,
0x61 debug_data`. Stop persisting `oura_raw_samples` rows for these (drop at ingest). Keep everything
biometric (the tags the rollup consumes, §capture audit) plus anything plausibly future-decodable
(`0x64/0x68` raw PPG, sleep summaries `0x49/0x4c/0x4f/0x58`, atlas `0x87/0x88`) — those stay archival.
Make the whitelist a single constant so it's auditable.

### Lever 3 — `step_live_windows` retention
Add an ingest-time throttled prune (reuse `retention-throttle.ts`) deleting windows older than **N
days** (e.g. 30) once their steps are folded into `body_metrics.steps`/`oura_daily_derived`. It's
currently unbounded.

### Lever 4 — `oura_heartrate` resolution/retention review
Confirm 180-day retention is still wanted; consider persisting only the **5-min binned** series
(what the models consume) rather than finer, and/or shortening the window now that
`oura_daily_derived` holds the analysis-grade daily scalars. Compact but worth trimming.

### Lever 5 — Aged `body_hex` retention (POLICY SHIFT the owner has endorsed; confirm the window)
`body_hex` cumulative growth (~1–2M rows/yr) is the real long-term driver. CLAUDE.md currently says
*never prune `body_hex`* (redecode source of truth), but the owner's directive — *"record and analyse
and delete raw data later"* — **explicitly relaxes this**: once a day's raw is decoded into the
completed-form + the derived series we keep, aged `body_hex` becomes eligible for removal. Options,
ascending risk:
- **5a — compressed cold table** (`oura_raw_samples_archive`, `body_hex` gzip'd / Postgres
  compression) for rows older than N months, redecode reads it on demand. Keeps the back-fill ability;
  cuts hot-table size. **Recommended intermediate step.**
- **5b — hard-delete `body_hex`** older than a retention window (keep the row's metadata/derived, drop
  the hex). Biggest space win. **The conscious tradeoff:** forfeits back-filling a *future better
  decoder* over that span — so the window must be long enough that decoders have stabilised.
- **5c — external object-storage export** (Railway volume/S3), DB keeps a pointer. Most work, weakest
  one-query redecode.
- **Recommendation:** ship Levers 1–4 first and **measure** the actual footprint; then set a
  `body_hex` policy — default to **5a (cold-store) then 5b (delete) past a longer window**. Any of
  5a/5b/5c is **data-dropping/moving → confirm the exact retention window with the owner, and update
  the CLAUDE.md "never prune body_hex" rule in the same PR.**

---

## 4. Migrations & tasks

1. **Migration 123** — create `oura_daily_derived` (Phase-1 columns) + indexes + cache wiring.
2. **Migration 124** — `step_live_windows` retention support (if a column/index is needed) + code
   prune in the insert path.
3. **Code — ingest** (`app/api/oura-ble/samples/route.ts` + `insertOuraRawSamples`): apply the tag
   whitelist (Lever 2) and stop writing `decoded` (Lever 1a).
4. **Code — rollup** (`aggregateOuraRawSamples`): decode transiently in-memory; call
   `upsertOuraDailyDerived`; persist compact MET/epoch series (§2.4).
5. **Code — read** (`readiness-score/route.ts` + health surfaces): read `oura_daily_derived` first,
   compute-and-persist fallback.
6. **One-off backfill migration** — null historical `decoded` (Lever 1b). **Data-dropping →
   confirm-first.** Idempotent, throttled, batched (don't lock the table).
7. **Retention audit doc row** — add a `docs/oura-ble-operations.md` §1 row for the new prune/whitelist
   behaviour (per CLAUDE.md).

## 5. Testing & verification
- Unit: `upsertOuraDailyDerived` COALESCE semantics; tag-whitelist filtering; redecode still works
  with `decoded` absent (decode-from-hex path).
- Integration: a redecode over a fixture night reproduces the same `oura_daily_derived` row
  (idempotency + completed-form correctness).
- Migration check (CI) + `pnpm dev` exercise of the readiness route reading the new table.
- Device gate: confirm on the S25 APK that instant paint reads persisted derived rows offline.
- **Measure:** capture `oura_raw_samples` / total DB size before and after Levers 1–3 to quantify the
  cull (report actual numbers in the session journal).

## 6. Risks
- **Redecode regressions from Lever 1** — the #1 risk; the archival guarantee depends on redecode
  reading from `body_hex`, not persisted `decoded`. Audit every `decoded` reader first.
- **Backfill lock/perf** (Lever 6) — batch + throttle; never a single unbounded UPDATE.
- **Double source of truth** — `oura_daily_derived` must never become authoritative over
  `sleep_sessions`/`body_metrics` for the raw physiology; it holds *scores/derived* only, those tables
  keep the measured values. Keep the boundary crisp.
- Data-dropping steps (6, 5b/5c) gated behind explicit confirmation per CLAUDE.md.
