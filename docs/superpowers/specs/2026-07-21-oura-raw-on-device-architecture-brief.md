# Design Brief / Agent Prompt — Move Oura raw data on-device; Railway holds only calculated fields

**Owner directive, 2026-07-21.** This is the investigation + implementation brief for a **separate
agent**. It is a *planning-first* task: produce a design/spec and a phased plan **before** shipping any
device code. Most of this is device-gated (see Constraints) and cannot be verified in the web sandbox.

---

## 1. Mission (north star)

Invert the Oura BLE data architecture:

- **The phone's local SQLite becomes the source of truth for raw ring data** (`body_hex`) and all
  high-resolution derived series.
- **Railway Postgres holds ONLY compact *calculated* fields**, kept purely as an off-device **backup /
  redundancy** copy "in case we lose mobile data."
- **End state: the Railway server is effectively redundant.** All data lives on the device; the
  calculated fields are mirrored to Railway as a safety copy, nothing more.

This directly fixes the Railway 1 GB volume pressure (see `docs/db-volume-cleanup-handover.md`): the bulk
table `oura_raw_samples` (437k rows, row-count-driven — *not* payload-driven) stops living on the server.

## 2. Why this is feasible (and why it's risky)

- **Feasible:** the decoders are **already TypeScript** (`lib/oura-ble/decode.ts`), so they can run in
  the WebView on-device without a rewrite. They're pinned to golden test vectors — keep those green.
- **Risky:** this moves the **only copy of irreplaceable, forward-only ring data** onto the device's
  local SQLite — the same store that has gone **silently dead twice** from migration bugs (CLAUDE.md
  "Local SQLite Migrations"). The owner accepts this tradeoff **because the *calculated* fields are
  backed up to Railway** — so a device wipe loses raw re-decode ability, but **never** the derived
  metrics. Make that durability model explicit and load-bearing in the design.

## 3. Hard requirements (from the owner — do not drop any)

1. **Raw `body_hex` + high-resolution data lives on-device** (local SQLite). Raw never needs to sit on
   Railway again.
2. **Only calculated fields sync to Railway**, as backup. Keep this sync path — it is the disaster
   recovery for a lost/wiped phone.
3. **Local data MUST persist across app updates.** When the owner builds and uploads a new APK, the
   on-device DB must survive. (Capacitor SQLite persists in the app data dir across *updates* by
   default — the real risk is a migration bug on upgrade, not update wipe. Verify the DB path/persist
   config and make upgrades bullet-proof: no PRAGMAs in upgrade txns, idempotent `ADD COLUMN`, every new
   table/column registered in `RECONCILE_TABLES`/`RECONCILE_COLUMNS` in the same commit.)
4. **Show device storage usage in the UI.** Extend the existing footprint surface
   (`components/oura-ble/db-footprint-card.tsx` + `app/api/oura-ble/db-stats/route.ts`) to report
   **local** DB size / row counts, not just server.
5. **Silent cutover** from the current Railway-raw setup — no user disruption, no data loss. The
   changeover from "raw→server" to "raw→local, derived→server" must be invisible.
6. **Tiered time-bucket downsampling** of the calculated data (see §5) — the owner's core model.
7. **Determine precisely what "calculated data" is** (§5) — the single biggest open design question.
8. **Sleep and similar domains store final binned events/stages, not raw** — aggregate to the finished
   form (sleep stages, per-period summaries) rather than shipping raw events to the server.

## 4. Constraints & documented traps (READ before designing — these have all bitten this repo)

Read first: `CLAUDE.md` (all DB/sync/offline/SQLite/BLE sections), `docs/db-volume-cleanup-handover.md`,
`docs/oura-ble-operations.md`, `docs/superpowers/plans/2026-07-15-oura-data-architecture-and-culling.md`,
and the `oura-native-ble` skill.

- **Device-gated:** native plugin, local SQLite, BLE, and on-device decode do **not** run in the sandbox
  (no Android SDK, Gradle proxy-blocked, `getLocalStore` returns null on web). Decoders can be
  unit-tested; everything else needs the **S25 + APK rebuild** (`npx cap sync android && ./gradlew
  assembleDebug`). State which half of each PR is JS/server (ships via Railway) vs native (needs rebuild).
- **Local SQLite fragility:** migrations have killed the local DB twice. No PRAGMAs inside upgrade
  `statements`; `ADD COLUMN` is not idempotent; register every table/column in `reconcileSchema()`;
  never make a critical read path depend solely on the local store opening.
- **Archival rule rewrite:** `body_hex` is a forward-only ring buffer; CLAUDE.md currently says *never
  delete/mutate it* and *"the history cursor may only advance past durably-ingested (server-2xx)
  events."* This project **redefines "durable"** from "server 2xx" to "committed to local SQLite." That
  cursor-advance contract (`lib/sync/cursor.ts`, `OuraRingService.kt` `confirmStored`) must be updated
  carefully — advancing the ring cursor before the local write is durable would **lose the drained span
  forever**. This is the highest-risk correctness point in the whole project.
- **Offline-first mirroring:** every synced domain has a web route + a `pushMutations` branch that must
  call the same shared write fn; the outbox must never wedge on a poison-pill mutation; pull/push are
  paginated. The new "derived → Railway" path is a new synced domain — wire the full chain
  (local table = payload = `getSyncDelta` = `pullDelta` = `applyDelta`).
- **Decoders:** already TS, pinned to captured test vectors; infallible (malformed → `null`, never
  throw). Keep vectors green when moving them client-side.
- **There is no cron layer** (see `docs/module-map.md` §0) — on-device rollup/downsampling must run from
  an existing trigger (BLE sync completion, app foreground), not a scheduler.

## 5. THE central investigation — "what is calculated data?" + the tier ladder

The owner's model: a **time-frame bucket carrying as much calculated information as possible**, which is
**progressively averaged into coarser buckets as it ages**, RRDtool-style:

```
10 sec → 1 min → 5 min → 30 min → 1 hr → 12 hr → 24 hr
```

Design questions the agent must answer (this is the meat of the spec):

- **Bucket schema:** what metrics does a bin carry? (HR, HRV/rMSSD, SpO₂, skin temp, motion/MET, steps,
  sleep stage, signal quality, …) — enumerate per Oura tag, mapping each of today's high-volume tags
  (`spo2_r_pi_event`, `ibi_and_amplitude_event`, `green_ibi_quality_event`, `real_step_event_*`,
  `temp_event`, `motion_event`, sleep tags) to the calculated field(s) it feeds.
- **Raw vs buckets on-device:** `body_hex` is opaque — it **cannot be averaged**; only the *decoded
  numeric values* roll up the ladder. Decide: how long does the device keep raw hex (re-decode window)
  before it's dropped in favour of the finest (10 s) bucket? Then the numeric buckets downsample upward.
- **The tier ladder mechanics:** when does a bucket promote to the next tier? What aggregation per field
  (mean? min/max? last? for HRV, rMSSD must be recomputed from intervals, not averaged)? Irreversibility
  is fine — coarser tiers replace finer ones past each threshold.
- **What Railway gets:** which tier(s) sync to the server as backup? (Likely the coarser end — e.g. 5 min
  and up, plus daily scores — so the server copy is small but restores the metrics on device loss.)
  Fine-grained (10 s / 1 min) may stay device-only.
- **Sleep & session domains:** store finished binned stages / per-period summaries, not raw events.
- **Reconcile with what already exists:** `oura_daily`, `oura_daily_summary`, `oura_daily_derived`
  (mig 123), `sleep_sessions`, `body_metrics`, `oura_heartrate`, `rr_intervals` (mig 124) already hold
  finished daily/epoch data — the new bucket store should extend/subsume these, not duplicate them.

## 6. Proposed phasing (agent to refine)

- **Phase 0 — Spec (docs-only, in-sandbox):** answer §5, define the bucket + tier schema, the durability
  model, the cutover strategy, and the legacy-migration plan for the 437k existing Railway rows. Output a
  plan doc in `docs/superpowers/plans/` + a backlog entry. **Ship this first, standalone.**
- **Phase 1 — On-device raw store + decode/rollup (device-gated):** local `oura_raw_samples` table
  (+ RECONCILE), move the native plugin ingest from HTTP-to-server → local write, port the rollup to run
  in the WebView, implement the tier ladder.
- **Phase 2 — Derived → Railway backup sync:** new outbox domain pushing calculated buckets; server
  routes accept derived, stop requiring raw.
- **Phase 3 — Silent cutover + legacy backfill:** dual-write/transition so no data is lost; decide
  whether to pull the existing 437k server rows down to the device or let them age out server-side.
- **Phase 4 — Device storage UI + retire server raw ingest.**

## 7. Guardrails / non-goals

- **Do not rush to code.** Phase 0 spec first; the durability + cursor-contract design must be right
  before any device write path changes.
- **Keep the Railway derived-backup path** — removing it defeats the "in case we lose mobile data" safety
  net. "Railway redundant" means *raw* is gone from it, not that derived sync is removed.
- **Never lose data during cutover.** The ring buffer is forward-only; a botched cursor-advance or a
  local-store open failure silently loses drained spans.
- **Verify on the S25.** Green sandbox unit tests are necessary, never sufficient, for any
  native/SQLite/BLE path — run `docs/device-smoke-checklist.md` or file a Known-Issues row.

## 8. First files to read

`CLAUDE.md` · `docs/db-volume-cleanup-handover.md` ·
`docs/superpowers/plans/2026-07-15-oura-data-architecture-and-culling.md` · `docs/oura-ble-operations.md`
· `lib/oura-ble/decode.ts` · `app/api/oura-ble/samples/route.ts` · `aggregateOuraRawSamples` in
`lib/data/postgres/adapter.ts` · `lib/local-store/` · `lib/data/postgres/migrations/114_oura_raw_samples.sql`
· `lib/sync/cursor.ts` · `components/oura-ble/db-footprint-card.tsx` · `app/api/oura-ble/db-stats/route.ts`
· the `oura-native-ble` skill.
