## 2026-09-08 — The ingest route that must never wait, and PS-39's shortlist is now empty (PS-39)

**Branch:** `test/oura-ble-samples-coverage` · **Lane A**

### What shipped

7 tests on `POST /api/oura-ble/samples`; `BASELINE` **142 → 140**. That clears the last route on
PS-39's named actionable core — the home aggregates, `program-week`, and both ingest routes are done.

**The baseline drops by two, not one.** Q-112d landed on `main` while this was in flight and took
`day-review/week-window` off as well, so the merged number is 140. Their finding is the more
important half and it is now in the entry: **the scan's rule is wrong, and the debt it reports is
overstated by about 15.** It asks whether a test contains the substring `app/api/<route>/route`,
which a *relative* import never produces — so fifteen routes with a co-located test loading the
handler as `await import('../route')` read as untested, `sync/push` and `sync/pull` among them. The
real debt is nearer 126. Nothing here fixes that; the entry now says so at the top, because a list
claiming `sync/push` is untested is one nobody should work from.

### The test worth having

**The response never awaits the rollup.** The route's own comment traces why: the rollup got heavy
(SleepNet ONNX inference, #722), a >30 s pass trips the native client's 30 s `readTimeout`, that
reads as a non-2xx, and the ring's history cursor only advances on 2xx — so the same batch re-drains,
re-runs the rollup and saturates the DB pool. A self-sustaining retry storm that starved the outbox
sync and stalled the sleep-staging write (I19/I20, and the 2026-08-13 outage). Nothing checked that
it still doesn't.

The test makes `runRollupOffLoop` return a promise that **never settles**. If the handler ever awaits
it — or anything chained off it — the request cannot complete. Mutation-checked by putting the await
back: four tests fail, each hanging for the full 5 s, which is the outage's own shape reproduced in
a unit test.

Two more that pin subtle behaviour rather than obvious behaviour:

- **A failed rollup puts its span back.** A run claims the pending span and clears it; if it throws,
  the span must be restored or the next run re-derives from the newest batch and silently skips
  everything the failed one covered. Pinned by failing a rollup at `sinceDs: 500`, then posting a
  batch at `9000` and asserting the next run still starts from **500**.
- **A burst coalesces into one rollup over the whole span.** The plugin drains history in ~255-event
  batches, one POST each; re-rolling per batch is the waste the debounce removes, and the span still
  has to reach the earliest batch.

### Verification

- `pnpm check:rules` — **Ran 70 of 70**. `tsc --noEmit` clean, `check-test-typecheck` at baseline,
  `pnpm build` exit 0, full suite green.
- **Mutation-checked twice**: awaiting the rollup hangs four cases; deleting the span-restore fails
  the span case.
- One fixture was wrong first and the schema caught it — frames `'good'`/`'bad'` are not valid hex,
  so the request 400'd before the decoder was reached and the case tested the regex rather than the
  skip it was written for.

**Not exercised:** mocked repository, mocked admin guard, and the decoder is stubbed so the tag can
be chosen — `historyEventFromHex` has its own byte-exact tests against captured ring hex, and these
are about the route's scheduling rather than the protocol. The rollup itself never runs here; what is
pinned is that the response does not wait for it.

No version bump: tests only.
