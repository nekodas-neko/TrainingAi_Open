# Q-541 — Pack raw BLE frames into per-bucket blobs (implementation plan)

_Planning session, 2026-08-17. Implements option **§6 C** of
[`2026-08-17-db-storage-raw-samples-retention.md`](2026-08-17-db-storage-raw-samples-retention.md),
which the owner chose (A+B+C) and which is the only step that makes the stock 500 MB volume hold._

**Nothing here deletes a frame.** `body_hex` moves from one physical representation to another,
byte for byte. The `CLAUDE.md` archival rule stands unchanged and this plan does not touch it.

---

## 1. Why, in one paragraph

The database spends **~328 bytes per row to store 12 bytes of ring frame** — a 27× overhead — and
that overhead, not the data, is 93% of the largest table in the database. It is also what caused the
2026-08-17 `disk_full` outage: a full `measured_at` re-stamp rewrote 681,005 rows with **zero** HOT
updates, doubling the table without adding a single frame. Packing removes both problems at once,
because a packed table has ~23 rows/day instead of ~22,910 and stops storing `measured_at` per frame
at all.

## 2. The measured shape (production, 2026-08-17)

Grouping the owner's 1,098,956 frames by `(epoch, tag, ring_timestamp_ds / 864000)` — 864,000 ds is
one day:

| | |
|---|---:|
| Blobs replacing 1,098,956 rows | **968** |
| Row reduction | **1,135×** |
| Blobs per day | **22.5** |
| Frames per blob — mean / max | 1,135 / 9,236 |
| Raw frame payload, all history | **13 MB** |

Every blob is comfortably over Postgres's 2 kB TOAST threshold, so they compress on top of this.

**Projected steady state: ~70 MB total** (see §4), growing at **~320 kB/day ≈ 117 MB/year** — against
~7.5 MB/day today. From that baseline the 500 MB volume is roughly **3.7 years** away.

## 3. The architecture decision: two tiers, not an in-place repack

**Do not repack `oura_raw_samples` in place.** The ingest path is the one thing in this pipeline that
must never break — the history cursor's safety rests on it, and a botched change silently loses drained
spans forever (ops-doc I18, I21). A read-modify-write blob upsert on the ingest path would put a row
lock and an O(blob) merge in front of every batch, and would rewrite the dedup semantics that make
re-sends free (I8).

Instead:

| Tier | Table | Contents | Written by |
|---|---|---|---|
| **Hot** | `oura_raw_samples` — **unchanged schema, unchanged ingest** | last ~7 days of frames | ingest, exactly as today |
| **Cold** | `oura_raw_packed` — new | everything older, as sealed blobs | a background packer, never ingest |

**Properties this buys:**

- **Ingest does not change at all.** No new failure mode on the cursor path. The `ON CONFLICT DO
  NOTHING` dedup and the `(user_id, ring_timestamp_ds, tag, body_hex)` unique key stay exactly as they
  are, just over a much smaller table.
- **Cold blobs are append-only and sealed.** Once written they are never updated, so they can never
  bloat — which is the property the current table lacks.
- **The hot table's indexes shrink with it.** At ~160k rows the 78 MB dedup index becomes ~11 MB.
- **Deleting a hot row is not data loss**, because the packer only deletes what it has already proven
  is in a sealed blob (§6). That is the safety argument the whole plan rests on, and it is checkable.

### Why the bucket key is `(user_id, epoch, tag, ds_bucket)` and not a calendar day

This is the design decision most likely to be got wrong, so it is stated first.

`ring_timestamp_ds` is a monotonic decisecond counter since the *ring's own* epoch. Wall-clock time is
derived from it through clock anchors — and **that derivation changes**: correcting it is exactly what
the Q-71/I25 fix did, and what the re-stamp that caused the outage was applying. A blob partitioned by
calendar day would therefore need **re-partitioning every time the clock math is corrected**, which
reintroduces the failure this plan exists to remove.

`ds_bucket = ring_timestamp_ds / 864000` is a pure function of a stored, immutable column. It never
moves.

**`epoch` is load-bearing in that key, and the data proves it** — the ds ranges of the four epochs
overlap heavily:

| epoch | rows | ds range |
|---:|---:|---|
| 0 | 664,939 | 1,396,593 – 21,444,831 |
| 1 | 464 | 17,391,049 – 21,469,936 |
| 2 | 426,356 | 21,470,017 – 37,112,321 |
| 3 | 7,197 | 33,001,730 – 37,190,091 |

Bucketing on ds without `epoch` would merge frames recorded months apart into one blob.

> **Latent issue found while establishing this, not introduced by it:** the *existing* unique
> constraint is `(user_id, ring_timestamp_ds, tag, body_hex)` and **does not include `epoch`**. Given
> the overlapping ranges above, two genuinely distinct frames from different epochs sharing a ds, tag
> and body would be deduplicated into one. Identical bodies make a real collision unlikely and no
> instance has been demonstrated — this is filed as a thing to check, not a claimed data loss. See
> Task 0.

## 4. Sizing the hot window

The hot tier needs to be long enough for two things and no longer:

1. **Ingest dedup** — must cover any re-drain. Re-drains span hours to a few days (ops-doc §2: hourly
   drains, and a Full re-sync of the ring's finite buffer).
2. **Nothing else.** The rollup does *not* need it: reading all 968 cold blobs is cheaper than reading
   35 days of hot rows, so the rollup reads both tiers (§5) and does not care where a frame lives.

**7 days**, as a named constant, with generous margin over the drain cadence.

| | Rows | Est. size |
|---|---:|---:|
| Hot (`oura_raw_samples`, 7 days) | ~160,000 | ~52 MB incl. indexes |
| Cold (`oura_raw_packed`, all history) | ~968 + ~23/day | ~16–20 MB |
| **Total** | | **~70 MB** |

## 5. Blob format

Self-describing, versioned, decoder-agnostic. `bytea`, one per bucket:

```
byte 0        format version (0x01)
varint        frame count
varint        base_ds (the bucket's lowest ring_timestamp_ds)
then per frame, ordered by ds ascending:
  varint      ds delta from the previous frame (first is delta from base_ds)
  varint      body length in bytes
  bytes       body (the decoded-from-hex bytes of body_hex)
```

- **Store bytes, not hex.** The blob is `bytea`, so `body_hex` is halved on the way in. This is where
  Q-540's `bytea` half is absorbed — **do not also run the standalone `text` → `bytea` migration**, it
  would be the same rewrite twice.
- **`event_name` is not stored.** It is a pure function of `tag` (30 distinct values, already pinned by
  the Kotlin/TS cross-language parity test) and `tag` is a column on the blob row.
- **`measured_at` is not stored.** It is derived at read time via `resolveDsToMs` over the anchor list,
  which is already how the rollup resolves time (Q-71). **This is what deletes the re-stamp
  operation** — a future clock correction changes a derivation, not 1.1M rows.
- **`decoded` is not stored.** Already `NULL` on every row (Lever 1a/1b); decoding happens in memory
  from the body.

Row: `(user_id, epoch, tag, ds_bucket, frame_count, min_ds, max_ds, body_sha256, blob, packed_at)`,
primary key `(user_id, epoch, tag, ds_bucket)`.

## 6. The packer's safety contract — the part to get right

The packer runs in three phases per bucket, and **must be fail-closed at each**:

1. **Seal.** A bucket is eligible only when `ds_bucket` is entirely older than the hot window *and* no
   row in it has been written recently. Never pack a bucket the ring might still deliver into.
2. **Write and verify.** Insert the blob, then **read it back and prove equivalence**: unpack it and
   assert the multiset of `(ring_timestamp_ds, body)` matches the hot rows exactly, and that
   `frame_count` and `body_sha256` agree. Any mismatch → leave the blob, delete nothing, log, stop.
3. **Delete.** Only then delete the hot rows for that bucket, scoped to
   `(user_id, epoch, tag, ds_bucket)`.

Phases 2 and 3 must not run in one transaction with phase 1's read — verify against what is actually
committed, not against what was intended.

**The delete is the only destructive statement in this plan**, and it is gated on a proven-equal
re-read of the same frames. That is what keeps the archival guarantee intact.

## 7. Tasks

**Task 0 — ✅ ANSWERED 2026-08-17, and the proposed method is now the wrong one.** The question was
whether any two rows share `(user_id, ring_timestamp_ds, tag, body_hex)` across different epochs.
They cannot: **that tuple *is* the unique constraint**, and it does not include `epoch` —
`oura_raw_samples_user_id_ring_timestamp_ds_tag_body_hex_key`, confirmed against production and
against `schema.ts:1064`. A second such row was never insertable, so this is structural rather than
a property of the current data. The bucket key keeps `epoch`, which is there for time-derivation
correctness and not for dedup.

⚠️ **Do not answer this by counting, which is what this task originally proposed.** Migration 190
(Q-536) collapsed every one of the owner's samples to `epoch = 0`, so a cross-epoch duplicate count
now returns "none" **for the wrong reason** — there is only one epoch left to be cross. The count
would look like confirmation and would be evidence of nothing.

**Task 1 — ✅ SHIPPED as migration `191_oura_raw_packed.sql`.** Table + PK per §5, plus a
`(user_id, ds_bucket)` index for the range-across-tags read shape the PK cannot serve (it puts `tag`
ahead of `ds_bucket`). Additive only — `oura_raw_samples` and the ingest path are untouched.
**Migration `192` regenerates the `claude_ro` views**, which a new table requires: the schema is
default-deny, and `claude-ro-readonly-role.test.ts` failed on the coverage count until it landed
(81 views against 82 tables). Its filename pin was re-pointed in the same commit, per `CLAUDE.md`.

**Task 2 — ✅ SHIPPED** as `lib/oura-ble/frame-pack.ts`, pure and dependency-free. 7 codec tests
(200 seeded round-trips, the edges, an unsorted input, malformed-blob rejection, the hex helpers) and
2 DB-backed tests proving a blob survives the `bytea` column and the pg driver byte for byte — the
join where a byte format usually breaks. Pinned vector: the owner's five oldest tag-0x76 frames.
Measured on it, **63 bytes packed against ~1,640 as rows** — the 26× the plan projected.

Two things learned while writing it, both now in the code: `packFrames` **sorts** rather than
trusting the caller, because an unsorted list would otherwise encode a negative delta and unpack to
different data instead of failing; and a **zero delta is legal** — two frames may share a `ds`, since
the dedup key includes `body_hex`.

**Task 3 — ✅ SHIPPED** as `lib/data/postgres/slices/oura-raw-frames.ts`. Two functions, not one:
`readRawFrames` (ds range + tags, ascending) covers the rollup, both step-feature reads, the
temp/MET and battery range reads and the two tag-census diagnostics; `readRecentRawFrames`
(newest-first, limited) covers the admin tester's raw dump and the summary's `recent()`. Both return
**exactly the shape of the `select` they replace**, so a call site changed which function it calls
and nothing else — which is what made the equivalence testable rather than argued. Eleven read sites
converted; `getOuraRawSamplesForTags` is left alone deliberately, it is Task 7.

Three things the work established that the plan had not:

- **An aggregate cannot use the reader's dedupe, and silently double-counted.** The summary's
  per-tag counts summed the two tiers directly; measured on the dev server, 80 frames read as
  **120** while a bucket sat in both tiers — the packer's own mid-write state, and its permanent
  state if it is interrupted between write and delete. The counts now anti-join on
  `(epoch, tag, ds_bucket)`, which is exact because the packer's unit is a whole bucket.
- **`event_name` had to become derived, not read.** A packed frame carries no name, and grouping the
  summary on a column one tier lacks splits a single tag into two rows. `eventName(tag)` is now the
  only source — which also drops a stale stored name that `refreshRawSampleEventNames` exists to
  repair. One test fixture pinned the old stale value and was updated to pin the consequence.
- **A dormant tag needed a cold fallback in three places** (the field inspector, the raw dump, the
  oldest-frame span). Hot-only, a tag that stopped streaming before the hot window opened reads as
  never having produced data rather than as stale.

Verified end to end on `pnpm dev` by rehearsing the packer by hand over four seeded ring-days: the
summary, per-tag counts, raw dump and ds span are **byte-identical across all three states** —
all-hot, both-tiers, and hot-rows-deleted — with half the frames readable only from a blob.

**Task 4 — ✅ SHIPPED** as `lib/data/postgres/slices/oura-raw-pack.ts` +
`GET|POST /api/oura-ble/samples/pack`. Admin-gated, bounded (default 25 buckets, cap 200),
idempotent, resumable, rate-limited. **Not automatic on deploy**, same posture as Lever 1b/1c.
The `GET` reports what is packable without touching anything.

Four decisions the plan left open, settled here:

- **The hot window is anchored to `max(ring_timestamp_ds)`, not to `now()`.** A ring that has not
  synced for a month must not become fully packable just because time passed — phase 1's whole point
  is that a bucket the ring may still deliver into stays hot.
- **Plus a wall-clock quiet guard** (`max(recorded_at) < now() - 1 day`). The ds guard alone is not
  enough: `ring_timestamp_ds` says when the ring *recorded* a frame, not when we received it, and a
  re-drain delivers week-old ds values today. Without this a bucket being actively re-drained looks
  eligible on its ds and gets packed mid-delivery.
- **`body_sha256` hashes the frame *sequence*, not the blob.** Hashing the blob going in and
  re-hashing the same blob coming out proves only that Postgres stored the bytes, which the re-read
  already proves. Hashing `ds:hex` per frame makes it an independent check, so a codec bug that
  round-trips a blob while mangling a frame cannot pass both. There is a test for exactly that case —
  a self-consistent blob holding different frames.
- **`ON CONFLICT DO NOTHING`, never `DO UPDATE`.** An existing blob is either already verified (then
  re-verify and delete) or the residue of a failed verify (then it must be re-examined, not silently
  overwritten).

A refused bucket is returned in the result, not thrown: one bad bucket must not stop the ones behind
it, and what prevents the real hazard is the verify, not aborting the run.

**Verified live**, not only in tests: 251 seeded frames across 10 buckets driven through the route on
`pnpm dev` — 250 moved into **2,800 bytes of blob** (≈29× against ~328 B/row), bounded 3-then-7 with
`remaining` correct, idempotent on a second press, and the API's full frame dump **hashes identically
before and after** (251 rows, same SHA). 13 tests, and the refuse-to-delete guard is mutation-checked.

⚠️ **The admin button is NOT built** — `components/oura-ble/db-footprint-card.tsx` is Lane B's
territory. Filed as Q-316. The route is fully usable without it.

**Task 5 — backfill.** Run the packer over all history in bounded batches. 968 blobs is small; the
delete side is 1.1M rows, so batch it and **`VACUUM FULL` after**, not during.

**Task 6 — hot-window prune.** Only after Task 5 has verified clean: a throttled prune matching the
existing `shouldPrune` pattern in `adapter.ts`, deleting hot rows whose bucket is sealed and packed.

**Task 7 — ✅ SHIPPED, and it turned out to include the Q-534 index drop itself.** The set was not
empty: two readers filtered on the stored `measured_at`. Both now convert their wall-clock window to
a ring ds range through the anchors and read ds-keyed (two-tier, for free) —
`getOuraRawSamplesForTags` via `resolveMsToDs`, `getLatestOuraBleMeasuredAt` via
`max(ring_timestamp_ds)` across both tiers. **Migration 193 drops the index: 136 MB.**

Three things this forced that the plan had not anticipated:

- **The stored `measured_at` and `event_name` columns became dead**, so the redecode's re-stamp/
  refresh loop was writing values nothing reads. It is now a documented no-op. **That loop is what
  filled the disk on 2026-08-17** — `measured_at` being indexed made a changed-value UPDATE
  ineligible for HOT, so production recorded 1,324,792 updates against 740,966 rows with **19** HOT.
  Q-46's `IS DISTINCT FROM` guard bounded it but could not remove it, because the Q-71/Q-536 clock
  fixes made every row genuinely distinct. Deriving at read time removes the operation, and with it
  the reason the documented remedy for five ops-doc failure modes was a disk-fill hazard.
- **`/api/oura/stats` was reading `connected` off "we can name a last-measured time"**, and those
  stopped being the same question once the time became derived — a ring with frames but no resolvable
  anchor would have read as disconnected and silently taken the Health tab's whole Ring section with
  it. Split into `hasOuraBleSamples`, which is also the cheaper query.
- **A test fixture stamped `measured_at` by hand with no clock anchor** — a state production cannot
  be in, since anchors are append-only and every stamp came from one. Its ds and wall-clock columns
  described different histories, which was invisible while nothing derived one from the other.

Deliberately NOT done: dropping the now-dead `measured_at` and `event_name` **columns**. That is a
data-dropping migration and owner-gated; the index drop is reversible with one `CREATE INDEX`.

## 8. Call sites this touches

Reads (all the same shape, all in `adapter.ts` unless noted): the rollup's tag scan and its
`ROLLUP_TAGS` read, the SpO₂/temperature/debug reads, `sleepnet-assemble.ts`, `step-features.ts`, the
admin tester's summary/raw readers (`components/oura-ble/`), `app/api/oura-ble/db-stats/route.ts`.

Writes: **none change.** `insertOuraRawSamples` is untouched.

Deletions of dead weight this enables: the redecode `event_name` refresh and `measured_at` re-stamp
(`adapter.ts` ~4928–4960) lose their reason to exist for packed data.

## 9. Gates

- Codec property tests + a pinned production vector.
- **A verified backfill on a copy of production before the real one** — the local dev DB is seeded, not
  drifted, and this is exactly the class of bug `CLAUDE.md` warns reproduces only against real data.
- Equivalence assertion (§6 phase 2) green for every bucket, fail-closed.
- Post-backfill: the rollup produces **identical** `sleep_sessions` / `body_metrics` output over a
  sample of historical days, read from blobs instead of rows. This is the real gate — packing is
  correct exactly when nothing downstream notices.
- `pnpm check:rules`, full suite, `pnpm dev` pass.

## 10. What this plan does NOT do

- **It does not delete any frame**, and it does not amend the archival rule.
- **It does not touch the device**, `oura_raw.db`, or any Kotlin. Server/JS only — ships via Railway,
  no APK.
- **It does not implement D4**, and it does not make D4 harder: a packed table pulls to the device as
  well as an unpacked one, arguably better.
- **It does not replace the index work in Q-534.** The index audit is separate, lands first, and is what makes the
  interim (pre-packing) table survivable.

**Failure surfaces not exercised:** planning only, no code written. All sizing is projected from
production measurements taken 2026-08-17 while the table was mid-re-stamp — the blob counts and payload
totals come from `claude_ro` (owner-scoped, and the owner is 99.98% of this table), the physical sizes
from `pg_stat_user_tables` (system-wide). Nothing here has been run.
