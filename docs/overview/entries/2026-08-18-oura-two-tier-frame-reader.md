# 2026-08-18 — the two-tier raw-frame reader (Q-541 Task 3)

**Lane A** · branch `perf/oura-two-tier-frame-reader` · v1.318.12 · no migration, no Kotlin, no APK.

Continues Q-541, whose priority comes from the owner's standing instruction on 2026-08-17: the 5 GB
volume is temporary and **all work aims at returning the database to the stock 500 MB by end of
week**. Production measured this morning: **819 MB**, of which `oura_raw_samples` is **699 MB**
(255 MB heap, **443 MB indexes** — indexes are now 63% of the largest table and growing).

## What shipped

`lib/data/postgres/slices/oura-raw-frames.ts` — two functions:

- `readRawFrames(db, userId, { tags?, startDs?, endDs? })` — both tiers, ascending by `ds`.
- `readRecentRawFrames(db, userId, tags, limit)` — newest-first, hot tier read first and the cold
  tier touched only if it comes up short.

Eleven read sites converted: the rollup's `ROLLUP_TAGS` scan, both step-feature reads (rollup and
`previewStepsBackfill`), the temp/MET and battery range reads, the workout-window and daytime tag
censuses, the admin raw dump, and the summary's `recent()`. `oura_raw_packed` also joins the admin
DB-footprint readout, since packing is only observable as the two tables moving in opposite
directions.

Both functions return **exactly the shape of the `select` they replace**. That was the design
choice that mattered: a call site changed which function it calls and nothing else, which is what
made equivalence testable rather than argued.

`getOuraRawSamplesForTags` is deliberately untouched — it filters on `measured_at`, which is Task 7
and coupled to Q-534's index work.

## Three things the work established

**An aggregate cannot use the reader's dedupe, and mine double-counted.** The reader removes the
overlap by frame identity, but the summary's per-tag counts summed the two tiers directly. Measured
on the dev server with a bucket in both tiers: **80 frames read as 120**. That state is not exotic —
it is the packer's own mid-write state (write blob → verify → delete hot rows) and its *permanent*
state if it is interrupted between the two. The counts now anti-join on `(epoch, tag, ds_bucket)`,
exact because the packer's unit is a whole bucket. Found by running it, not by review.

**`event_name` had to become derived rather than read.** A packed frame carries no name, and
grouping the summary on a column one tier lacks splits a single tag into two rows. `eventName(tag)`
is now the only source — which incidentally drops a stale stored name, the drift that
`refreshRawSampleEventNames` exists to repair. One fixture pinned the stale value (`'unknown'` for
tag `0x77`, whose real name is `spo2_dc_event`); it now pins the consequence instead.

**A dormant tag needs a cold fallback in three places.** Hot-only, a tag that stopped streaming
before the hot window opened reads as never having produced data rather than as stale — in the field
inspector, the raw dump, and the oldest-frame span.

## Verification

- 10 DB-backed reader tests: same frames whether hot, cold or split; no double-count on an overlap;
  two same-`ds` frames with different bodies both survive (the dedup key is the ingest unique key,
  not `ds`); ds range filtered per frame rather than per bucket; tag filtering; the descending
  top-up and its no-op case. The double-count regression test was **mutation-checked** — reverting
  the anti-join turns it red.
- Full suite **484 files / 3,937 tests passed**, `tsc --noEmit` clean, `pnpm build` green,
  `pnpm check:rules` **38 of 38**.
- **`pnpm dev`, packer rehearsed by hand** over four seeded ring-days: the summary, per-tag counts,
  raw dump and ds span are identical across all three states — all-hot, both-tiers, and
  hot-rows-deleted — with half the frames readable only from a blob.

## Failure surfaces NOT exercised

- **No production data has been packed.** This is still inert there: nothing writes a blob, so every
  read takes the hot path exactly as before. The two-tier behaviour is proven against seeded local
  data only.
- **The codec has never seen a full production bucket** — the largest fixture is 60 synthetic frames
  against a real max of 9,236. The plan's gate stands: a verified backfill on a copy of production
  before the real one.
- **No device, no Kotlin, no APK.** Server/JS only — this reaches the S25 through the Railway deploy.
- Not measured: the anti-join's cost against 160k hot rows (it is an admin summary; the local shape
  is 160 rows).

## Next

Tasks 4–7: the packer, the backfill, the hot-window prune, the `measured_at` sweep. **The packer's
delete is the only destructive statement in the plan** and is gated on a proven-equal re-read
(plan §6).

One free win found while measuring production and filed rather than taken: `error_events` is
**49 MB with 4 live rows** — pure bloat left behind after Q-539 fixed the write path and the rows
were pruned. A `VACUUM FULL` reclaims ~6% of the database at no risk.
