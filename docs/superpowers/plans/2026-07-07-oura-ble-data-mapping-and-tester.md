# Oura BLE — Timestamp Hardening, Tester Upgrades, Product Data Mapping

**Source review:** `docs/reviews/2026-07-07-oura-ble-system-review.md` (BLE-3, -4, -5, -8,
-9, -11, -13, -16). **Branch:** `feat/oura-ble-data-mapping`. Server/JS work — ships via
Railway, no APK rebuild; testable against the local dev DB with captured frames (the
Phase-3/4 method). Independent of the durable-background-sync plan (can land before or
after), but the **cloud-sync cutover in Chunk 4 must not ship until the mapping in Chunk 3
is verified on real overnight data**.

**Goal:** make the raw-sample store time-robust and self-describing, make the tester show
every decoded field, and graduate the spike into the product: BLE-derived HRV / RHR /
temperature / SpO₂ / sleep rows landing in `body_metrics` / `sleep_sessions` where every
health screen already reads — replacing the Cloud data that stopped at the re-key.

---

## Chunk 1 — Persisted clock anchor + stored `measured_at` (BLE-5)

1. **Migration 115** (claim the number against the directory + open plans; on-disk max is
   114): `oura_ble_clock_anchors` table — `id`, `user_id`, `anchor_ds BIGINT`,
   `anchor_utc TIMESTAMPTZ`, `created_at`; plus `measured_at TIMESTAMPTZ` column on
   `oura_raw_samples`.
2. **Capture an anchor at every ingest** (spike-simple, no native change needed): the
   ingest route already receives near-live frames whenever a drain runs; insert/update the
   user's anchor row as `(max ringTimestampDs in batch, now())` whenever that max exceeds
   the stored `anchor_ds` (a *newer* ring timestamp observed at ingest is a fresher
   correspondence). **Epoch reset detection:** if an incoming batch's max ds is *far below*
   the stored anchor (ring clock went backwards), insert a NEW anchor row rather than
   updating — old rows keep their old epoch's anchor via `created_at` ordering. (When the
   durable-sync plan later moves ingest native, the service can capture a purer anchor at
   SyncTime-ack; same table, better source.)
3. **Stamp `measured_at` at ingest** from the current anchor; back-fill existing rows once
   with the read-time formula (idempotent `UPDATE … WHERE measured_at IS NULL`).
   `ring_timestamp_ds` stays the source of truth; `measured_at` is derived convenience so
   consumers (Chunk 3) can bucket by user-local day via `lib/date-utils` without anchor
   math.
4. `getOuraRawSampleSummary` reads `measured_at` instead of re-deriving.

**Verify:** POST captured frames → anchor row created, `measured_at` populated; POST a
batch with a wildly lower ds → new anchor row (epoch 2), old rows untouched.

## Chunk 2 — Tester as a field-verification tool (BLE-8, BLE-11)

1. **Unknown tags surfaced:** summary groups by `(tag, event_name)`; unknowns render as
   `unknown_0x77×N`, highlighted — each is a visible decoder TODO. Drop the top-8 cap
   behind a "show all" toggle.
2. **Latest-decoded inspector:** summary gains `latestByTag: {tag, eventName, measuredAt,
   decoded, bodyHex}[]` (one newest row per event type, cheap via `DISTINCT ON`); tester
   renders an expandable list showing the decoded JSON with field names — the "what
   exactly are we pulling" view the owner asked for.
3. **More metric tiles:** HRV (latest rmssd), SpO₂ (latest % if `0x6f` present, else
   latest r/PI labelled "uncalibrated"), sleep (last night's stage counts), wear state.
4. **Drain visibility:** show the persisted cursor + current anchor when idle;
   `bytes_left` + batch count while draining (from the existing status/log events); label
   session counters "this visit".
5. Keep it componentized (`components/oura-ble/`) — the debug screen is near the 800-line
   ceiling once this lands; extract the inspector + tiles as children.

**Verify:** local dev server + captured frames; Playwright pass on `/admin/oura-ble`.

## Chunk 3 — Product mapping: `oura_raw_samples` → `body_metrics` / `sleep_sessions` (BLE-3, BLE-9, BLE-16)

The heart of the graduation. All formulas live once in `lib/health/` (One Formula, One
Place); mapping runs server-side after ingest (event-driven — after each ingest POST that
stored rows, throttled ≤1×/30min per user; no cron layer, module-map §0).

1. **Provenance first (BLE-9, Track-B prerequisite):** add `source TEXT` to
   `body_metrics`-adjacent writes per the 2026-07-06 review's Track-B design — at minimum
   tag BLE-derived writes (`'oura_ble'`) and make the merge precedence explicit
   (manual > oura_ble > health_connect for overlapping fields) instead of blind
   `COALESCE`-last-writer-wins. Scope to the fields BLE writes; the full Track-B sweep
   stays its own item.
2. **Daily derivations** (new `lib/health/ble-daily-rollup.ts`, pure + unit-tested,
   buckets by `measured_at` in the user's tz via `lib/date-utils`):
   - `hrv_ms` ← median of overnight `0x5d` rmssd samples (matches Cloud's "average HRV
     during best sleep" closely enough; document the semantic drift).
   - `resting_heart_rate` ← lowest smoothed sleep-window HR from `0x80/0x60` IBI (guarded
     by the existing 300–2000 ms band; 5-min rolling min like Oura's "lowest").
   - `spo2_pct` ← from `0x6f` direct % if the ring emits it (check overnight data first —
     BLE-16); otherwise leave NULL rather than shipping uncalibrated r/PI math. Ring-5
     coefficient derivation is explicitly out of scope.
   - temperature ← nightly median of sleep-temp events; store deviation only once a
     ≥14-night baseline exists (EMA per skill §9), else skip — no fabricated zeros.
   - **Sleep session row** ← contiguous sleep-phase events (`0x4b/0x4e/0x5a`) aggregated
     into one `sleep_sessions` row per night: bedtime start/end from first/last staged
     epoch, stage durations from 30 s nibble counts, efficiency = asleep/in-bed. Use a
     `oura_id`-style dedup key (`ble:<night-date>`) so re-rollups upsert.
   - Cache invalidation via the existing groups (`lib/cache-groups.ts`) for
     readiness/health-trends/sleep keys — same groups the Cloud sync invalidates.
3. **Undecoded-tag follow-ups feed this chunk:** sleep summaries (`0x48/0x49/0x4c/0x4f`),
   activity (`0x50/0x51/0x52`), sleep HR (`0x55`) — port decoders from the Rust source
   *when needed by a derivation*, each pinned to a captured vector, then **redecode**:
   a small admin route/script that re-runs `decodeEventBody` over stored `body_hex`
   (`decoded` is refreshable; `body_hex` never changes). This is the designed-for path —
   never a re-drain.
4. Tests: rollup unit tests on captured overnight fixtures; live verify against local
   Postgres by POSTing a captured night and checking `body_metrics`/`sleep_sessions` rows
   + a health screen rendering them.

**Verify:** after an overnight wear + drain, `/health` shows HRV/RHR/sleep from BLE data
with correct user-local dates; a re-drain doesn't duplicate rows.

## Chunk 4 — Cloud-sync cutover + freshness truth (BLE-4)

Only after Chunk 3 is verified on real overnight data:

1. Stop *scheduling* the Cloud sync when a BLE pipeline is active: gate
   `sync-provider.tsx`'s app-open Oura sync (and the screens' opportunistic calls) on
   "no BLE data in the last 48 h" — the Cloud path remains as manual fallback in More
   (it still serves a future non-BLE scenario), but stops pretending to be the freshness
   source.
2. Re-point the More-page "Last synced" indicator at the newest BLE `measured_at` when
   BLE is the active source, so staleness is honest (it currently shows the Cloud sync's
   success time, which is fresh-looking and permanently empty post-re-key).
3. `projectOverview.md` Known-Issues row for the frozen-health-screens gap gets struck in
   this PR (the mapping closes it); note the scores (readiness/sleep/activity 0–100)
   remain Cloud-era until the Phase-5 own-scores plan (separately planned, unqueued).

**Verify:** with BLE data present, app open fires no `/api/oura/sync`; indicator shows the
BLE measured-at age; with BLE data absent >48 h, Cloud sync scheduling resumes.
