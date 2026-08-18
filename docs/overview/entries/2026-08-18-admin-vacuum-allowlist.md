# 2026-08-18 — `VACUUM FULL` on an allowlisted table (Q-315, route half)

**Lane A** · branch `fix/generalise-vacuum-reclaim` · no migration, no Kotlin, no APK.

`error_events` holds **4 live rows in 49 MB** in production (measured 2026-08-18) — 12 MB heap, ~36 MB
TOAST, **6% of the whole 819 MB database**. Q-539 diagnosed the cause (one fault wrote 5,771 rows
because the dedupe key varied with a generated `VALUES` list, each message truncated to exactly 2,000
chars of `(default, $N, $N),` boilerplate), fixed the write path, and the rows were pruned. MVCC left
the dead tuples, so the file never shrank. **Nothing re-grows — this is a one-off reclaim.**

The existing admin button only vacuumed `oura_raw_samples`. Generalised rather than copied, because
the same operation is now wanted in three places: after Q-541's packing backfill deletes the hot
rows, after migration 193's index drop, and here.

## The design point

`VACUUM` accepts no bind parameter, so the table name is **interpolated into the statement**. That
makes the allowlist the safety boundary rather than validation, and it is checked in both the route
and the slice.

It is checked with `hasOwnProperty`, not `in` — `'toString' in obj` is true for every object, so an
`in` check accepts `toString`, `constructor` and `__proto__`. There is a test for exactly that, and it
is **mutation-checked**: swapping the guard to `in` turns it red.

The allowlist is also a judgement list, not only a safety one. `VACUUM FULL` takes an ACCESS
EXCLUSIVE lock and needs free disk equal to the table's current size, so it belongs on tables where a
deliberate, owner-pressed rewrite is the right tool — and the entries carry *why* each is there.

`liveRows` is reported alongside the byte counts, because a huge `before` against a handful of live
rows is the signature of pure bloat, which is a different situation from a table that is genuinely
large.

## Verification

- 4 tests: the allowlist rejects a plain wrong name, a SQL-injection-shaped name, an empty string and
  the four `Object.prototype` keys; it lists exactly the two intended tables; and a real run against
  the dev database reports honestly **and leaves the pool's `statement_timeout` intact** — the slice
  lifts it for its own connection and destroys that connection with `release(true)`, so a
  timeout-disabled client never returns to circulation.
- **Live on `pnpm dev`**: `GET` lists both tables; a disallowed name and a missing body both 400 with
  the allowlist echoed; unauthenticated 401; the rate limit 429s at 4/min; and a real run on the
  local `oura_raw_samples` reclaimed **5.7 MB of 6 MB**.
- Full suite **487 files / 3,967 tests passed** · `tsc --noEmit` clean · `pnpm check:rules` 38 of 38.

## What is still owed — this is the half that matters

**Nobody has pressed it against production, so the 49 MB has not been reclaimed.** There is no
button — `components/oura-ble/db-footprint-card.tsx` is Lane B's, filed as Q-316 — so until then it
is a curl with an admin session cookie:

```
POST /api/admin/vacuum   {"table":"error_events"}
```

Read `pg_total_relation_size('error_events')` and `count(*)` either side; do not assume the row count
is still 4 by the time it runs.

## Failure surfaces NOT exercised

- **Production.** Every measurement above is against the local dev database, where `error_events` is
  24 kB and empty — so the local `error_events` run reclaimed nothing, correctly. The 5.7 MB reclaim
  was on the local `oura_raw_samples`, which had accumulated real bloat from this session's churn.
- **Free-disk failure.** `VACUUM FULL` needs room equal to the table's current size; the route
  surfaces a failure as a 500 rather than a 200, but that path has not been triggered.
- No device, no Kotlin, no APK.
