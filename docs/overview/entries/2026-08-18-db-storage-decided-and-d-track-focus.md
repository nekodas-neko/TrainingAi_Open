# 2026-08-18 — storage decided, reclaimed, then superseded by the D-track

One-off planning session (not one of the five standing agents). Docs-only; **no code written.**
Handoff: [`docs/handoff-2026-08-18-platform-db-storage-and-device-primary-compute.md`](../../handoff-2026-08-18-platform-db-storage-and-device-primary-compute.md).

## The reframe that decided it

`body_hex` — the column `CLAUDE.md` protects absolutely, because a decoder fix can only back-fill by
re-decoding stored hex — is **26 MB of a 360 MB table, 7.3%**. It averages 12 bytes of real frame
stored at ~328 bytes/row: a 27× overhead. **The archival rule was protecting the cheap part**, and
every expensive part is reversible. That is what made "nothing irreversible is needed" the answer
rather than a compromise. The owner chose **A+B+C** and declined both one-way doors.

## Executed with the owner: 805 MB → 171 MB

764 buckets packed, **941,233 frames moved, 0 refused**, then `VACUUM FULL` reclaimed **513 MB in
2.1 s**. Frame count held at **1,120,970** throughout — verified by conservation against the exact
pre-pack count, zero hot rows left in any packed bucket, zero malformed blobs. Six hand-typed
`fetch()` calls, because the pack route has no button and the vacuum button sits behind a
native-plugin early return (Q-544).

## The incident was bloat, not growth

`n_tup_ins = 0`, `n_tup_upd = 681,005`, **`n_tup_hot_upd = 0`** — a full `measured_at` re-stamp,
non-HOT because the column was indexed, doubling the table while live rows went **down** and the
payload did not move. **Not** the Q-46 bug, whose guard is present and correct: it can only skip a
re-stamp writing back the same value, and the clock correction changed every derived value. The
durable finding is that the operations manual prescribes Redecode as the remedy for five failure
modes, so the documented fix procedure was itself a disk-fill hazard until the index was dropped.

## Then the bill reframed the whole exercise

Storage is **$0.12 of $18.63 — 0.6%**. The reclaim moved cost by about **nine cents a month**. Memory
and CPU are 99%. The owner's reaction settled the direction: they had assumed the phone aggregated
ring data and sent only summaries — which is the D-track north star verbatim, and is not what runs.

Planned as [`2026-08-18-device-primary-compute.md`](../../superpowers/plans/2026-08-18-device-primary-compute.md),
with the measurement that makes it tractable: `aggregateOuraRawSamples` is **1,110 lines of which only
17 touch the database**, so the device rollup is an extraction behind an I/O port, not a rewrite. It
also closes Q-538 for free — `pruneRaw` needs `rolled_up = 1`, and `markRolledUp` has no caller.

## What the measurements refuted

Worth recording, because each was expensive and looked right:

- **Three CPU hypotheses** — a server cron (none; every `setInterval` is client-side), the rollup
  re-decoding its window (Q-213 already fixed it), an epoch-mismatched watermark (all epoch 0). The
  owner's graphs answered it: **spiky**, so the device rollup does fix it — and a large share is
  **deploy churn** from two lanes shipping, so any before/after needs a quiet-window baseline.
- **"Autovacuum has never run"** in a concurrent session's entry — a post-crash statistics artifact.
  An unclean shutdown discards the stats file and `stats_reset` stays `NULL`, so zeroed counters read
  as lifetime zeros. Corrected on Q-534 rather than filed as a duplicate.
- **The 500 MB volume target** — Railway cannot shrink volumes and bills on storage *used*, so 5 GB
  costs what 500 MB would. Withdrawn across three docs so nobody attempts an impossible migration.
- **My own advice to tap Redecode** — I called it idempotent; the guard cannot suppress anything while
  anchors keep moving, and each press cost ~100 MB.

## Filed

**Q-538…Q-551** — renumbered from Q-530…Q-536 on merge after a concurrent planning session held the
same block unmerged, with two entries **folded into that session's Q-534** rather than duplicating it.
`CLAUDE.md` gains a session-start database-size read, because the 500 MB volume was the only thing
making storage fail loudly and it cannot come back.

## Deliberately not done

No code. No option chosen for the owner. D4 not pulled forward. `error_events` (49 MB, residue of an
already-fixed fault) left to age out ~2026-09-12 rather than vacuumed. Q-551 — the Railway-vs-elsewhere
decision — deferred behind Q-545 so it is not decided on a pre-fix, deploy-inflated baseline.

**Not exercised:** nothing ran on the device except the owner's own `rawStats()` read and the six
production presses. All post-vacuum projections were superseded by the real measurement.
