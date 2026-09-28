# 2026-09-28 — DV-19: why one walk was three rows, and the two sync defects behind it

## The trace

Device Verification found the 24 Sept treadmill walk as three local rows, and listed twice. The
production rows, read through the read-only endpoint, gave the timeline: `b8083d04` was created
**09:18:27, as the walk started**, with the plan's 40 minutes. `d0231b08` was created 09:59, as it
ended. The device's `4b5c23e0` (updated 09:19:12.887) and the server's `b8083d04` (updated
09:19:13.245) are the same push, 0.4 s apart.

- **The 09:18 row** is a walk ended within seconds and saved at the plan's duration. That is BF-190
  and BF-191 (#1570), which shipped the next day. It was not rebuilt.
- **The orphan** is the push merging on `(user, date, start_time)`. `saveActivityLog`'s overwrite path
  targets that index so a same-minute collision merges instead of wedging the outbox. It keeps the
  server row's id, so the device row it came from is confirmed `synced` and never comes back from
  the server.
- **Two saves 45 s apart** point at `WalkSummary` saving on every mount. Left for Lane B on the entry.

## The fixes

- `sqlite-backend.ts` `applyDelta`: applying a live server activity deletes any other `synced` row at
  the same date and start second. A pending row is kept (its push has not happened), and so is a row
  at another second (the server can hold both). This is the same shape LA-165 gave `set_logs`.
- `adapter.ts` `saveActivityLog`: the index the merge targets covers tombstones, so a new activity at
  the minute of a deleted one landed on the deleted row and stayed deleted. `deleted_at` now clears
  when the incoming id differs. A stale edit to the deleted activity itself carries the same id, so
  delete still wins over it.

Swept the other natural-key upserts. `body_metrics` is keyed by date on the device, and manual
`supplement_logs` carry a local unique index on the same key, so `activity_logs` was the only
id-keyed local table with a natural-key merge.

**Mutation pass:** never revive, always revive (typed NULL), no pending guard, compare the minute
only, and no retire were all killed. The control, `length < 6` for `= 5`, survived.

## Not exercised

The device path. `getLocalStore` is null on the web, so it has a Known-Issues row with the S25 pass
test. The owner's existing orphan clears when `b8083d04` is deleted or changed.
