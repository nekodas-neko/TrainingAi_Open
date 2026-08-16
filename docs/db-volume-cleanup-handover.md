# Handover — Postgres volume investigation (solo-user DB approaching 1 GB)

**Status:** 2026-07-21. Immediate space crisis DE-ESCALATED (924 MB/92% → dropping through ~770 MB
after an owner-run REINDEX). **Root structural problem NOT solved** — `oura_raw_samples` (raw BLE
archival) grows unbounded (~50 MB/week of protected `body_hex`) and is 91% of the database. This doc
captures everything measured so the next session designs the long-term fix without re-gathering.

**Why this is a real problem, not a one-off:** a single-user app should not trend toward 1 GB. At the
current archival rate the volume refills in ~3-4 months even after cleanup. The fix is architectural
(store less / store smaller / tier to object storage), and needs an owner design decision.

---

## 1. The alarm

- Railway **postgres-volume at 92% of 1 GB (924.49 MB)** — "High Volume Usage", prompting an
  "Upgrade to 1000 GB" nag. CPU flat ~0, memory ~800 MB, network ~0 — so it is **purely a disk/volume
  problem**, not load.
- Owner (correctly) flagged this as absurd for one user and wants the root cause + a durable fix.

---

## 2. What was measured (all query outputs captured — do not re-run to re-learn)

**Sandbox cannot reach prod Postgres** (only 80/443 open to Railway). All numbers below came from the
owner running SQL in the Railway console. To re-measure later, the exact queries are in §7.

### Whole-DB / volume accounting
| Component | Value |
|---|---|
| `pg_database_size('railway')` | **320 MB** before REINDEX → **205 MB** after |
| Other DBs (`template0/1`, `postgres`) | ~7.5 MB each (standard, ignore) |
| WAL (`pg_ls_waldir`) | **208 MB** (13 × 16 MB segments); Railway Stats later showed **176 MB** |
| Replication slots (`pg_replication_slots`) | **none** (empty — ruled out a stuck slot) |
| Volume (physical) | 924 MB, dropping to ~770 MB post-REINDEX |

### Biggest tables (`pg_total_relation_size`, pre-REINDEX)
| Table | Total | Heap | Indexes | TOAST | Est rows |
|---|---|---|---|---|---|
| **oura_raw_samples** | **291 MB** | 98 MB | **192 MB** | 8 KB | **432,919** |
| oura_heartrate | 8.6 MB | 2.7 MB | 5.9 MB | — | 22,440 (180-day prune ✓) |
| rr_intervals | 2.7 MB | 1.1 MB | 1.6 MB | — | 12,055 (90-day prune ✓) |
| oura_accel_chunks | 840 KB | — | 48 KB | 784 KB | (7-day prune ✓) |
| everything else | < 1 MB each | | | | |

### `oura_raw_samples` indexes (pre-REINDEX) — the bloat
| Index | Size | Healthy est | Bloat |
|---|---|---|---|
| `idx_oura_raw_samples_user_measured` (user_id, measured_at) | **71 MB** | ~17 MB | **4.7×** |
| `oura_raw_samples_user_id_ring_timestamp_ds_tag_body_hex_key` UNIQUE(user_id, ring_ds, tag, body_hex) | 61 MB | ~30 MB | ~2× |
| `oura_raw_samples_user_tag_ts` (user_id, tag, ring_ds) | 39 MB | ~17 MB | ~2.3× |
| `oura_raw_samples_pkey` (id) | 22 MB | ~9 MB | ~2.4× |

### `oura_raw_samples.body_hex` bytes by event tag (query #3)
| tag (dec) | tag hex | rows | body_hex bytes |
|---|---|---|---|
| 139 | 0x8b (SpO₂ r/PI) | 103,715 | 2,633 kB |
| 96 | 0x60 (IBI) | 81,332 | 2,224 kB |
| 97 | 0x61 (debug_data*) | 49,415 | 1,093 kB |
| 128 | 0x80 (IBI) | 38,798 | 1,039 kB |
| 67 | 0x43 (debug_event*) | 32,537 | 714 kB |
| 126/127 | 0x7e/0x7f (steps) | 17,731 each | 485 kB each |
| 114 | 0x72 (motion) | 14,975 | 351 kB |
| 115 | 0x73 | 14,049 | 261 kB |
| 71 | 0x47 | 24,566 | … |

\* `0x43`/`0x61` are in `RAW_STORAGE_DROP_TAGS` but present — almost certainly **pre-drop-rule
historical rows** (the ingest filter `shouldDropRawEvent` IS applied now, `app/api/oura-ble/samples/route.ts:61`).
Small (~1.8 MB) — low priority, but a one-off purge of dropped-tag rows is a trivial win.

### Vacuum / index health (Railway Stats panel, post-REINDEX)
- Database **204.8 MB** = Tables 106.6 MB + Indexes **87.5 MB** (down from 192!) + System 10.6 MB.
- Dead rows: 19.7 K total; **Tables w/ Bloat: 0**. `oura_raw_samples` 18.9 K dead (4.3%), vacuumed 4h ago.
- **17 of 20 tables "need vacuum"** — small stale-autovacuum tables (`style_sets` 32% dead,
  `program_phases` 27%). Negligible space; per-table Vacuum buttons fix it.
- **20 unused indexes (448 KB total)** flagged as removal candidates (`style_sets_pkey`,
  `oura_ble_battery_poll_user_time_idx`, `idx_bm_user_date`, … "Show all 20"). Hygiene, not space.
- **Perf flag (not space):** `oura_raw_samples` — **15.2 K sequential scans averaging 98 K rows each**,
  1.8 M idx scans. "May need index." Some query full-scans the biggest table repeatedly. CPU is idle
  so not urgent, but it's a real inefficiency worth tracing (candidate for its own index).

---

## 3. Root-cause findings

1. **The 92% alarm was ~55% index bloat + WAL, not runaway data.** The `idx_oura_raw_samples_user_measured`
   index was 4.7× oversized. Cause: **migration 115** added `measured_at` (all NULL) then a mass
   `UPDATE` backfilled all 432 K rows → 432 K dead index tuples. Regular autovacuum removed the dead
   *heap* rows (dead % back to 4.3%) but **VACUUM never shrinks index files — only REINDEX does.** So
   the index files stayed inflated.
2. **`REINDEX` reclaimed ~105 MB** (owner ran it: indexes 192 MB → 87.5 MB, DB 320 → 205 MB). Railway
   now reports **0 bloated tables**.
3. **WAL (176-208 MB) is the rest of the gap**, inflated further by the REINDEX's own WAL burst.
   `max_wal_size=256`, `min_wal_size=64`, `wal_keep_size=0`, no replication slots. WAL won't shrink
   below `max_wal_size` worth of recyclable segments without a config change + CHECKPOINT + restart.
4. **The genuine unbounded grower is `oura_raw_samples` heap: ~98 MB for ~2 weeks of direct-BLE
   ingestion (started 2026-07-07) ≈ ~50 MB/week.** This is the protected `body_hex` archival — it is
   NOT bloat, it is real data, and it grows forever at ~50 MB/week. **This is the structural problem.**

---

## 4. Actions already taken / recommended this session

**Done (owner-run in Railway console):**
- ✅ `REINDEX INDEX CONCURRENTLY` on all four `oura_raw_samples` indexes → ~105 MB reclaimed.

**✅ The reindex was re-run 2026-08-04 after the `_ccnew` cleanup (see §7b) — measured result:**

| index | before | after |
|---|---|---|
| `idx_oura_raw_samples_user_measured` | 110 MB | **31 MB** |
| `oura_raw_samples_user_id_ring_timestamp_ds_tag_body_hex_key` | 102 MB | **55 MB** |
| `oura_raw_samples_user_tag_ts` | 71 MB | **37 MB** |
| `oura_raw_samples_pkey` | 34 MB | **17 MB** |
| **total indexes** | **316 MB** | **140 MB** |

**176 MB reclaimed**, plus the 42 MB of invalid `_ccnew` leftovers dropped. `oura_raw_samples` total
462 MB → 286 MB; whole database now **363 MB**. Zero invalid indexes remain.

**Remaining lever — WAL. Re-measure before changing anything.**

The earlier advice was "set `max_wal_size = 128MB`, checkpoint, restart". **Do the restart first and
only change the config if it is still tight**, for two reasons:

1. **The volume figure lags the cleanup.** REINDEX CONCURRENTLY removes the old index files
   immediately, but a volume reading taken before the reindex (or before a restart clears temp and
   the high-water mark) still shows the old number. Re-read it after a restart before concluding
   anything.
2. **Lowering `max_wal_size` is not free.** It forces more frequent checkpoints, which costs write
   I/O — and this database is taking 255-frame BLE ingest batches that are already timing out
   intermittently. Do not trade ingest headroom for disk that a restart may have freed anyway.

Current settings (read 2026-08-04): `max_wal_size = 256MB`, `min_wal_size = 64MB`,
`wal_keep_size = 0`, `max_slot_wal_keep_size = -1`, no replication slots — so nothing is pinning WAL
open. A restart should recycle it down toward `min_wal_size` on its own.

**✅ Done 2026-08-04. Postgres restarted (`pg_postmaster_start_time` = 02:03:58 UTC), volume went
from ~890 MB to ~680 MB of 1.00 GB — 68%, down from the 92% that started this whole exercise.
`max_wal_size` was left at 256 MB: at 68% there is no case for trading checkpoint I/O for disk.**

**But the runway is ~5 weeks, not solved.** `oura_raw_samples` takes **~24,700 rows/day** steadily
(24,379 / 26,691 / 24,486 / 26,738 over the last four full days) at ~363 bytes/row including
indexes — about **9 MB/day**. Against ~320 MB of headroom that is **~35 days** before this is back
where it started. Deploy logs also show `pgbackrest: volume 878 MiB … queue-max=439 MiB`, so WAL and
backup retention are competing for the same volume.

**The reindex bought time; it did not change the trend.** The structural fix is backlog **Q-30**
(raw-sample retention and the raw-drop-vs-bytea decision). Re-check the volume in ~3 weeks, or when
Railway alarms — whichever is first.

Two things in the restart logs that look alarming and are not:
- `database system was not properly shut down; automatic recovery in progress` (×2) — Railway
  restarts kill the container rather than shutting down gracefully. This is exactly the scenario
  `statement_timeout` / `idle_in_transaction_session_timeout` in `lib/data/postgres/client.ts` exist
  to bound; recovery completed in under a second both times.
- `collation-refresh: psql: error: … Permission denied` (×2) — a Railway image quirk on start,
  unrelated to the database's own state.

<details>
<summary>The procedure that was run</summary>

**Order:**
1. In `railway connect Postgres`: `CHECKPOINT;` (run it twice).
2. **Restart the Postgres service** — Railway → Postgres service → Deployments → restart. Brief
   downtime (~15-30 s); the pg Pool's error handler and retries cover it.
3. **Re-read the volume figure.** If it is now comfortable, stop — you are done.
4. Only if still tight: `ALTER SYSTEM SET max_wal_size = '128MB'; SELECT pg_reload_conf();`
   (needs superuser, which Railway's `postgres` role has), then `CHECKPOINT;` and restart again.
   **Not needed on 2026-08-04 — step 3 landed at 68%.**

</details>

**Nothing was shipped as code this session** — every lever above is a DBA console op, not an app
change. (An admin `/api/admin/db-sizes` readout was drafted then discarded since the owner preferred
pasting queries; trivial to rebuild — see §7 for its query.)

---

## 5. THE REAL TASK — long-term structural fix (needs an owner design decision)

Even at ~300 MB post-cleanup, `oura_raw_samples` refills the 1 GB volume in ~3-4 months at ~50 MB/wk.
The 12-month `body_hex` cold-storage idea (P-A Lever 5) is **too loose** — 12 months × 50 MB/wk ≈
2.5 GB before anything ages out. Options, roughly best-first:

- **(a) Store `body_hex` as `bytea`, not hex `TEXT` — instant ~50% heap cut.** Hex text is 2× the raw
  bytes. `body_hex` "0af3…" as TEXT is 2 bytes/byte; `bytea` is 1. 98 MB heap → ~49 MB, and every
  future week halves too. **Biggest structural win, pure schema+decoder change**, keeps full re-decode.
  Requires: column type migration + backfill (decode hex→bytea), and updating the ingest + every
  decoder/reader that reads `body_hex` (they currently expect hex string). Non-trivial but bounded.
  **Recommended first move.**
- **(b) Tiered retention by tag / cold-storage to S3.** The `.pt` models already live in an S3 bucket
  (see the Oura false-blocker handover). Same pattern: export `body_hex` older than N *weeks* (not
  months) to object storage, prune from PG, keep re-importable for re-decode. Proper architecture for
  "archival that must be retained but is rarely read." Needs: an export job + a re-import path + a
  prune. `body_hex` "never hard delete" is satisfied (it moves to S3, not deleted).
- **(c) Don't archive every tag forever.** The rollup + decoders already extract what the app uses.
  High-frequency tags (0x8b SpO₂, 0x60/0x80 IBI) dominate. If decoders are trusted (they're
  golden-pinned), keep a short raw window for the high-frequency tags and longer for rare ones.
  Riskier — weakens the "re-decode from archival" guarantee — but the biggest volume lever.
- **(d) Compression.** Ensure `body_hex`/`decoded` columns use PG's `EXTENDED`/`MAIN` storage with LZ
  compression (currently TOAST is near-zero, meaning values are short and inline-uncompressed).
  Marginal vs (a).

**Hard constraints (CLAUDE.md):**
- `oura_raw_samples.body_hex` is the archival source of truth — **never hard-delete**; compress/move
  is fine. (a)/(b)/(d) comply; (c) needs an explicit owner sign-off as it drops re-decode coverage.
- `rr_intervals` retention is gated on the `workout_hr_stats` backfill running first.
- Postgres data migrations must be idempotent; claim the next migration number against the dir AND
  open PRs (current highest on disk was 135; **verify at pickup — main has since advanced**).

---

## 6. Suggested next-session plan

1. **Confirm the immediate cleanup landed** — re-run §7 size queries; expect ~300 MB / ~30%.
2. **Decide the structural strategy** with the owner — recommend **(a) bytea migration** as the first
   ship (halves heap + all future growth, keeps re-decode, no data loss), then evaluate **(b) S3
   cold-storage** for the longer tail.
3. **Scope (a):** migration to `ALTER COLUMN body_hex TYPE bytea USING decode(body_hex,'hex')` (test
   on the local seed first), then update `insertOuraRawSamples`, the decoders in `lib/oura-ble/`, and
   every reader of `body_hex` to work in bytes. This is the load-bearing change — do it carefully with
   the golden test vectors (`lib/oura-models/goldens/`, the `oura-native-ble` skill).
4. **Cheap wins alongside:** purge historical dropped-tag rows (0x43/0x61 pre-filter); drop the 20
   unused indexes; VACUUM the 17 stale small tables.
5. **Separate follow-up:** trace the `oura_raw_samples` 15.2 K-seq-scan query and add the missing index
   (perf, not space).

---

## 7. Exact diagnostic queries (re-run in Railway console to re-measure)

```sql
-- Table sizes (heap + indexes + TOAST), biggest first
SELECT relname AS table,
  pg_size_pretty(pg_total_relation_size(c.oid)) AS total,
  pg_size_pretty(pg_relation_size(c.oid))       AS heap,
  pg_size_pretty(pg_indexes_size(c.oid))        AS indexes,
  pg_size_pretty(COALESCE(pg_total_relation_size(reltoastrelid),0)) AS toast,
  reltuples::bigint AS est_rows
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind='r'
ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 25;

-- Whole DB + all databases on the instance
SELECT datname, pg_size_pretty(pg_database_size(oid)) FROM pg_database ORDER BY pg_database_size(oid) DESC;

-- Per-index sizes on the big table
SELECT indexrelname, pg_size_pretty(pg_relation_size(indexrelid)) AS size
FROM pg_stat_user_indexes WHERE relname='oura_raw_samples' ORDER BY pg_relation_size(indexrelid) DESC;

-- body_hex bytes by tag
SELECT tag, to_hex(tag::int) AS tag_hex, count(*) AS rows,
  pg_size_pretty(sum(octet_length(body_hex))::bigint) AS body_hex_bytes
FROM oura_raw_samples GROUP BY tag ORDER BY sum(octet_length(body_hex)) DESC;

-- WAL + slots + config
SELECT pg_size_pretty(sum(size)) AS wal_total, count(*) FROM pg_ls_waldir();
SELECT slot_name, active, pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) FROM pg_replication_slots;
SELECT name, setting FROM pg_settings WHERE name IN ('wal_keep_size','max_wal_size','min_wal_size','max_slot_wal_keep_size');

-- Dead tuples
SELECT relname, n_live_tup, n_dead_tup, pg_size_pretty(pg_total_relation_size(relid)) AS size
FROM pg_stat_user_tables ORDER BY n_dead_tup DESC LIMIT 10;

-- REINDEX (owner already ran these; re-run if bloat returns) — CONCURRENTLY, one at a time, has headroom
REINDEX INDEX CONCURRENTLY idx_oura_raw_samples_user_measured;
REINDEX INDEX CONCURRENTLY oura_raw_samples_user_id_ring_timestamp_ds_tag_body_hex_key;
REINDEX INDEX CONCURRENTLY oura_raw_samples_user_tag_ts;
REINDEX INDEX CONCURRENTLY oura_raw_samples_pkey;
```

---

## 7b. Two failures the owner hit on 2026-08-04, and what to do instead

**Both are traps in the instructions above, not mistakes by the operator.**

### `VACUUM cannot run inside a transaction block`

Railway's web SQL console wraps whatever you paste in a transaction, and `VACUUM` (and
`REINDEX … CONCURRENTLY`, and `CREATE INDEX CONCURRENTLY`) cannot run inside one. **The console
cannot run these at all.** Use a real psql session instead:

```bash
railway connect Postgres        # opens psql against the service
```

and run the statement there — psql sends each one in its own implicit transaction, which is what
these commands need. `railway run psql $DATABASE_URL -c "VACUUM …"` works too.

### `REINDEX TABLE CONCURRENTLY` → not enough space, **and it leaves debris**

`REINDEX … CONCURRENTLY` builds a full second copy of every index before swapping. On
`oura_raw_samples` that is **316 MB of indexes wanting another 316 MB of free space at once** —
`REINDEX TABLE` does all four together, so it needs the whole lot.

**When it fails part-way it does not clean up.** It leaves invalid `*_ccnew` indexes behind that
consume space, are never used by the planner, and are never garbage-collected. After the owner's
failed attempt, production held four of them:

| index | valid | size |
|---|---|---|
| `idx_oura_raw_samples_user_measured_ccnew` | **no** | 31 MB |
| `oura_raw_samples_user_id_ring_timestamp_ds_tag_body_hex_k_ccnew` | **no** | 11 MB |
| `oura_raw_samples_user_tag_ts_ccnew` | **no** | 0 |
| `oura_raw_samples_pkey_ccnew` | **no** | 0 |

**So a failed run makes the space problem worse, which is why a retry fails too.**

**Correct order.** In a `railway connect` psql session:

```sql
-- 1. Find any invalid leftovers (safe to run any time)
SELECT c.relname, i.indisvalid, pg_size_pretty(pg_relation_size(c.oid))
FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
JOIN pg_class t ON t.oid = i.indrelid
WHERE t.relname = 'oura_raw_samples' AND NOT i.indisvalid;

-- 2. Drop them. They are dead weight — an invalid index is never used for reads.
DROP INDEX CONCURRENTLY IF EXISTS idx_oura_raw_samples_user_measured_ccnew;
DROP INDEX CONCURRENTLY IF EXISTS oura_raw_samples_user_id_ring_timestamp_ds_tag_body_hex_k_ccnew;
DROP INDEX CONCURRENTLY IF EXISTS oura_raw_samples_user_tag_ts_ccnew;
DROP INDEX CONCURRENTLY IF EXISTS oura_raw_samples_pkey_ccnew;

-- 3. Now reindex ONE index at a time, largest first. Each needs only its own size free,
--    not the whole 316 MB. Re-check free space between each.
REINDEX INDEX CONCURRENTLY idx_oura_raw_samples_user_measured;                      -- 110 MB
REINDEX INDEX CONCURRENTLY oura_raw_samples_user_id_ring_timestamp_ds_tag_body_hex_key;  -- 102 MB
REINDEX INDEX CONCURRENTLY oura_raw_samples_user_tag_ts;                            --  71 MB
REINDEX INDEX CONCURRENTLY oura_raw_samples_pkey;                                   --  34 MB
```

**Never `REINDEX TABLE CONCURRENTLY` on this table** until the volume has well over 316 MB free.
Per-index is the default, not the fallback.

---

## 8. Key files

| File | Why it matters |
|---|---|
| `lib/data/postgres/migrations/114_oura_raw_samples.sql` | table + the UNIQUE(body_hex) + user_tag_ts indexes |
| `lib/data/postgres/migrations/115_oura_ble_clock_anchor.sql` | added `measured_at` + its index (the backfill that caused the bloat) |
| `lib/data/postgres/adapter.ts` `insertOuraRawSamples` (~3917) | ingest upsert (`onConflictDoNothing`, target-less); Lever 1 already stops persisting `decoded` |
| `app/api/oura-ble/samples/route.ts:61` | `shouldDropRawEvent` ingest filter |
| `lib/oura-ble/raw-storage.ts` | `RAW_STORAGE_DROP_TAGS` |
| `lib/oura-ble/decode.ts` | all decoders read `body_hex` (hex) — the (a) bytea change touches these |
| `docs/oura-ble-operations.md`, `oura-native-ble` skill | pipeline rules; `body_hex` = archival source of truth |
