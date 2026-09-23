# 2026-09-24 — DV-15: a stale pull could undo a delete, on nine arms

**Branch:** `lane-a/dv15-stale-pull-resurrection` · **Lane A** · `lib/local-store/sqlite-backend.ts`
and one new test. No migration, no schema change, no client change. **DV-15 stays queued** for its
device pass test.

## The entry's suspected shape was exactly right

That is worth saying plainly, because it has been rare. DV-15 wrote:

> *a pull that fetched the pre-delete row, applied after the push confirmed the delete and flipped
> the row to `synced` — so the `sync_status === 'synced'` gate let it overwrite. Needs one
> reproduction with the pull/push ordering captured.*

Every clause of that holds, and the reproduction confirms it rather than amending it.

## Reproduced deterministically, against real SQLite

`markFoodLogSynced` is `UPDATE food_logs SET sync_status='synced' WHERE id=?` — it flips the
tombstone and **keeps the row**. That is what opens the window: the clobber guard is now satisfied.
Then a pull fetched before the server delete lands, takes the else-branch, and its
`deleted_at=excluded.deleted_at` writes NULL over the tombstone.

```
after push confirm: { deleted_at: '…10:30:55.419Z', sync_status: 'synced' }
after stale pull:   { deleted_at: null, sync_status: 'synced', updated_at: '…10:30:45.000Z' }
>>> RESURRECTED — the deleted food is back, and marked synced
```

The device reading was `deleted_at NULL`, `sync_status 'synced'`. Identical. Note `updated_at` also
rolls **backwards** — the pre-delete value overwrites the delete's.

Because the row is `synced`, nothing will ever push it again; it stays until some later pull happens
to carry the tombstone past the cursor.

## The fix, and the fix that was rejected

One clause: **`AND <table>.deleted_at IS NULL`**.

A timestamp comparison (`excluded.updated_at > <table>.updated_at`) would also close it and is
deliberately not used. The local tombstone's `updated_at` is **device**-set; the incoming row's is
**server**-set. Clock skew would decide whether a delete survives. *We hold a tombstone, so a row
without one is stale* needs no clock at all.

## The sibling sweep, classified rather than guessed

Nine arms write `deleted_at=excluded.deleted_at` and so can clear a tombstone — `body_metrics`,
`mood_logs`, `fitness_tests`, `prescribed_runs`, `food_logs`, `supplements`, `supplement_logs`,
`injuries`, `day_checkins`. All nine now carry the clause.

Four other delete-bearing arms — `workout_sessions`, `exercise_logs`, `set_logs`, `activity_logs` —
**never SET `deleted_at` in their update arm**, so a tombstone they hold already survives a stale
pull. Left alone, and the test says why so nobody "finishes the job" later.

## The test drives the real statement

`dv15-stale-pull-cannot-resurrect.test.ts` extracts the upsert **out of `sqlite-backend.ts` at test
time** and runs it against `node:sqlite`. It cannot drift from the implementation and cannot pass
against a copy that has since been edited — which is the failure mode of the source-scanning
siblings in this directory (they exist because `getLocalStore` returns null in node; the SQL does
not need the native layer).

It also pins the two things the guard must not cost: an ordinary pull still updates a live row, and
a `pending` local edit is still protected by the original half of the guard.

## Mutation pass

| # | mutation | result |
|---|---|---|
| 1 | `food_logs` guard removed (the defect restored) | killed — 2 tests |
| 2 | guard REPLACES the `sync_status` half instead of adding to it | killed — 2 tests |
| 3 | one sibling (`injuries`) loses its guard | killed — the sweep |
| C | the two conditions written in the opposite order | **survived**, after a fix |

**The control failed first time — the fourth time today.** The sweep assertion pinned the exact
string `WHERE t.sync_status='synced' AND t.deleted_at IS NULL`, so an ANDed reorder that changes
nothing broke it. It now checks the clause contains both conditions, in either order. Four for four
on this mistake (TN-60, RV-82, DV-13, here) is a habit, not a slip: the assertion gets written by
copying the line just added instead of stating the rule it is meant to hold.

## One window left open, deliberately

The guard protects a tombstone the device **still holds**. If a server tombstone delta has already
hard-DELETEd the local row and a stale pull arrives after that, the INSERT re-creates it with
nothing to guard against. Narrower — it needs those two in that order — but real, and recorded on
the entry. Closing it wants a local tombstone that outlives the row, which is a schema change and
its own item.

## Failure surfaces not exercised

**The device, which is where this was found.** The reproduction is of the SQL, not of the timing
between phone and server, so DV-15's pass test — log and delete a food five times in quick
succession — is still owed and the entry keeps it.
