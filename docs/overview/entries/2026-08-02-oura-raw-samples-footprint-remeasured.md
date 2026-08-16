# 2026-08-02 — Q-35 measured against production, and retired (docs-only)

**Branch:** `fix/oura-raw-samples-footprint` · Run-list item 5 of the
[batch queue drain](../../handoff-2026-08-02-platform-batch-queue-drain.md). **No code changed.**

Q-35 was taken to be implemented. Both of its findings were measured against production first — per
the backlog's own "re-verify the plan against current `main` before implementing" rule — and both
turned out to be dead. Building it would have been a no-op and a regression respectively. The entry
is removed, and what the measurements *do* justify is filed as **Q-46**.

## Finding 1 — already done, by something broader

> *"Stop JSON-decoding `motion_event`/`motion_period` — worst hex→JSON expansion ratio (14–24×) of
> any tag."*

`decoded` is not persisted for **any** tag. `insertOuraRawSamples` hard-codes `decoded: null`
(adapter.ts, "Lever 1 (ingestion culling)"), and production agrees:

```
SELECT count(*) AS total, count(decoded) AS with_decoded FROM oura_raw_samples
→ total 740,966 · with_decoded 0
```

Lever 1 superseded this finding for every tag at once, not just the two motion ones. The backlog
entry's 2026-07-30 re-verification checked that `decoded` is *still a JSONB column in the schema* —
which it is — and read that as the finding still being live. The column exists; nothing writes to it.

## Finding 4 — would make the table bigger, and its numbers were ~10× stale

> *"Replace the dedup unique index's embedded full-text `body_hex` with a generated
> `body_hex_hash bytea GENERATED ALWAYS AS (digest(body_hex, 'sha256')) STORED` — ~9.7 MB of the
> table's ~30 MB of indexes today."*

Production, today:

| | size | scans |
|---|---|---|
| `idx_oura_raw_samples_user_measured` | **107 MB** | 3,165 |
| `oura_raw_samples_user_id_ring_timestamp_ds_tag_body_hex_key` (the dedup index) | **99 MB** | 478,289 |
| `oura_raw_samples_user_tag_ts` | 67 MB | 1,586 |
| `oura_raw_samples_pkey` | 33 MB | 111,909 |
| **table total** | **452 MB** (heap 146 MB + indexes 306 MB) | |

So the indexes are 306 MB, not ~30 MB, and the dedup index is 99 MB, not ~9.7 MB.

More importantly the swap is backwards. `body_hex` averages **24 characters** (max 28) — roughly 28
bytes stored. A sha256 is **32 bytes**. The replacement key would be *wider* than what it replaces,
and the generated column adds those 32 bytes per row to the heap as well (~24 MB), paid for with an
`ACCESS EXCLUSIVE` full-table rewrite of a 452 MB table during `ensureSchema` at deploy. Every part
of that is the wrong direction. A narrower digest (md5, 16 bytes) would save ~6 MB at best — about
6% of one index, for the same rewrite and lock.

## What the numbers actually point at (filed as Q-46)

```
n_live_tup 740,966 · n_tup_upd 1,324,792 · n_tup_hot_upd 19
```

**1.3 million updates against 741k rows, and 19 of them were HOT.** A non-HOT update rewrites an
entry in *all four* indexes. That is where 306 MB of index came from.

The cause is in the code and is not subtle: `redecodeOuraRawSamples` re-stamps `measured_at` over
every row in each page with no `IS DISTINCT FROM` guard, and `measured_at` is indexed — so a
re-stamp can never be HOT, even when it writes back the value already there.

Against ideal key widths the dedup index should be ~49 MB (actual 99 MB) and `user_measured` ~28 MB
(actual 107 MB) — roughly **130 MB of bloat**, ~29% of the whole table, recoverable by `REINDEX`
with no migration at all. Added to the owner's console checklist next to the `VACUUM` already
queued there.

Q-46 covers the code half: guard the re-stamp so an unchanged value is not written back. That is a
one-line `WHERE` clause and it stops the bloat re-accumulating after the REINDEX.

## Note for whoever picks up Q-30

Q-30's Finding 4 (converting `body_hex` itself TEXT→bytea) is a different change and was already
declined by the owner. Nothing here revives it — but the sizes above are the current numbers to
reason from, not the ~30 MB figure both entries were written against.
