# 2026-09-25 — RV-182 ③: the upsert was already right; the delete in front of it wasn't

**Branch:** `rv182-hr-rollup-churn` · **Lane A**

Every rollup pass ran `DELETE … WHERE source = 'ble' AND timestamp >= cutoff` and then upserted the
window back. Measured on production before changing anything:

- **628,197 inserts · 574,974 deletes · 140,181 live rows** — 4.5× churn
- **95 updates.** Not a typo: the upsert path essentially never fired.

## The entry's fix was already shipped, which is why the churn survived it

RV-182 proposes *"upsert with `IS DISTINCT FROM`"*. `upsertOuraHeartrate` has done exactly that
since review B1/R1:

```sql
ON CONFLICT (user_id, timestamp) DO UPDATE SET … updated_at = now()
WHERE bpm IS DISTINCT FROM excluded.bpm OR source IS DISTINCT FROM excluded.source
```

with a comment saying why — *"so an idempotent re-roll of unchanged points does not churn the
timeseries sync"*. The guard was correct and had no effect, because the delete immediately before it
removed the very rows it was written to match. No conflict, no guard, every row a fresh insert, and
`updated_at` re-stamped on ~880 points per pass — which the Track-B timeseries sync uses as its
cursor, so each pass re-sent a window that had not changed.

**So the fix is not the upsert. It is the order and the scope of the delete**: upsert first, then
remove only the window's `ble` rows whose timestamps are no longer in the series. Same end state,
without destroying the rows to rebuild them — and it restores behaviour the code already had on
paper.

Deleting second also closes a smaller thing: the old order left a window in which the rows were
simply absent.

## The test that would have caught it

Nothing about the row *values* was ever wrong, so a test comparing rows would have passed against the
broken version. `rollup-hr-churn.test.ts` asserts **`updated_at` does not move on an unchanged
re-roll**, which is the only visible difference, plus: `updated_at` moves for exactly the one point
whose bpm changed, a point that left the window is removed, chest-strap rows in the window are
untouched, and rows before the cutoff are untouched.

Mutation pass: restoring the old delete-then-upsert order fails the two `updated_at` cases; dropping
the `source` filter, dropping the cutoff filter, `notInArray` → `inArray`, and inverting the
empty-`keep` guard all fail. An equivalent control (reordering the `and()` operands) survives.

## One thing spelled out rather than left to inference

`notInArray` with no values is not obviously a no-op either way, and reading it wrongly would strand
rows the rollup had dropped. An empty `keep` means the window is genuinely empty, so everything in it
goes — the old blanket delete's behaviour, which is right here. The code says so at the call.

## Verification

- `tsc` clean, `typecheck:tests` at baseline, lint 0 errors, **1056 test files / 9830 tests passed**,
  Custom Rules 78 of 78, build green.
- `deleteBleHeartrateFrom` has exactly one implementation and one caller, both changed; there is no
  second `RollupIO` to update.

**Not exercised:** the rollup itself is not run end to end here — the new behaviour is tested at the
`RollupIO` boundary against real Postgres, and the pass that drives it runs on the server against
real ring frames. **The churn reduction is not yet confirmed in production**: `n_tup_ins`/`n_tup_del`
are lifetime counters, so it will show as their growth rate falls over the coming days, not as a
step change.

## Left alone, deliberately

`oura_heartrate_pkey` is **7 MB with 0 scans**, against 792,453 on the `(user_id, timestamp)` unique
key — dead weight on every insert and delete. Dropping a primary key is a migration and ships alone,
so it is noted in the entry rather than bundled here.
