# 2026-09-23 — DV-10: the missing tombstone, and the column wipe underneath it

**Branch:** `lane-a/dv10-supplement-delete-tombstone` · **Lane A** · `lib/local-store/**` plus the
one call site. No migration, no schema change.

## The entry's measurement was right; its consequence is latent, not live

Device Verification measured it on the S25: deleting a supplement online and offline removed it
from the server and from both lists, but the local row kept `deleted_at: null`. An injury deleted
the same way tombstones correctly.

The entry then said this is *"the 'deleted item comes back' shape (BF-47) waiting for a read path
that does not filter it"*. Checked rather than assumed, and it is **waiting**, not happening:
`getSupplements()` filters `active=1 AND deleted_at IS NULL` — **both** — so the list is right
today, and `applyDelta`'s supplements arm hard-deletes the row on the next pull
(`DELETE … WHERE id = ? AND sync_status='synced'`). The gap is real and worth closing; it is not a
live "my supplement came back".

**It is also not a consequence of DV-5**, which shipped earlier today and touched the *confirm*
arms. Checked, because the two are adjacent.

## The defect the entry did not find, on the same line

The delete called `upsertSupplement({ …the fields this sheet happens to hold, active: false })`.
That upsert writes **every** column, with `?? null` for anything absent — and the rebuilt record
omitted `defaultAmount`, `unit`, `startedOn`, `stoppedOn` and `dosePrompt`.

So **deleting a supplement blanked five columns on the local row.** The one that matters is the
presence window: BF-69's own comment says a date *outside* `startedOn`/`stoppedOn` is a **TRUE
ZERO** while a date inside it with no contribution is **UNKNOWN** and must be excluded from an
aggregate. Nulling them converts one into the other for any local aggregate read between the delete
and the next pull.

It also had a smaller edge: `name: existing?.name ?? ''`, so a delete issued when the list was out
of step would write an empty-named row.

## The fix

`deleteSupplement(id)` on the store, mirroring `deleteInjury`:

```sql
UPDATE supplements SET deleted_at=?, active=0, sync_status='pending', updated_at=? WHERE id=?
```

`active=0` as well as the tombstone, because `getSupplements` filters on both and dropping either
half leaves the row in the list the delete was issued from. `pending` rather than `synced`, because
`applyDelta` prunes only `synced` rows and the push's confirm arm (Q-124) is what flips it — a
delete landing as `synced` would be prunable before its own push had been acknowledged.

An `UPDATE` rather than an upsert is the whole point: an upsert cannot express *"leave the other
columns alone"*, since it always supplies every one.

**Sibling sweep:** `active: false` appears at one other site, `chest-strap-pairing.tsx`, where it is
local React state for a BLE link and has nothing to do with this. One call site to change.

## Mutation pass

| # | mutation | result |
|---|---|---|
| 1 | drop `deleted_at=?` (the tombstone) | killed |
| 2 | delete also blanks `name` | killed |
| 3 | `sync_status='pending'` → `'synced'` | killed |
| 4 | call site reverts to the rebuilt upsert | killed |
| C | `SET` clause reordered, same placeholders | **survived** (correct) |

## Not done, and what is still owed

- **The device check is DV-10's own pass test and has NOT been run here:** on the S25, delete a
  supplement and confirm `SELECT deleted_at FROM supplements WHERE id=…` is set. These tests are
  source-level scans, for the reason their siblings are — both vitest projects run in `node`, where
  `getLocalStore` returns null, so there is no local SQLite to drive.
- **The column wipe is fixed going forward, not repaired in place.** A row already blanked by a
  previous delete stays blanked until the next pull replaces it — which it will, because the server
  row is the source of those fields and `applyDelta` overwrites a `synced` row wholesale.
- **Failure surfaces not exercised:** the device, the APK, and any real offline transition.
