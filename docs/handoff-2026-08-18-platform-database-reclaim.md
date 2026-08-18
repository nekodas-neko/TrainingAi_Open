# 2026-08-18 — the database reclaim: everything is built, two presses remain

> ## ✅ DONE — the presses were run 2026-08-18, and every "never run" claim below is now historical.
>
> The owner executed the runbook with a one-off planning session. **Result: 805 MB → 171 MB.**
>
> | | Before | After |
> |---|---:|---:|
> | Database | 805 MB | **171 MB** |
> | `oura_raw_samples` | 563 MB | 50 MB |
> | `oura_raw_packed` | — | 13 MB (764 blobs) |
>
> **764 buckets packed, 941,233 frames moved, 0 refused**, then `VACUUM FULL` reclaimed **513 MB in
> 2.1 s**. Frame count held at **1,120,970** throughout — verified by conservation against the exact
> pre-pack count, with zero hot rows left inside any packed bucket and zero malformed blobs.
>
> **Read the rest of this doc as the record of how it was done, not as work outstanding.** Three
> things it says are now superseded:
>
> 1. **The 500 MB target is WITHDRAWN.** Railway cannot shrink a volume (*"Down-sizing a volume is not
>    currently supported"*) and bills on storage **used**, not provisioned — so 5 GB costs what 500 MB
>    would at the same usage. The end-of-week deadline it cites does not exist any more.
> 2. **There is no admin UI for the pack route.** The runbook assumes a button; there isn't one, so all
>    six presses were hand-typed `fetch()` calls from a desktop console. Filed as **Q-544**, along with
>    the reason a desktop was needed at all: `DbFootprintCard` sits behind a native-plugin early return.
> 3. **`error_events` was not vacuumed and does not need to be.** It is 49 MB of residue from one
>    already-fixed fault (Q-214) and ages out of the 30-day window around **2026-09-12** on its own.
>
> Full session record: [`docs/handoff-2026-08-18-platform-db-storage-and-device-primary-compute.md`](handoff-2026-08-18-platform-db-storage-and-device-primary-compute.md).

**Domain:** `platform` · **Lane A** · supersedes nothing; complements
[`docs/superpowers/plans/2026-08-17-oura-raw-frame-packing.md`](superpowers/plans/2026-08-17-oura-raw-frame-packing.md)
and Q-534.

## The situation in one table

The owner's instruction of 2026-08-17: the 5 GB volume is temporary and must be deprecated by end of
week; all work aims at returning to the stock **500 MB**.

Production, measured 2026-08-18: **819 MB total**, of which `oura_raw_samples` is **699 MB**
(255 MB heap, **443 MB indexes** — 63% of the largest table).

| Step | Worth | State |
|---|---:|---|
| Migration **193** drops `idx_oura_raw_samples_user_measured` | **136 MB** | ✅ merged. `DROP INDEX` frees the index's files immediately, so this lands on the next deploy with **no press** |
| **Pack the raw frames** — `POST /api/oura-ble/samples/pack` | **~630 MB** | ⛔ built, verified, **never run against production** |
| **`VACUUM FULL error_events`** — `POST /api/admin/vacuum` | **~49 MB** | ⛔ built, verified, **never run against production** |
| **After packing:** `VACUUM FULL oura_raw_samples` | (returns the packed space to the OS) | ⛔ same route |

**With all of it: ~140 MB.** Without the presses: ~683 MB, still over.

**Nothing has been packed and no row has moved.** The shipped tasks are not progress against the
deadline until these run.

## Why it needs you

Every reclaim sits behind an admin-session-gated route, and a sandbox session **cannot authenticate
to production**. `CLAUDE_DB_QUERY_SECRET` is read-only over the `claude_ro` views;
`ADMIN_EXPORT_SECRET` is GET-only on one route. Neither reaches these.

Three ways forward — **pick one**:

1. **You run the curls** (below). Fastest; nothing more to build.
2. **Lane B builds the buttons** — Q-316 for the packer, and the DB-footprint card wants one for
   `/api/admin/vacuum` too. Then you press in the app. `components/**` is Lane B's, which is why
   Lane A did not write them.
3. **A bearer-token path on the two routes**, modelled on `ADMIN_EXPORT_SECRET` — fail-closed,
   admin-verified, widening transport and not authority — so a session can drive it end to end.
   **This is an auth change, so it is confirm-first and has not been built.**

## The runbook (option 1)

Get an admin session cookie from a logged-in browser on the production site (DevTools → Application →
Cookies → `__Secure-authjs.session-token`), then:

```bash
BASE=https://trainingai-production.up.railway.app
COOKIE='__Secure-authjs.session-token=<paste>'

# 0. Baseline. Note the numbers — this is what you compare against.
curl -sX POST $BASE/api/admin/db-query \
  -H "Authorization: Bearer $CLAUDE_DB_QUERY_SECRET" -H 'Content-Type: application/json' \
  -d '{"sql":"SELECT c.relname tbl, t.n_live_tup, pg_size_pretty(pg_total_relation_size(c.oid)) total FROM pg_class c JOIN pg_stat_user_tables t ON t.relid=c.oid WHERE c.relnamespace='"'"'public'"'"'::regnamespace ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 5"}'

# 1. How much is packable, touching nothing.
curl -s "$BASE/api/oura-ble/samples/pack" -H "Cookie: $COOKIE"
#    → {"buckets": ~968, "sealBelowDs": ...}

# 2. START WITH ONE BUCKET and read the result before going further.
curl -sX POST "$BASE/api/oura-ble/samples/pack" -H "Cookie: $COOKIE" \
  -H 'Content-Type: application/json' -d '{"maxBuckets":1}'
#    → packed:1, refused:0, framesMoved:N, remaining:967
#    ⚠️ If `refused` is anything but 0, STOP and read the per-bucket reason. A refusal means a
#       bucket could not be proven equal and was left intact — that is a finding, not a no-op.

# 3. Then in bounded batches. Repeat until `remaining` reaches 0 (~20 presses at 50).
curl -sX POST "$BASE/api/oura-ble/samples/pack" -H "Cookie: $COOKIE" \
  -H 'Content-Type: application/json' -d '{"maxBuckets":50}'

# 4. Only once remaining is 0: return the space to the OS. Brief exclusive lock, minutes on this table.
curl -sX POST "$BASE/api/admin/vacuum" -H "Cookie: $COOKIE" \
  -H 'Content-Type: application/json' -d '{"table":"oura_raw_samples"}'

# 5. The independent 49 MB. Safe at any point, four live rows.
curl -sX POST "$BASE/api/admin/vacuum" -H "Cookie: $COOKIE" \
  -H 'Content-Type: application/json' -d '{"table":"error_events"}'

# 6. Re-run step 0 and compare.
```

## What protects you while this runs

- **The packer is the only code in the project that deletes an archival frame**, and it deletes a
  bucket's hot rows *only* after inserting the blob, **re-reading it out of the database**, unpacking
  it, and proving the frames equal — count, an independent frame-sequence SHA-256, and a
  frame-by-frame comparison. Any mismatch leaves the blob, deletes nothing, and reports the reason.
- **A bucket is only eligible when it is genuinely finished**: entirely older than a 7-day hot window
  measured against `max(ring_timestamp_ds)` (not the wall clock, so a ring that has not synced does
  not become packable just because time passed), *and* nothing has been written to it in the last
  day (because a re-drain delivers week-old ring timestamps today).
- **It is bounded, idempotent and resumable.** Pressing again is always safe; a partial run leaves a
  consistent state, and re-running finds only what is left.
- **Every read already spans both tiers**, shipped and merged — so a packed frame is not invisible to
  anything, and the app behaves identically before and after. Verified by rehearsing the packer by
  hand on the dev server: the API's full frame dump hashes identically across all-hot, both-tiers and
  hot-rows-deleted.

## What is NOT verified

- **No production data has been packed.** Everything above is proven against seeded local data
  (251 frames → 10 blobs, 2,800 bytes, ≈29×) and by 13 packer tests plus 10 reader tests. The
  plan's own gate — *a verified backfill on a copy of production before the real one* — has **not**
  been met, and a sandbox cannot make that copy. Step 2's single-bucket press is the mitigation that
  actually exists.
- **The largest bucket tested is 25 frames; production's largest is 9,236.** That blob would be
  ~30 kB — comfortably TOASTed, but it has not been built.
- **`VACUUM FULL` needs free disk equal to the table's current size.** On the 5 GB volume against
  699 MB that is not a constraint. **It would be one after the volume is cut back to 500 MB**, so
  run the vacuum steps *before* shrinking the volume, not after.
- No device, no Kotlin, no APK — all of this is server/JS and reaches the S25 through the Railway
  deploy.

## Pickup prompt

```
You are Implementation Agent (A) 🚧 on nekodas-neko/TrainingAi_Open. Read, in order:
docs/agents/README.md, docs/agents/state/implementation-lane-a.md, projectOverview.md,
docs/domains/platform/README.md, then this handoff
(docs/handoff-2026-08-18-platform-database-reclaim.md) and
docs/superpowers/plans/2026-08-17-oura-raw-frame-packing.md.

Standing priority: the owner's 5 GB volume is temporary and must return to the stock 500 MB by end
of this week. Production is 819 MB. The reclaim is BUILT and MERGED — migration 193 (136 MB, lands
on deploy with no press), the frame packer (~630 MB), and a VACUUM FULL route for error_events
(49 MB) — but the last two have never run against production, because a sandbox session cannot
authenticate there.

FIRST ACTION: ask the owner which of the three options in this handoff's "Why it needs you" section
they want (they run the curls / Lane B builds the buttons / a confirm-first bearer-token path), and
do not build option 3 without an explicit yes — it is an auth change.

While that is open, the available Lane A work in priority order is in the baton's Next section;
Q-353 (the health-insight "no data" prompt bug) is the smallest self-contained item.

Constraints you would otherwise rediscover: oura_raw_samples.measured_at and event_name are DEAD
COLUMNS — every reader derives from the clock anchors and from `tag`, so do not add a reader of
either. All raw-frame reads must go through lib/data/postgres/slices/oura-raw-frames.ts, because a
hot-only read silently returns a 7-day history. An aggregate cannot use that reader's dedupe —
count via an anti-join on (epoch, tag, ds_bucket). scripts/check-doc-index-size.js conflicts on
essentially every merge: resolve it by recomputing from the merged files, never by splicing a hunk.
```
