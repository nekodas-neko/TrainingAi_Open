## 2026-08-17 — the redecode reported which query failed and never why (v1.318.3)

Three redecode attempts, three identical reports:

```
redecode error: Failed query: select "id", "anchor_ds", "anchor_utc" from "oura_ble_clock_anchors"
  where "oura_ble_clock_anchors"."user_id" = $1 order by "created_at" desc limit $2
```

No reason, either time. The first was dismissed as load, and that was wrong — it reproduced on
v1.318.2 with the migrations applied and the database idle.

### The blind spot

`aggregateOuraRawSamples` and `redecodeOuraRawSamples` run in a `worker_threads` realm (Q-213), and
an `Error` does not survive structured clone with its prototype — so `rollup-worker-entry.ts`
flattened errors to a string with `err.message` and posted that across the boundary.

That is exactly the wrong half. Drizzle wraps every driver failure in a `DrizzleQueryError` whose
`message` is only `Failed query: <sql>\nparams: …`; the reason lives in **`.cause`**, and `pg` puts
the discriminating part in **`.code`**. So the report named the query and discarded everything that
would identify the fault. A statement timeout (`57014`), a dead pooled connection, a permissions
error (`42501`) and a constraint violation were indistinguishable.

`msg()` now walks the cause chain, appends each `code`, and guards against a cycle.

### What is still not known

**The actual cause of the redecode failure.** This ships the instrument, not the diagnosis. What was
established and can be skipped next time:

- The query is not slow — the same statement runs in **34 ms** against production.
- It is not connection exhaustion — `max_connections` is 500 with **11** in use.
- It is not the migration: 189 and 190 applied at 10:33:52 and 10:34:11, and all **5,383 anchors are
  now epoch 0**, with the merged p10 offset landing **3 s** from the clean value.
- The same method (`getOuraClockAnchor`, `adapter.ts:4530`) is on the incremental rollup path, which
  **succeeded** at 10:21:58 through the same long-lived worker.

So it fails in the worker on the redecode job while working in the worker on the ingest job. A dead
pooled connection on a reused worker fits, and so do several other things; without the cause it is
guesswork, which is what this change ends.

### Not exercised

- **Nothing was run against production**, and the sleep windows are still wrong: the stored nights
  carry `updated_at` of 07:58 and 10:21, both before the migration landed.
- **The new formatting has never flattened a real driver error** — the tests build Drizzle-shaped
  errors by hand. It is verified in shape, not in the field.
