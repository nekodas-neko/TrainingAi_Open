# 2026-08-23 — the raw-frame packer runs itself (Q-541 Task 6)

**Branch:** `feat/oura-autopack` · **Lane A** · server/JS only, ships via Railway — no APK, no migration.

## What this closes

Q-541 is complete. Tasks 0–4 built the two-tier store, the codec, the readers and the packer; Task 5
ran the backfill by hand on 2026-08-18; Task 7 removed the last two readers of the stored
`measured_at`. What was left was the thing that makes it a system rather than a button.

**Task 5 is verifiably clean in production, which is the evidence Task 6 was gated on.** Measured
2026-08-23: `oura_raw_packed` holds **764 blobs / 941,233 frames / 13 MB**, and its ds range
(1,396,593 → 31,734,854) runs contiguously into the hot tier's oldest (31,104,070). ~14.5 bytes per
frame against ~328 bytes per row.

**And it showed why a button is not enough.** That run pruned `oura_raw_samples` back to 2026-08-10.
Five days later the table was **318,183 rows / 92 MB** again — ~6.5 MB/day, against the ~0.4 MB/day
the database as a whole is supposed to grow at. The packing was never the missing piece; running it
was.

## What shipped

`insertOuraRawSamples` now fires a bounded pack after storing its batch. There is no cron layer
(module-map §0), so it rides the ingest path like the other retention jobs — with two differences
that follow from what it deletes:

- **The throttle is per user, not per process.** Every other prune uses one module-level timestamp.
  With two ringed users that lets the busier one claim every window and the other's table never gets
  packed at all. The cost of keying it is a `Map` sized by real users.
- **It claims rather than checks.** `claimAutoPackSlot` tests and sets in one step, so two batches
  arriving together in one process cannot both start a run. It does not coordinate across replicas
  and does not need to — concurrent runs are safe by construction (`ON CONFLICT DO NOTHING`, a verify
  that re-reads what is committed, a delete that names row ids) — it just avoids the wasted work.

`OURA_AUTOPACK=off` stops it without a code deploy. Nothing depends on it running: the readers span
both tiers, so the only consequence of turning it off is the growth curve.

## The delete had a race, and automating it is what made the race reachable

Phase 3 deleted by the bucket's ds **range**. A frame arriving between the select and the delete was
therefore removed *having never been packed* — in neither tier, and nothing would ever say so. The
quiet guard (`max(recorded_at) < now() - 1 day`) makes the window narrow, but firing the packer from
the ingest path is precisely arranging for it to run while frames are arriving, and narrow is not
the same as impossible.

It now deletes **by primary key**, so the deleted set is provably a subset of what the verify proved.

The test reproduces the interleaving deterministically with a Postgres trigger on the blob insert —
which is after the rows were read and before the delete, and nothing else can put a row there at that
instant. Against the range delete it fails (`expected +0 to be 1`).

## Refusals now reach `error_events`

A refusal is the packer declining to delete frames it could not prove were stored — the most
important signal this pipeline produces. It used to be returned to whoever pressed the button. With
no caller it would have stopped at a log line and vanished at the 30-day prune, so it is written to
`error_events` with `url='oura-autopack'` as well. New ops-doc row: **I28**.

## Verified

- `oura-raw-pack.test.ts` 19/19 (two new: the race, and the aftermath — a bucket whose blob no longer
  describes the hot rows is refused, never reconciled by overwriting a verified blob).
- `oura-autopack-ingest.test.ts` 3/3 — the only test that proves anything *runs* the packer.
  Everything else would pass against a packer wired to nothing, which is exactly the state that let
  the table regrow.
- Two mutations, each applied and reverted: reverting to the range delete fails the race test;
  unwiring the ingest call fails 2 of the 3 ingest tests.
- Full suite **562 files / 4,612 tests**; `pnpm check:rules` **54 of 54**.
- **`pnpm dev`, through the real HTTP route**: logged in as the seeded admin, seeded 8 cold frames in
  bucket 500, `POST /api/oura-ble/samples` → `200 {"stored":1}`, and 3 s later the hot tier held 1 row
  and `oura_raw_packed` held one 102-byte blob of 8 frames.
  `[oura-autopack] packed 1 bucket(s), 8 frames -> 102 bytes in 20ms; 0 left`.

**Failure surfaces NOT exercised:** production itself — no Railway deploy has run this, and the
production table has 315k rows against the dev fixture's 8, so the per-run cost is projected rather
than measured. No device, native, safe-area or UI path is touched (server JS only), so the
device-verification gate does not apply. The 92 MB high-water mark will **not** shrink on its own:
deleted rows leave dead tuples that new inserts reuse, so the table stops growing but does not give
space back until a `VACUUM FULL` — that is Q-315, still `Gate: owner`.

## Sizing, from the measurement rather than from caution

The batch size was 8 on a first pass and the arithmetic behind it was wrong. Four runs a day of 8 is
32 buckets against **22.5 arriving** — a net of 9.5, which converges but would take **~12 days** to
absorb the backlog that exists right now (measured in production 2026-08-24: **115 eligible buckets
holding 140,487 frames**). The 2026-08-18 backfill packed **764 buckets in 246 s** — **0.32 s per
bucket** — so 25 a run is about **8 seconds** of background work every 6 hours, and the backlog is
gone in a day and a bit. That is what makes the follow-up `VACUUM FULL` one press rather than
something to repeat as the tail dribbles in.

**What to check after the deploy:** `oura_raw_samples` row count should stop climbing and settle at
roughly 7 days of frames (~160k), and `oura_raw_packed` should gain ~22 blobs a day.
`select count(*) from error_events where url='oura-autopack'` should stay 0.
