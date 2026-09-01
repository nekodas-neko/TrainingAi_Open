# 2026-09-01 · Lane A — 21 MB of index for a code path nothing calls (BF-55)

Branch `lane-a/drop-unused-hr-index`. Migration **249**, one `DROP INDEX`. No runtime code changed.

## What it was

`oura_heartrate_user_updated (user_id, updated_at, id)` — migration 130's keyset-pagination index
for `getOuraTimeseriesDelta`, the Track-B restore pull. That method's own doc comment records the
**Q-180** decision to keep it despite having no production caller, on three measured grounds, the
third being that *"it costs nothing at runtime"*.

That was true of the **method**. The index was never in the accounting.

## Measured against production, twice, a day apart

| | |
|---|---|
| `oura_heartrate_user_updated` | **`idx_scan` 0 · `idx_tup_read` 0 · 21 MB** |
| `oura_heartrate_user_id_timestamp_key` (same table) | 47,922 scans · 22.7 M tuples read · 9.7 MB |
| whole database | 84 MB index against 63 MB heap |

So it is a quarter of the entire index budget, on a table that is anything but idle, taking write
amplification on the app's highest-volume insert. It had also grown between the two readings —
18 MB on 2026-08-30, 20 MB, then 21 MB — so the cost compounds while the caller does not exist.

The owner approved the drop conditionally: *"yes if we are not using it and you are sure its
reversible then get rid of it."* Both halves were re-verified here rather than taken from the entry:
`getOuraTimeseriesDelta` is referenced by its own tests, the adapter and the repository interface,
and **invoked by nothing**; the index is a plain btree, one statement over 9.6 MB of heap.

## The correction inside the entry, which is the part worth keeping

The entry opened with *"an index never scanned is a candidate to drop"* and then **falsified its
own rule**. `idx_scan` counts **reads**, not constraint enforcement — a PRIMARY KEY or UNIQUE index
is consulted on every insert to reject a duplicate, and that work never touches the counter.

Three of the four zeros in its first table were constraints. `rr_intervals_pkey` read **0** on
2026-08-30 and **5,034** the next day; `oura_heartrate_pkey` reads 0 today and is the primary key.
Had "never scanned" been applied as a rule, this change would have dropped constraints.

Only one index goes, and the test asserts the survivors by name rather than checking that *some*
index remains.

## The guard that matters is a paragraph, not an assertion

`getOuraTimeseriesDelta` still works without its index — it falls back to a scan, which is fine at
test size and is **not** fine over 87 k production rows. So its existing tests pass either way and
nothing would notice a slow restore until someone investigated one.

The doc comment now carries the `CREATE INDEX` statement and says the driver must recreate it in the
same change. The test asserts the comment is still there, because **a paragraph is the only guard a
not-yet-written driver can have** — and it also pins the retraction, so the "costs nothing at
runtime" sentence cannot quietly return to meaning the index too.

Mutation-tested three ways: removing the `CREATE INDEX` line from the comment, rewording the
retraction, and recreating the index in the database each turn it red.

## Not done

The other half of BF-55 — the ~2.9 MB/day growth against a ~0.4 MB/day expectation — is untouched.
This removes 21 MB and one write-amplification source; it does not explain the trend. At Railway's
$0.15/GB/month the whole database is about three cents a month, so the reason to act is that a 7×
trend compounds, not that the bill hurts.

**Not exercised:** nothing runtime changed, so there is no app or device surface. The `DROP INDEX`
has run against the local dev database via the migration runner, not against production — Railway
applies it on the next cold start.
