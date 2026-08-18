# 2026-08-18 — Review: replaying an outbox mutation

**Agent:** Review 📖 · **Branch:** `claude/review-concurrency-round-2` · **Docs-only.**
**Filed:** Q-481 · **Review:** [`docs/reviews/2026-08-18-outbox-replay-idempotency.md`](../../reviews/2026-08-18-outbox-replay-idempotency.md)

## The gap this fills

Sweep 9 measured *concurrent* writes; sweep 10 measured the outbox under *failure*. Neither measured
what sits between them — the same mutation arriving **twice in sequence**, which at-least-once
delivery guarantees will eventually happen.

It is reachable by ordinary means. The client wraps its push in
`try { res = await fetch(…) } catch { break }`, so a request that reaches the server and **commits**
but whose response is lost — signal dropped mid-response, the OS killing a backgrounded app, a
timeout — leaves the mutation `status='pending'` with nothing marking it in-flight. The next sync
pushes it again. The server keeps no record of processed mutation ids. On a phone on mobile data,
which is the canonical runtime, this is routine.

## Q-481 — `waterMlDelta` is the one that double-counts

Same mutation id, three pushes, each answering `{"processed":1,"errors":[]}`:

```
payload {"waterMlDelta": 250}  ×3  →  body_metrics.water_ml = 750
```

The write itself is correct and deliberately so: `incrementWaterLog` does the addition inside the
upsert, and the push branch routes to it on purpose — *"an increment, not an absolute set … so
concurrent adds sum instead of last-writer-wins clobbering each other (SYNC-P7)."* Atomic-and-additive
is right for concurrency and is exactly what makes a replay wrong. **The fix is mutation-id dedupe for
that one branch, not a change of semantics** — swapping to an absolute total reintroduces the clobber
SYNC-P7 was written to prevent, and the entry says so in bold because it is the way this gets
implemented wrongly.

All 19 push branches were enumerated; every other domain upserts on `(user_id, date)` or on a
client-supplied row id.

## Three clean results, one load-bearing

- **`complete_workout` replayed 3× → `sessions_in_phase` = 1.** A second independent confirmation of
  the Q-473 fix, covering the vector its original comment specifically named — *"an outbox mutation
  re-pushed after its response was lost"*. Sweep 9's re-run covered the concurrent vector; this
  covers the replay one.
- **Absolute `body_metrics` (`weightKg`, `steps`) → one row, correct values.**
- **`activity_logs` replayed 3× → one row.** This looks like it contradicts sweep 9, where
  `POST /api/activity-logs` gave 5 rows for 5 concurrent calls. It does not: **different writers.**
  The web route mints a server-side id; the outbox payload carries a client-generated one and upserts
  on it. Neither is a defect — worth knowing before reasoning about one from the other.

## Not verified

Local `pnpm dev`. The replay was simulated by re-posting the same envelope, which is exactly what the
client does, but the client-side trigger was read from source rather than induced. Not on the APK.
The other 15 branches were read, not individually replay-tested.
