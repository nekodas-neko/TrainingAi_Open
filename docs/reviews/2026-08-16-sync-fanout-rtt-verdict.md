# Q-308 resolved — serialise the sync fan-out

**Date:** 2026-08-16 · **Type:** measurement + recommendation · **Closes:** the open question in Q-308
**Owner input that unblocked it:** Railway per-query RTT, measured from the app service —
**p50 0.86 ms · p95 1.22 ms · min 0.62 ms**

Q-308 said explicitly: *"DO NOT SERIALISE ON THIS EVIDENCE. Measure Railway RTT first."* The
sandbox harness runs over a Unix socket where round-trip is ~0, so serialising 21 queries would add
21 × RTT that the local measurement could not see. **The RTT is now measured and the answer is
clear: serialise.**

---

## 1. The verdict

With a 1 ms per-query network hop simulated (conservative against the measured p50 of 0.86 ms),
against the production pool size of 10:

| concurrent syncs | | **PARALLEL** (today, 21 conn) | **SERIAL** (1 conn) | CHUNKED ×4 (4 conn) |
|---|---|---|---|---|
| **10** | p50 / p95 | 155 / 161 ms | **95 / 137 ms** | 138 / 145 ms |
| | connections | 210 | **10** | 40 |
| **50** | p50 / p95 | 588 / 625 ms | **356 / 607 ms** | 700 / 744 ms |
| | connections | 1,050 | **50** | 200 |
| **100** | p50 / p95 | 1,153 / 1,218 ms | **588 / 1,026 ms** | 1,010 / 1,083 ms |
| | connections | 2,100 | **100** | 400 |

**Serial is faster at p50 and p95 at every concurrency, and uses 21× fewer connections.** At 100
concurrent syncs it roughly halves p50 (588 vs 1,153 ms).

There is no trade-off to weigh. The parallelism is actively harmful.

## 2. Why — and why the earlier reading was wrong

The previous round measured serial and parallel as **essentially identical** at p95 (174 vs 180 ms
at concurrency 10). That measurement had **no RTT at all**, and at 0 ms round-trip the two shapes do
converge — the pool queueing dominates and it doesn't much matter how you arrive at it.

Adding a realistic per-query hop separates them, and it separates them **in serial's favour**, which
is the opposite of the risk Q-308 was written to guard against. The mechanism: a parallel fan-out
demands 21 connections from a pool of 10, so **each sync's own queries queue against each other** as
well as against other syncs. Every one of those waits pays the RTT again on acquisition. Serial takes
one connection and runs to completion — 21 round-trips, but no thrash.

Chunking (batches sequential, queries parallel *within* a batch) lands between the two and beats
neither. It is not worth the extra complexity.

**A correction to how this was measured.** The first chunked implementation ran its queries
*serially within* each batch, which is just serial with extra connection churn, and it measured
worse than serial for that reason. That was a harness bug, not a property of chunking; it is fixed
(`sync-fanout.js`, batches sequential / queries parallel within) and the table above uses the
corrected version. The wrong numbers were never published.

## 3. What this means for Q-107 and Q-213

Both attribute production sync failures to *"DB-pool contention"*. The previous round found that
raising `poolMax` does not help and concluded the pool was not the binding constraint. That still
holds — **but this result reframes it**: the pool is not the constraint because the *fan-out shape*
is. Demanding 21 connections per sync is what creates the contention those entries observed. Making
the pool bigger treats the symptom; serialising removes the cause.

Neither entry is struck. The production faults were real, and a local measurement does not refute a
production diagnosis. But an implementer should read this before assuming pool size is the lever.

## 4. Recommendation

**Serialise `getSyncDelta`'s per-domain reads onto one connection.**

- Replace the single `Promise.all` in `lib/data/postgres/adapter.ts:3362` with a sequential loop on
  one checked-out client.
- Expected effect at current scale (real concurrency ≈ 0–1): **no user-visible change**; a single
  sync goes from ~21 round-trips in parallel to 21 in sequence, about +18 ms.
- Expected effect under any real concurrency: **strictly better latency and 21× less connection
  pressure**, freeing pool headroom for every *other* route that currently competes with sync.
- **Keep the pagination contract** (`packages/shared/src/sync/cursor.ts`, PR #97) untouched — this
  changes how the reads are issued, not what they return.

**Verification after the change:** re-run
`RTT_MS=1 CHUNKS=1 node scripts/load-test/sync-fanout.js 50 10` and confirm connection demand drops
to 1× concurrency with p95 no worse than the table above.

## 5. Surfaces NOT exercised

- **Still local Postgres with a simulated hop.** `RTT_MS` is a `setTimeout`, not a real network. It
  models latency, not Railway's TCP behaviour, TLS renegotiation, or its Postgres CPU profile.
- **Sync-vs-sync only.** In production sync competes with every other route; that contention is not
  modelled and would make the connection-demand argument *stronger*, not weaker.
- No device, no Next request path, no drizzle overhead.
- Synthetic users are uniform; a single heavy user is not modelled.
