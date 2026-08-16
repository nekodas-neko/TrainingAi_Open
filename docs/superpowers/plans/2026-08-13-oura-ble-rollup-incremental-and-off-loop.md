# Plan — make the BLE rollup incremental, and stop it running on the request event loop (Q-213)

**Date:** 2026-08-13 · **Domain:** `platform` / `devices`
**Evidence:** [`docs/handoff-2026-08-13-platform-production-event-loop-starvation.md`](../../handoff-2026-08-13-platform-production-event-loop-starvation.md)
**Owner decision (2026-08-13):** build the correct, future-proof fix rather than the cheapest one.

---

## The defect, stated as two independent multipliers

`aggregateOuraRawSamples` costs O(all raw rows in a 35-day window) per invocation, and it is invoked
roughly once per BLE batch. Both halves are wrong, and they multiply.

**1. Work per run.** `ROLLUP_WINDOW_DAYS = 35` against ~37 days of ring history and **984,862 rows**
means every run reads, hex-decodes and re-derives essentially the entire table — to absorb a batch
that typically carries a few minutes of new data.

**2. Runs per unit time.** In `app/api/oura-ble/samples/route.ts` the coalescing guard reads:

```ts
const isFinalOrSmallBatch = result.data.frames.length < DRAIN_BATCH_EVENTS  // 255
if (isFinalOrSmallBatch || now - (lastRollupAt.get(userId) ?? 0) >= ROLLUP_COALESCE_MS) { … }
```

The intent was "always roll up on the drain's **last** batch so the night's tail lands promptly."
The implementation says "any batch under 255 events." Per `docs/oura-ble-operations.md` §2 the ring
drains hourly in 255-event batches, so a routine drain is **1–2 batches and almost always under
255** — the bypass fires on effectively every batch and the 8-second coalescing window protects
nothing. This is a defect, not a tuning constant.

---

## What is already true, and load-bearing for the fix

The function is **already built for a bounded window**; 35 days is just a conservative choice that
aged badly. Three mechanisms already exist and are described in-tree as byte-identical:

- The EMA baseline fold **resumes from a persisted checkpoint** before the window
  (`adapter.ts` ~line 5789), so a narrower window does not change baselines.
- The windowed path **upserts only recomputed days**; older rows and their checkpoints stand.
- The 13-day derived look-back already reads **persisted derived values** (`getOuraDailyDerived`),
  not raw rows.

So narrowing the window is an extension of the existing design, not a new architecture.

**The real binding constraint is not 35 days — it is the HR series.** `HR_SERIES_WINDOW_DS = 14d`:
every run deletes all `source='ble'` rows in the trailing 14 days and re-derives them from the raw
IBI (`0x80`/`0x60`) and aohr (`0x86`) tags — the highest-volume tags in the table. Until that is made
incremental, the raw read cannot go below 14 days.

---

## Design

### Stage 1 — the rollup only recomputes what changed

1. **Pass the touched span in.** `insertOuraRawSamples` already knows the `ds` range it stored. Thread
   an optional `sinceDs` (or `touchedDays`) through `aggregateOuraRawSamples(userId, tz, opts)`. Absent
   ⇒ today's behaviour, so `redecode` and `fullHistory` are untouched.
2. **Bound the raw read to the touched span**, expanded by the minimum overlap the derivations need:
   one day either side, because a sleep window spans midnight and `MAX_SLEEP_DS` caps a night at 16 h.
3. **Make the HR-series rebuild incremental.** Replace the rolling 14-day delete-and-reinsert with a
   delete-and-reinsert scoped to the **touched days only**. The rows are derived, unreferenced and
   owned by the rollup, so per-day replacement is as safe as the current per-window replacement.
   `deleteZoneMinutesFrom` narrows the same way.
4. **Keep the checkpoint seed exactly as-is.** It is what makes a narrow window produce identical
   baselines, and it is already proven.

Expected effect: raw rows read per run fall from ~985,000 to roughly one day's worth (~27,000) — about
a **35×** reduction, and it stops growing with history rather than growing forever.

### Stage 2 — the rollup stops running on the request event loop

Even a cheap rollup should not be able to stall the process. Backgrounding it (today's behaviour) does
**not** achieve this: it stops the rollup holding *its own* response, not starving the next one — which
is precisely how the observed outage happened despite the mitigation being in place.

Move the run into a `worker_threads` worker with its own small `pg` pool (`max: 2`, mirroring the
`claude_readonly` precedent), so blocking is structurally impossible regardless of future data growth.
Two constraints to respect: total connections stay under the Railway limit (`max` × replicas), and
`onnxruntime-node` must be initialised in the worker, not the main thread.

### Stage 3 — fix the coalescing predicate

Replace "any small batch" with a **trailing-edge debounce**: run once shortly after the last batch of a
drain, with a max-wait so a continuous stream still rolls up periodically. That preserves the original
intent (the night's tail lands promptly) while guaranteeing at most one rollup per drain. Keep the
`rollupInFlight` guard.

---

## Sequencing

Stage 1 first — it is the largest win and needs no new infrastructure. Stage 3 next (small, and its
value is easier to see once Stage 1 lands). Stage 2 last: it is the biggest structural change and is
the wrong thing to attempt while production is still unstable.

Stage 1 alone should end the outage. Stages 2 and 3 are what stop it recurring.

## Explicitly not in scope

**Re-persisting `decoded` (reversing Lever 1) is not planned.** It was considered and set aside: once
Stage 1 lands, the per-run decode cost falls by ~35× on its own, so paying disk on a database whose
growth is the binding constraint — and reversing a deliberate decision — buys little. Revisit only if
Stage 1 lands and the residual cost is still material.

## Verification

- The rollup tests already run in their own `rollup` vitest project with a 60 s timeout
  (`vitest.config.ts`); keep any new test inside that glob or it inherits the 5 s default and becomes
  the next false alarm.
- The bar for Stage 1 is **byte-identical output**: roll up a seeded window with and without a
  `sinceDs` bound and assert the persisted `sleep_sessions`, `body_metrics`, `oura_daily` and
  `oura_heartrate` rows match. That is the same standard the existing checkpoint seed is held to.
- Confirm in production afterwards from Railway CPU metrics: the sustained ~1.0–1.6 plateaus should
  disappear. `/api/version` latency is the cheapest ongoing probe — it should stay in milliseconds.
- Not device-verifiable in the sandbox: the BLE plugin and native SQLite do not run here.
