# 2026-08-23 — The sync fan-out demanded 24 connections to save 8 ms (Q-308)

**Branch:** `perf/sync-fanout-connection-demand` · **Lane A** · server only

`getSyncDelta` issued its 24 reads with `Promise.all`. Against production's pool of 10 that demands
21–24 connections for **one** sync, so a single user's own queries queue against each other and pay
the network hop again on every acquisition.

The whole fan-out is **22.6 ms of query work** (serial, warm, one user — `set_logs` at 5.4 ms is the
most expensive of 21). The parallelism was spending 21 connections to save about 8 ms.

## Measured on this change, not restated from the entry

A test samples the real pool while `getSyncDelta` runs. With `Promise.all` restored:

```
peak connections over baseline: 14 queued waiting   ← for ONE sync
with inSequence:                1, zero waiting
```

**Fourteen of a single sync's own queries were queued behind an exhausted pool.** That is the
mechanism Q-107 and Q-213 both recorded as "DB-pool contention" — and it is the fan-out shape
creating the contention, not the pool being too small.

The committed harness, at the RTT the owner measured from the Railway app service:

| 50 concurrent syncs, pool 10 | connection demand | p50 | p95 | worst pool wait |
|---|---|---|---|---|
| parallel (before) | 1,050 — 105× over-subscribed | 377 ms | 625 ms | 645 ms |
| **serial (now)** | **50 — 5×** | 399 ms | **591 ms** | 531 ms |

**p50 is 22 ms worse and p95 is 34 ms better.** The entry's own table had serial ahead on both; this
run has it ahead on the tail only. Reported as measured rather than as predicted — the shape of the
result is the same (serial trades a higher floor for a shorter tail, min 130 ms vs 37 ms) and the
21× connection cut is not in question either way.

## Two things deliberately not done

**Not a transaction.** `db.transaction()` would pin one client for all 24 reads, saving the
per-query checkout too. It also holds that connection for the whole fan-out and puts every read
under one snapshot and one `idle_in_transaction_session_timeout` — a larger change to how these
reads behave, for a saving nothing measured asks for. The demand this exists to cut is *concurrent*
connections, and a sequential loop cuts it to one.

**Not chunking.** ×4 chunking was measured and beat neither shape.

## `inSequence` mirrors `Promise.all`'s signature

Deliberately, so the 24-way destructuring at the call site keeps exactly the same types and the diff
reads as *how the reads are issued* rather than *what they return*. The pagination contract
(`packages/shared/src/sync/cursor.ts`) is untouched.

Both fan-outs in `getSyncDelta` are converted — the 24-query one and the 5-query nested
program/style subtree below it.

## Verified

- **6 helper tests.** The one that matters asserts nothing overlaps, using a thenable whose
  resolution is deferred: with a synchronous resolve both shapes look identical, because
  `Promise.all` iterates in order too. Restoring `Promise.all` inside the helper fails 2 of the 6.
- **2 DB-backed tests**: the connection-demand measurement above, and a guard that every domain the
  delta contract names is still present — serialising must not change what comes back.
- Full suite 552 files / 4,556 tests; `pnpm check:rules` 54 of 54.

**Expect no user-visible change at current scale.** Real concurrency is 0–1, so this is about
+18 ms on a single sync and strictly better behaviour under any load.

**Not exercised:** the APK, and production. The measurement is a local Postgres over a unix socket
with the hop simulated at the RTT the owner measured; the harness models the fan-out rather than
calling `getSyncDelta`, which is why the pool-sampling test exists beside it.

## Re-frames Q-107 and Q-213 without striking them

Both attribute production sync failures to DB-pool contention. On this evidence **the pool is not
the binding constraint** — a bigger pool measured slightly *worse* (50 concurrent: max 10 → 778 ms
p95, 20 → 803, 40 → 952). Raising `max` would spend Railway connection budget for nothing. Read this
before assuming pool size is the lever.
