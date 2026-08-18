# 2026-08-18 — ds-keyed wall-clock reads, and the 136 MB index (Q-541 Task 7 / Q-534 finding 4)

**Lane A** · branch `perf/oura-measured-at-index-drop` · v1.320.1 · migration **193** · no Kotlin, no APK.

Two readers of `oura_raw_samples` filtered on the stored `measured_at` column. Both now convert
their wall-clock window to a **ring `ds` range** through the clock anchors and read ds-keyed — which
is what let migration 193 drop `idx_oura_raw_samples_user_measured`, **136 MB** on a 699 MB table
whose indexes were 443 MB.

The backlog entry warned this was three steps and not one — "rewrite both call sites to be ds-keyed,
prove equivalence, then drop the index. Do not drop it first and measure afterwards." That is the
order taken.

## What changed

- `getOuraRawSamplesForTags` — `resolveMsToDs(now - N days)` → `readRawFrames({ tags, startDs })`.
  Two-tier for free, and it no longer filters on a NULL-able column, so a frame whose stamp was never
  written is now found instead of invisible.
- `getLatestOuraBleMeasuredAt` — `max(ring_timestamp_ds)` across both tiers, resolved through the
  anchors.
- **Migration 193** drops the index. Reversible: the column stays and one `CREATE INDEX` rebuilds it.

## Three things this forced that the plan had not anticipated

**The stored `measured_at` and `event_name` columns are now dead**, so the redecode's re-stamp /
refresh loop was writing values nothing reads. It is a documented no-op.

That is not a tidy-up — **that loop is what filled the disk on 2026-08-17.** `measured_at` being
indexed made an UPDATE that changed it ineligible for a HOT update, so it rewrote an entry in all
four of the table's indexes: production recorded **1,324,792 updates against 740,966 rows with 19
HOT**, and one full re-stamp rewrote 681,005 rows without adding a single frame. Q-46's
`IS DISTINCT FROM` guard bounded the damage but could not remove it, because the Q-71/Q-536 clock
fixes made every row genuinely distinct. Deriving at read time removes the *operation*, and with it
the reason the documented remedy for five ops-doc failure modes (I12, I14, I19, I20, I25) was itself
a disk-fill hazard. Q-534's request for a pre-flight free-space guard on that route is moot for the
same reason.

**`/api/oura/stats` was reading `connected` off "we can name a last-measured time".** Those stopped
being the same question the moment that time became derived: a ring with frames but no resolvable
clock anchor would have read as disconnected, and `oura-section.tsx` returns null on `!connected` —
so the Health tab's entire Ring section would have vanished with nothing failing anywhere. Split into
`hasOuraBleSamples`, which is also the cheaper query (`EXISTS` stops at the first row where the old
path took a `max()`) and covers both tiers.

**A test fixture stamped `measured_at` by hand and supplied no clock anchor** — a state production
cannot be in, since anchors are append-only and every stamp came from one. Its `ds` advanced 0.2 s
per frame while its `measured_at` advanced 5 minutes, so the two columns described different
histories. Invisible while nothing derived one from the other.

## Verification

- **8 new equivalence tests**: the window selects exactly the frames inside it and excludes the
  rest; a cold-tier-only frame is found; a frame whose stored stamp was never written is found; the
  derived time ignores a stored column poisoned 100 days off; `getLatestOuraBleMeasuredAt` derives
  the newest frame's time and sees a cold-tier-only history; and both return null/empty rather than
  guessing when there is no anchor.
- **Three existing tests updated rather than deleted**, each because the behaviour it pinned was
  removed on purpose. The re-stamp guard file now pins the stronger invariant — the redecode writes
  to `oura_raw_samples` **at all** — since a guard that must be right about when to skip a write can
  be wrong, and no write cannot.
- **Live on `pnpm dev` with `measured_at` NULL on every one of 144 seeded frames** — the case the old
  implementation could not serve at all: `/api/oura-ble/freshness` returns a derived timestamp,
  `/api/oura/stats` reports connected, `/api/oura-ble/device-metrics` buckets three days correctly.
- Full suite **485 files / 3,944 tests passed** · `tsc --noEmit` clean · `pnpm check:rules` 38 of 38.
- Migration 193 applied against the local dev DB and the index confirmed gone from `pg_indexes`.

## Failure surfaces NOT exercised

- **The index drop has not run in production.** 136 MB is the measured size there, not a reclaim
  that has happened. It runs on the next deploy's `ensureSchema`.
- **No plan comparison on a production-sized table.** The local dev DB has hundreds of rows, so the
  planner seq-scans regardless and cannot show that the ds-keyed reads use
  `oura_raw_samples_user_tag_ts` and the primary key as intended.
- **The re-stamp's absence is proven by tests, not by watching a production redecode.**
- No device, no Kotlin, no APK.

## Deliberately not done

**Dropping the now-dead `measured_at` and `event_name` columns.** That is a data-dropping migration
and owner-gated. The index drop is reversible with one statement; a column drop is not. It also
overlaps Q-540's `event_name` half, which Q-541's packing supersedes.

Q-534's findings 1–3 — the dedup index storing `body_hex` a second time, autovacuum never having run,
and `work_mem` — are untouched and still open.
