# Data residency: where every table lives

Every table the app has, in all three stores, with who writes it, who reads it, whether it has a
tombstone, whether the export carries it and what account deletion does to it. Started from the
matrix in the 2026-08-02 native-convergence review (#2288, finding F4) and made enforceable by
#2489.

**The list is [`scripts/table-residency.json`](../scripts/table-residency.json), and CI holds it to
the code.** `scripts/check-table-residency.js` (Custom Rules) fails when a table the code creates has
no entry, when an entry names a table that no longer exists, and when the matrix at the bottom of
this page no longer matches the list and the code. The count went from 70 to 101 Postgres tables in
two months with nobody recording where each one lived; the check keeps that from happening again.

## Adding or removing a table

1. Decide its residency before writing the migration: server-only, a device mirror, or device-first
   with an outbox. The classes are below.
2. Add one line to `scripts/table-residency.json` under its store (`postgres`, `local` or
   `native`) with a `class` and a `note` naming its writer and reader. A local mirror also names the
   Postgres table it mirrors in `mirrors`. A removed table loses its line.
3. Run `node scripts/check-table-residency.js --write` and commit the regenerated matrix.

If the table has delete UI and a device copy, it needs a `deleted_at` tombstone: a server hard
delete never reaches a device that already pulled the row
([`docs/rules/offline-first-and-storage.md`](rules/offline-first-and-storage.md)).

## Classes

| class | what it means |
|---|---|
| DEVICE-FIRST | The device writes it to the local store and the outbox (`SYNCED_MUTATION_DOMAINS`, `packages/shared/src/sync/mutation-schema.ts`); `pushMutations` writes Postgres; `getSyncDelta` pulls it back to other devices. The device copy is the source of truth. |
| SERVER-FIRST MIRROR | The server writes it. The delta pull fills a local copy the device reads. Any outbox branch it has is noted per table. |
| HYDRATED MIRROR | A local table `getSyncDelta` does not carry, filled from API responses. The server is authoritative. |
| HYDRATED MIRROR + OUTBOX | As above, and the device also writes it through an outbox domain (`saved_meals` and its two child tables). |
| SERVER WRITE, DORMANT DEVICE TABLE | The server writes it. A local table of the same name exists, but nothing in the app writes or reads it yet. |
| OUTBOX WRITE, SERVER READ | The device writes through an outbox domain, with no local table; only the server reads it. |
| NATIVE DEVICE STORE + SERVER ARCHIVE | Written on the phone to the native `oura_raw.db`, uploaded to this server table. |
| SERVER-ONLY | No copy on the device. |

Local tables are `MIRROR` (of the Postgres table named in `mirrors`) or `DEVICE INFRA`. Native tables
are `NATIVE RAW STORE` (uploaded to a server archive) or `NATIVE DEVICE-ONLY`.

Two local tables carry different names from their Postgres table: `programs` is `local_programs` and
`progression_styles` is `local_progression_styles` on the device.

## Findings

Each of these was settled by reading the code on 2026-10-07, not by running the app on the phone.

**`rest_days` is a sanctioned outbox-write, server-read domain. No change needed.** The choice is
written through the outbox (`lib/home/rest-day.ts`, with a direct POST fallback on the web) and has no
local table. Its only readers are server-computed aggregates: `getNextSession` and `/api/collection`'s
paused days. Those are server-computed by design, the same standing as `weekly-stats` in the
offline-first rule's exception list. A `localStorage` marker echoes today's choice between the tap and
the next fetch, and while offline. Un-choosing a rest day sets `deleted_at`, so it propagates. Until
the outbox drains, a past day chosen offline will not show as paused in the collection. That clears
on the next push, and nothing is lost.

**There is no `oura_bucket` / `oura_heartrate` dual writer today.** The review read both tables as
having a device writer and a server writer. On `main` only the server writes them: the BLE rollup
(`lib/data/postgres/rollup-io.ts`, `slices/oura.ts`) and, for `oura_heartrate`, `/api/hr-ingest`.
The local tables and their store methods (`upsertOuraBucket`, `upsertOuraHeartrate`, and the two
getters in `lib/local-store/sqlite-backend.ts`) have no caller outside a test. The same is true one
level up: the `oura_daily_summary`, `oura_daily_derived` and `sleep_session` outbox domains have push
branches on the server and no device code that queues them. All five are waiting for the on-device
rollup (#2292). When that lands, these rows move class and the two writers need one owner per
table.

**The `oura_heartrate` rename (#2289) is a sequenced dependency, not part of this work.** It needs a
local SQLite migration, a Postgres migration and a `claude-ro-views.sql` regeneration, so it ships
alone in its own batch. When it lands, its line in `scripts/table-residency.json` changes name in
the same PR. The check will fail until it does.

**`food_items` has no delete path, so it needs no tombstone yet.** Nothing deletes a food item: no
API route, no repository method, no local-store write, no outbox branch. Only account deletion
removes them, by cascade, and that wipes the device too. Whoever adds a delete must add `deleted_at`
first.

**`sleep_sessions` had a server hard delete that devices never heard about. Fixed (#2546).**
Every rollup pass that wrote a night first deleted that day's BLE rows and reinserted them with new
random ids, so each re-roll left the device holding the old row next to the new one, and a night the
server dropped for good (#2486's short evening window) stayed on the device. Now the rollup upserts
first (a night at the same `sleep_start` keeps its id and is replaced, or revived if tombstoned; a
`ble:` id whose start drifted moves with it, `reseatBleSleepOuraIds`), then tombstones the BLE rows on
those dates that the pass did not reproduce (`tombstoneBleSleepNightsExcept`, both in
`lib/data/postgres/slices/oura.ts`). The delta pull carries `deleted_at`, and the device's
`applyDelta` and `getSleepSessions` already honour it (issue 2606 built that path for typed nights
the user removes). Rows hard-deleted before the fix are already gone from the server, so no
tombstone will ever reach a device still holding one, and Restore from cloud does not clear them
either: that clean-up is its own issue.

**`manual_bedtime` wrote the outbox but not the local row the card reads. Fixed (#2547).**
`components/health/sleep/manual-bedtime-card.tsx` reads `manual_sleep_start` from the local
`sleep_sessions` row and saved through the outbox only, so until the push and the next pull a
remount showed the old bedtime. The save now calls `setManualSleepStartLocally` first, which writes
that one column and marks the row `pending` so a pull cannot revert it; the push confirm
(`markManualBedtimeSynced`) flips it back unless a later bedtime for the night is still queued.

**The native `oura_raw.db` is not cleared by sign-out or account deletion.** Filed as #2548 (a
question for the owner). `signOutAndClearDevice` wipes every JS SQLite table, but `raw`,
`clock_anchors` and `sync_state` live in the native database, which nothing in that path touches.
`OuraRingService` uploads with whatever WebView cookie is current, so frames not yet uploaded when
one account signs out are uploaded to the next account that signs in.

**`oura_daily_summary` and `oura_daily_derived` have no tombstone and are keyed by day on the
device.** The server's full-history replace deletes and reinserts every row. On the device that is
an update in place, because the mirror's key is the day. A day the server stops producing
altogether would stay on the device, but nothing on the device reads these mirrors yet (above).

**Tables outside `schema.ts`.** `rate_limits` and `db_query_log` are created by `.sql` migrations and
`schema_migrations` by the runner in `lib/data/postgres/client.ts`. The check finds them by replaying
every migration's `CREATE TABLE` and `DROP TABLE` in filename order, so a new one is caught too.

## The matrix

Generated by `node scripts/check-table-residency.js --write` from `scripts/table-residency.json` and
the code. Do not edit between the markers; CI compares this block with a fresh render.

<!-- residency:generated:start -->
**111 Postgres tables** (108 `pgTable` in schema.ts + 3 created outside it), **42 JS SQLite tables**, **3 native tables**.

| class | Postgres tables |
|---|---|
| DEVICE-FIRST | 15 |
| SERVER-FIRST MIRROR | 15 |
| HYDRATED MIRROR | 3 |
| HYDRATED MIRROR + OUTBOX | 3 |
| SERVER WRITE, DORMANT DEVICE TABLE | 2 |
| OUTBOX WRITE, SERVER READ | 1 |
| NATIVE DEVICE STORE + SERVER ARCHIVE | 2 |
| SERVER-ONLY | 70 |

### Postgres

`tombstone` = has `deleted_at`. `export` = `lib/export/export-map.ts`. `account deletion` = what `DELETE /api/account` does to it (`cascade` = removed through the `users` foreign-key chain; otherwise its `OUTSIDE_THE_CASCADE` disposition).

| table | class | device copy | tombstone | export | account deletion | writer → reader |
|---|---|---|---|---|---|---|
| `activity_logs` | DEVICE-FIRST | `activity_logs` | yes | exported | cascade | local write + outbox push + delta pull |
| `activity_types` | SERVER-ONLY | — | — | excluded (catalogue) | not-user-data | reference catalog; writer: adapter.ts |
| `agent_action_log` | SERVER-ONLY | — | — | excluded (ops) | anonymised | ops: #2381 append-only audit log of maintenance jobs agents ran; nothing on the device reads it; read through claude_ro; writer: slices/agent-actions.ts |
| `ai_call_log` | SERVER-ONLY | — | — | excluded (ops) | anonymised | ops; writer: adapter.ts |
| `ai_health_insights` | SERVER-ONLY | — | — | exported | cascade | AI output; writer: adapter.ts |
| `app_load_metrics` | SERVER-ONLY | — | — | excluded (ops) | cascade | ops; writer: adapter.ts |
| `apple_health_samples` | SERVER-ONLY | — | yes | exported | cascade | sensor ingest -> server (Apple Health); writer: none found by static grep (raw SQL / script) |
| `applied_mutations` | SERVER-ONLY | — | — | excluded (ops) | cascade | sync idempotency ledger (server half of the outbox); writer: adapter.ts |
| `blood_analytes` | SERVER-ONLY | — | — | exported | cascade | user data, no local mirror (labs); writer: adapter.ts |
| `blood_panels` | SERVER-ONLY | — | yes | exported | cascade | user data, no local mirror (labs); writer: adapter.ts |
| `body_battery_daily` | SERVER-ONLY | — | — | exported | cascade | derived (server model); writer: body-battery.ts |
| `body_metrics` | DEVICE-FIRST | `body_metrics` | yes | exported | cascade | local write + outbox push + delta pull |
| `coach_changes` | SERVER-ONLY | — | — | exported | cascade | AI coach; writer: apply.ts |
| `coach_messages` | SERVER-ONLY | — | — | exported | cascade | AI coach; writer: threads.ts |
| `coach_threads` | SERVER-ONLY | — | — | exported | cascade | AI coach; writer: threads.ts |
| `colmi_raw_frames` | SERVER-ONLY | — | — | exported | cascade | sensor ingest -> server (Colmi); writer: colmi.ts |
| `colmi_readings` | SERVER-ONLY | — | — | exported | cascade | sensor ingest -> server (Colmi); writer: colmi.ts |
| `colmi_sleep_segments` | SERVER-ONLY | — | — | exported | cascade | sensor ingest -> server (Colmi); writer: colmi.ts |
| `daily_zone_minutes` | SERVER-ONLY | — | — | exported | cascade | derived (server rollup); writer: oura.ts |
| `day_checkins` | DEVICE-FIRST | `day_checkins` | yes | exported | cascade | local write + outbox push + delta pull |
| `db_query_log` | SERVER-ONLY | — | — | excluded (ops) | purged | ops: claude_ro audit log; created by a .sql migration, not schema.ts |
| `detection_events` | SERVER-ONLY | — | — | exported | cascade | ops telemetry: walk auto-detection funnel (#2478); read through claude_ro only; writer: adapter.ts |
| `dexa_scan_regions` | SERVER-ONLY | — | — | exported | cascade | user data, no local mirror; writer: adapter.ts |
| `dexa_scans` | SERVER-ONLY | — | — | exported | cascade | user data, no local mirror; writer: adapter.ts |
| `dietary_restrictions` | SERVER-ONLY | — | — | excluded (catalogue) | not-user-data | reference catalog; writer: none found by static grep (raw SQL / script) |
| `email_normalisation_preimage` | SERVER-ONLY | — | — | excluded (third-party) | purged | auth migration ledger; writer: none found by static grep (raw SQL / script) |
| `error_events` | SERVER-ONLY | — | — | excluded (ops) | anonymised | ops (30-day prune); writer: adapter.ts, oura.ts |
| `exercise_estimates` | SERVER-ONLY | — | — | exported | cascade | derived (1RM etc.); writer: adapter.ts |
| `exercise_gif_cache` | SERVER-ONLY | — | — | excluded (catalogue) | not-user-data | reference cache; writer: route.ts, route.ts, adapter.ts |
| `exercise_library` | HYDRATED MIRROR | `exercise_library` | — | excluded (catalogue) | anonymised | local table exists, NOT in getSyncDelta; filled from API fetches; server authoritative |
| `exercise_logs` | DEVICE-FIRST | `exercise_logs` | yes | exported | cascade | local write + outbox push + delta pull |
| `exercise_media` | SERVER-ONLY | — | — | excluded (catalogue) | not-user-data | reference catalog (media); writer: route.ts, route.ts, route.ts |
| `feedback_submissions` | SERVER-ONLY | — | — | excluded (ops) | cascade | ops / owner inbox; writer: adapter.ts |
| `fitness_tests` | DEVICE-FIRST | `fitness_tests` | yes | exported | cascade | local write + outbox push + delta pull |
| `food_items` | DEVICE-FIRST | `food_items` | — | exported | cascade | local write + outbox push + delta pull. No delete path exists anywhere (server, device or API), so no tombstone is needed until one is added |
| `food_logs` | DEVICE-FIRST | `food_logs` | yes | exported | cascade | local write + outbox push + delta pull |
| `friendships` | SERVER-ONLY | — | — | excluded (third-party) | cascade | social; writer: social.ts |
| `goal_recommendations` | SERVER-ONLY | — | — | exported | cascade | derived / AI; writer: adapter.ts |
| `health_connect_history_import` | SERVER-ONLY | — | — | excluded (ops) | cascade | explicit Import more history progress (oldest imported day); writer: slices/health-connect-history-import.ts |
| `health_connect_intervals` | SERVER-ONLY | — | — | exported | cascade | sensor ingest -> server (Health Connect, which is itself the device copy); writer: slices/health-connect-intervals.ts |
| `injuries` | DEVICE-FIRST | `injuries` | yes | exported | cascade | local write + outbox push + delta pull |
| `invited_emails` | SERVER-ONLY | — | — | excluded (third-party) | purged | auth / access list; writer: adapter.ts |
| `meal_plan_meals` | SERVER-FIRST MIRROR | `meal_plan_meals` | — | exported | cascade | server writes (API); delta pull fills a read-only local mirror; no outbox domain |
| `meal_plan_variants` | SERVER-FIRST MIRROR | `meal_plan_variants` | — | exported | cascade | server writes (API); delta pull fills a read-only local mirror; no outbox domain |
| `meal_plans` | SERVER-FIRST MIRROR | `meal_plans` | yes | exported | cascade | server writes (API); delta pull fills a read-only local mirror; no outbox domain |
| `meal_types` | HYDRATED MIRROR | `meal_types` | yes | exported | cascade | local table exists, NOT in getSyncDelta; filled from API fetches; server authoritative |
| `measured_rmr` | SERVER-ONLY | — | — | exported | cascade | user data, no local mirror; writer: adapter.ts |
| `mood_logs` | DEVICE-FIRST | `mood_logs` | yes | exported | cascade | local write + outbox push + delta pull |
| `native_refresh_tokens` | SERVER-ONLY | — | — | excluded (credentials) | cascade | credential material (#2076 native app refresh tokens, SHA-256 hashes only); nothing on the device reads it; token_hash withheld from claude_ro; writer: slices/native-refresh-tokens.ts |
| `nutrition_targets` | SERVER-ONLY | — | — | exported | cascade | user data, no local mirror; writer: goals.ts, nutrition.ts |
| `oura_accel_chunks` | SERVER-ONLY | — | — | excluded (raw-frames) | cascade | sensor ingest -> server; writer: adapter.ts |
| `oura_ble_battery_poll` | SERVER-ONLY | — | — | excluded (ops) | cascade | sensor ingest -> server; writer: adapter.ts |
| `oura_ble_clock_anchors` | NATIVE DEVICE STORE + SERVER ARCHIVE | native `clock_anchors` | — | excluded (ops) | cascade | native oura_raw.db (raw / clock_anchors) uploads to the server archive; 14-day device window not shipped |
| `oura_ble_link_stats` | SERVER-ONLY | — | — | excluded (ops) | cascade | ops telemetry: OuraRingService link counters (#2469); read through claude_ro only; writer: adapter.ts |
| `oura_ble_rekey_declarations` | SERVER-ONLY | — | — | excluded (ops) | cascade | server record of re-key; writer: oura.ts |
| `oura_bucket` | SERVER WRITE, DORMANT DEVICE TABLE | `oura_bucket` | — | excluded (ops) | cascade | server BLE rollup writes (rollup-io.ts, slices/oura.ts); the local table and its store methods exist but nothing in the app calls them — no device writer or reader today; the device rollup that would produce it is #2292 |
| `oura_daily` | SERVER-FIRST MIRROR | `oura_daily` | — | exported | cascade | written by the (dead) Oura Cloud path only; delta pull; frozen |
| `oura_daily_derived` | SERVER-FIRST MIRROR | `oura_daily_derived` | — | exported | cascade | server rollup and readiness writes; delta pull fills the local copy, which nothing on the device reads yet. The outbox push branch exists with no device producer — the device rollup that would produce it is #2292; ten columns have no producer (#2296) |
| `oura_daily_summary` | SERVER-FIRST MIRROR | `oura_daily_summary` | — | exported | cascade | server rollup writes; delta pull fills the local copy, which nothing on the device reads yet. The outbox push branch exists with no device producer — the device rollup that would produce it is #2292 |
| `oura_daytime_hrv_model` | SERVER-ONLY | — | — | exported | cascade | derived (server model); writer: oura.ts |
| `oura_daytime_stress_buckets` | SERVER-ONLY | — | — | exported | cascade | derived (server model); writer: oura.ts |
| `oura_heartrate` | SERVER WRITE, DORMANT DEVICE TABLE | `oura_heartrate` | — | exported | cascade | server BLE rollup and /api/hr-ingest write; the local table and its store methods exist but nothing in the app calls them; the device rollup that would produce it is #2292. Rename to a vendor-neutral name is #2289 (own batch, local + Postgres migration) |
| `oura_raw_packed` | SERVER-ONLY | — | — | excluded (raw-frames) | cascade | server-side lossless archive of oura_raw_samples (Q-541 packer); no device equivalent; writer: oura-raw-pack.ts |
| `oura_raw_samples` | NATIVE DEVICE STORE + SERVER ARCHIVE | native `raw` | — | excluded (raw-frames) | cascade | native oura_raw.db (raw / clock_anchors) uploads to the server archive; 14-day device window not shipped |
| `oura_redecode_jobs` | SERVER-ONLY | — | — | excluded (ops) | cascade | server job queue; writer: oura.ts |
| `oura_rollup_state` | SERVER-ONLY | — | — | excluded (ops) | cascade | server rollup cursor; writer: oura.ts |
| `oura_tags` | SERVER-ONLY | — | — | exported | cascade | sensor ingest -> server; writer: none found by static grep (raw SQL / script) |
| `oura_tokens` | SERVER-ONLY | — | — | excluded (credentials) | cascade | integration secret (Oura Cloud: gone for good); writer: none found by static grep (raw SQL / script) |
| `oura_workouts` | SERVER-ONLY | — | — | exported | cascade | sensor ingest -> server; writer: oura.ts |
| `personal_records` | SERVER-FIRST MIRROR | `personal_records` | — | exported | cascade | server derives on workout completion; delta pull; no outbox domain |
| `phase_sets` | SERVER-ONLY | — | — | exported | cascade | program structure (not mirrored); writer: adapter.ts, programs.ts |
| `plan_meal_answers` | DEVICE-FIRST | `plan_meal_answers` | yes | exported | cascade | local write + outbox push + delta pull |
| `prescribed_runs` | DEVICE-FIRST | `prescribed_runs` | yes | exported | cascade | local write + outbox push + delta pull |
| `prescription_shadow` | SERVER-ONLY | — | — | excluded (ops) | cascade | derived / shadow run; writer: adapter.ts |
| `program_phases` | SERVER-ONLY | — | — | exported | cascade | program structure (not mirrored); writer: adapter.ts, programs.ts |
| `program_sessions` | SERVER-FIRST MIRROR | `program_sessions` | yes | exported | cascade | server writes (API); delta pull fills a read-only local mirror; no outbox domain |
| `program_volume_targets` | SERVER-ONLY | — | — | exported | cascade | program structure (not mirrored); writer: periodization.ts |
| `programs` | SERVER-FIRST MIRROR | `local_programs` | — | exported | cascade | server writes (API); delta pull fills a read-only local mirror; no outbox domain |
| `progression_styles` | SERVER-FIRST MIRROR | `local_progression_styles` | — | exported | cascade | server writes (API); delta pull fills a read-only local mirror; no outbox domain |
| `rate_limits` | SERVER-ONLY | — | — | excluded (ops) | purged | ops: rate-limiter keys; created by a .sql migration, not schema.ts; two-day prune |
| `readiness_verdicts` | SERVER-ONLY | — | — | exported | cascade | derived (model verdict); writer: adapter.ts |
| `rest_days` | OUTBOX WRITE, SERVER READ | — | yes | exported | cascade | outbox write (lib/home/rest-day.ts, direct POST fallback on the web); read only by server-computed aggregates (getNextSession, /api/collection); a localStorage marker echoes today’s choice. Un-choosing sets deleted_at |
| `rr_intervals` | SERVER-ONLY | — | — | exported | cascade | sensor ingest -> server; writer: oura.ts |
| `running_plans` | SERVER-ONLY | — | — | exported | cascade | running plan (server-built; only prescribed_runs mirrored); writer: adapter.ts |
| `saved_meal_items` | HYDRATED MIRROR + OUTBOX | `saved_meal_items` | — | exported | cascade | local table, outbox domain 'saved_meals', NOT in getSyncDelta (hydrated from API) |
| `saved_meal_meal_types` | HYDRATED MIRROR + OUTBOX | `saved_meal_meal_types` | — | exported | cascade | local table, outbox domain 'saved_meals', NOT in getSyncDelta (hydrated from API) |
| `saved_meals` | HYDRATED MIRROR + OUTBOX | `saved_meals` | — | exported | cascade | local table, outbox domain 'saved_meals', NOT in getSyncDelta (hydrated from API) |
| `scale_raw_samples` | SERVER-ONLY | — | — | exported | cascade | sensor ingest -> server (scale); writer: adapter.ts |
| `schedule_days` | SERVER-FIRST MIRROR | `schedule_days` | — | exported | cascade | server writes (API); delta pull fills a read-only local mirror; no outbox domain |
| `schedules` | SERVER-FIRST MIRROR | `schedules` | — | exported | cascade | server writes (API); delta pull fills a read-only local mirror; no outbox domain |
| `schema_migrations` | SERVER-ONLY | — | — | excluded (ops) | not-user-data | migration ledger; created by the runner in lib/data/postgres/client.ts |
| `season_results` | SERVER-ONLY | — | — | exported | cascade | social / collection; writer: none found by static grep (raw SQL / script) |
| `seasons` | SERVER-ONLY | — | — | excluded (catalogue) | not-user-data | reference (collection); writer: none found by static grep (raw SQL / script) |
| `session_exercises` | SERVER-FIRST MIRROR | `session_exercises` | yes | exported | cascade | server writes (API); delta pull fills a read-only local mirror; no outbox domain |
| `session_periodization` | SERVER-ONLY | — | — | exported | cascade | program structure (not mirrored); writer: periodization.ts, programs.ts |
| `set_hr_stats` | SERVER-ONLY | — | — | exported | cascade | derived (server rollup); writer: oura.ts |
| `set_logs` | DEVICE-FIRST | `set_logs` | yes | exported | cascade | local write + outbox push + delta pull |
| `shadow_readiness` | SERVER-ONLY | — | — | exported | cascade | derived (#2377 shadow readiness model, shown nowhere); nothing on the device reads it; read through claude_ro; writer: slices/shadow-readiness.ts |
| `sleep_sessions` | SERVER-FIRST MIRROR | `sleep_sessions` | yes | exported | cascade | server writes (BLE rollup deletes and reinserts a re-rolled night; Health Connect sync); delta pull fills the mirror, read local-first for first paint. The sleep_session push branch has no device producer (#2292); manual_bedtime edits one column through the outbox; manual_sleep (#2338) is a user-entered night (manual_entry=true) written locally + pushed, losing to any device night on read; removing one (issue 2606) is a deleted_at tombstone the delta pull carries, and every read skips it. The BLE re-roll is still a server hard delete of ble rows, no tombstone: see Findings |
| `sleep_verdicts` | SERVER-ONLY | — | — | exported | cascade | derived (model verdict); writer: adapter.ts |
| `step_live_windows` | SERVER-ONLY | — | — | exported | cascade | sensor ingest -> server; writer: adapter.ts |
| `strap_status` | SERVER-ONLY | — | — | excluded (ops) | cascade | sensor ingest -> server; writer: adapter.ts |
| `style_sets` | SERVER-FIRST MIRROR | `style_sets` | — | exported | cascade | server writes (API); delta pull fills a read-only local mirror; no outbox domain |
| `supplement_logs` | DEVICE-FIRST | `supplement_logs` | yes | exported | cascade | local write + outbox push + delta pull |
| `supplement_vials` | HYDRATED MIRROR | `supplement_vials` | yes | exported | cascade | local table exists, NOT in getSyncDelta; filled from API fetches; server authoritative |
| `supplements` | DEVICE-FIRST | `supplements` | yes | exported | cascade | local write + outbox push + delta pull |
| `user_dietary_restrictions` | SERVER-ONLY | — | — | exported | cascade | user data, no local mirror; writer: meal-plans.ts |
| `user_stats` | SERVER-ONLY | — | — | exported | cascade | derived aggregate; writer: none found by static grep (raw SQL / script) |
| `users` | SERVER-ONLY | — | — | exported | cascade | auth / account; writer: more-content.tsx, goals.ts, adapter.ts, social.ts |
| `workout_hr_stats` | SERVER-ONLY | — | — | exported | cascade | derived (server rollup); writer: oura.ts |
| `workout_sessions` | DEVICE-FIRST | `workout_sessions` | yes | exported | cascade | local write + outbox push + delta pull |

### JS SQLite, device-only tables

The other local tables are the mirrors named in the "device copy" column above. Every local table is wiped by sign-out and account deletion (`signOutAndClearDevice` walks `sqlite_master`).

| table | class | what it is |
|---|---|---|
| `api_cache` | DEVICE INFRA | device response cache (lib/sqlite/cache.ts) |
| `mutations_outbox` | DEVICE INFRA | the outbox pushMutations drains |
| `sync_meta` | DEVICE INFRA | sync cursors and flags |
| `sync_outbox` | DEVICE INFRA | created at v1; nothing in the app reads or writes it |

### Native

| table | class | source | server archive | what it is |
|---|---|---|---|---|
| `clock_anchors` | NATIVE RAW STORE | `android/app/src/main/java/com/trainingai/app/oura/OuraRawDb.kt` | `oura_ble_clock_anchors` | oura_raw.db: ring clock anchors, uploaded to the server archive |
| `raw` | NATIVE RAW STORE | `android/app/src/main/java/com/trainingai/app/oura/OuraRawDb.kt` | `oura_raw_samples` | oura_raw.db: ring frames, uploaded to the server archive, pruned once rolled up and synced |
| `sync_state` | NATIVE DEVICE-ONLY | `android/app/src/main/java/com/trainingai/app/oura/OuraRawDb.kt` | — | oura_raw.db: the history cursor (advances only past server-acknowledged events) |
<!-- residency:generated:end -->
