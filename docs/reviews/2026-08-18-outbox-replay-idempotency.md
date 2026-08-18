# Review — replaying an outbox mutation: which domains double-count?

**Date:** 2026-08-18 · **Agent:** Review · **Lens:** at-least-once delivery
**Findings filed:** Q-481 · **Clean results recorded:** three

## Why this lens

Sweep 9 measured *concurrent* writes and sweep 10 measured the outbox under *failure*. Neither
measured the thing that sits between them: **the same mutation arriving twice, in sequence**, which
is what at-least-once delivery guarantees will eventually happen.

It is reachable by ordinary means. `lib/local-store/sync-engine.ts`:

```ts
try {
  res = await fetch('/api/sync/push', { … });
} catch {
  break;          // network gone — stop; remaining mutations retry next sync
}
```

If the request **reaches the server and commits** but the response never arrives — signal dropped
mid-response, the OS killing a backgrounded app, a timeout — the `catch` fires, the loop breaks, and
the mutation is still `status='pending'`. Nothing marks it in-flight. The next sync pushes it again,
and the server has already applied it. On a phone on mobile data, which is the canonical runtime,
this is a routine Tuesday.

The server has **no dedupe on mutation id**: `pushMutations` echoes `mut.id` back in error entries
and never records that it processed one.

Method: push a mutation with a **fixed id** three times in sequence and read the row.

---

## Finding (Q-481) — `waterMlDelta` is the one payload that triple-counts

```
3 × identical push, id "water-fixed-id-001", payload {"waterMlDelta": 250}
→ body_metrics.water_ml = 750
```

250 ml logged; 750 ml stored. Every push returned `{"processed":1,"errors":[]}`.

The write itself is correct and deliberately so — `incrementWaterLog` (`adapter.ts:2761`) does the
addition **inside** the upsert:

```ts
set: { waterMl: sql`COALESCE(${s.bodyMetrics.waterMl}, 0) + ${ml}` }
```

and the push branch routes to it on purpose, with a comment saying why: *"a `waterMlDelta` payload …
is an increment, not an absolute set — so concurrent adds sum instead of last-writer-wins clobbering
each other (SYNC-P7)."* That reasoning is right and should not be undone. Atomic-and-additive is
exactly what you want for concurrency; it is also exactly what makes a **replay** wrong.

**This is the only such path.** All 19 push branches were enumerated and the three most likely
alternatives were replay-tested (below) — every other domain either upserts on `(user_id, date)` or on
a client-supplied row id, so replaying it converges.

### What it costs

Silent over-counting of a tracked metric, with no way for the user to notice: 750 ml is a plausible
number. It corrupts the day's hydration total, the water goal's progress, and anything downstream
that reads `water_ml`. Not health-critical — hydration is a soft metric — but it is unrecoverable
after the fact, because nothing records how many times the delta was applied.

### Fix shape

**Keep the delta.** The additive form is load-bearing for concurrency (SYNC-P7) and swapping to an
absolute total reintroduces the clobber it was written to prevent.

The targeted fix is **server-side dedupe on the mutation id, for the non-idempotent branch only** — a
small `applied_mutations(user_id, mutation_id, applied_at)` table with a unique constraint, checked
before the increment and inserted in the same transaction. It does not need to cover the other 18
domains, which are naturally idempotent, so it stays small and its pruning story is simple (rows older
than the outbox's own retention are dead).

That is a schema change, so **Lane A owns it**. If it is judged not worth a table, the honest
alternative is to accept the drift and say so in `CLAUDE.md`'s Stored Counters section — but note that
section's own opening line is *"Every stored counter in this project has drifted"*, and this is one.

---

## Clean results

Replay-tested the same way, three identical pushes each:

- **`complete_workout` → `sessions_in_phase` = 1.** This is the second independent confirmation of the
  Q-473 fix, and it covers the vector the original code comment specifically named — *"an outbox
  mutation re-pushed after its response was lost"*. Sweep 9's re-run covered the concurrent vector;
  this covers the replay one.
- **Absolute `body_metrics` (`weightKg`, `steps`) → one row, correct values.** Upsert on
  `(user_id, date)`, idempotent.
- **`activity_logs` → one row.** Idempotent because the *outbox* payload carries a client-generated
  row `id` and the branch upserts on it.

That last one is worth a note, because it looks like it contradicts sweep 9: `POST /api/activity-logs`
duplicates freely under concurrency (5 concurrent → 5 rows), while the **outbox** path for the same
domain does not. They are different writers — the web route mints a server-side id, the outbox
supplies its own. Not a defect in either; a thing to know before reasoning about one from the other.

## Not verified

Local `pnpm dev`. The replay was simulated by re-posting the same envelope, which is exactly what the
client does — but the *client-side* trigger (a `fetch` that throws after the server committed) was
read from source, not induced. Not on the APK. The other 15 push branches were not individually
replay-tested; they were read, and each upserts on a stable key.
