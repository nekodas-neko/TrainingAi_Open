/**
 * `Promise.all`'s shape, run one at a time (Q-308).
 *
 * `getSyncDelta` fans out 24 queries with `Promise.all`. Against a pool of 10 that demands 21–24
 * connections for a single sync, so one user's own queries queue against each other and pay the
 * network hop again on every acquisition. Serialising takes **one** connection at a time and runs
 * to completion.
 *
 * **This is not a trade-off — measured 2026-08-16 with the owner's real RTT (p50 0.86 ms):**
 *
 * | concurrent syncs | parallel p50/p95 · conns | serial p50/p95 · conns |
 * |---|---|---|
 * | 10 | 155 / 161 ms · 210 | **95 / 137 ms · 10** |
 * | 100 | 1,153 / 1,218 ms · 2,100 | **588 / 1,026 ms · 100** |
 *
 * Serial is faster at p50 *and* p95 at every concurrency, with 21× fewer connections. An earlier
 * reading found the two identical; it was taken at 0 ms RTT, where pool queueing dominates and the
 * shapes converge. A realistic hop separates them in serial's favour — the opposite of the risk the
 * backlog entry was written to guard against. Chunking (×4) beat neither.
 *
 * **Deliberately not a transaction.** `db.transaction()` would pin a single client for all 24
 * reads, saving the per-query checkout as well. It also holds that connection for the whole
 * fan-out and puts every read under one snapshot and one `idle_in_transaction_session_timeout` —
 * a larger change to how these reads behave, for a saving the measurement does not show a need
 * for. The demand this exists to cut is *concurrent* connections, and a sequential loop cuts it to
 * one.
 *
 * The signature mirrors `Promise.all`'s so a call site swaps in place and its destructuring keeps
 * exactly the same types — which is what makes this reviewable as "how the reads are issued"
 * rather than "what they return".
 */
export async function inSequence<T extends readonly unknown[] | []>(
  values: T,
): Promise<{ -readonly [P in keyof T]: Awaited<T[P]> }> {
  const out: unknown[] = []
  // A plain loop, not `reduce`: every element is awaited before the next is even touched, which is
  // the entire behaviour. Drizzle's builders are lazy — they do not issue until awaited — so an
  // array of them held here has nothing in flight.
  for (const v of values) out.push(await v)
  return out as { -readonly [P in keyof T]: Awaited<T[P]> }
}
