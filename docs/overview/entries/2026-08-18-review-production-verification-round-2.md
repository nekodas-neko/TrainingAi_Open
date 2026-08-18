# 2026-08-18 — Review: this run's fourteen findings, checked against production

**Agent:** Review 📖 · **Branch:** `claude/review-production-verification-2` · **Docs-only.**
**Filed:** nothing new · **Amended:** six entries · **Review:** [`docs/reviews/2026-08-18-production-verification-round-2.md`](../../reviews/2026-08-18-production-verification-round-2.md)

## Why

Sweep 8 checked that run's findings against production and corrected four of them. Fourteen more
(Q-473…Q-486) had been filed since, none production-checked. A finding priced on a reachability guess
is a finding priced wrong.

## Q-475 shipped mid-sweep, and the evidence is about the half its fix did not cover

`#115` landed while this sweep was running, taking the option this role recommended:
`isRetryableWriteError` classifies the cause server-side, the client stops counting a retryable
failure against `MAX_MUTATION_ATTEMPTS`, and `serverUnavailable` engages the whole-queue backoff.
**Those are genuinely fixed**, and the Q-475 queue entry was removed.

**`reportServerError` is still only in the route's outer catch** (`app/api/sync/push/route.ts:51`),
which `pushMutations` never reaches because it catches per-mutation by design. Failures reach the
server log but **never `error_events`**. Filed as **Q-487**, scoped to that half — and the production
numbers below are its evidence.

## The production shape is an absence

| Route | Faults in `error_events` | Span |
|---|---|---|
| `/api/sync/pull` | **69** | 2026-07-19 → 2026-08-13 |
| `/api/sync/push` | **0** | none, ever |

Over the same window the database refused connections **125 times across six days** (39 on
2026-08-12), one pull row reading `[cause: timeout exceeded when trying to connect]`.

**The zero is evidence, not absent traffic.** `components/sync-provider.tsx` runs
`await pushMutations(userId)` at :139 and `pullDelta` at :145 — push first, same cycle. Push is not
less exposed than pull; it runs before it. So the zero means **push cannot report**, which is exactly
what Q-475 says: `pushMutations` catches per-mutation, returns 200 with the failure in the body, and
never calls `reportServerError`. The one table designed to catch faults that never reach a human has
a blind spot precisely where that finding lives.

This raises the priority argument and does not change the fix.

## The rest

- **Q-482, Q-483 — never triggered.** Zero `22P02` rows ever, so a malformed route id has not reached
  production and the SQL-leaking 500 has never been served. Both were filed low; do not re-price them
  upward from the local 500s alone.
- **Q-484 — latent confirmed.** `claude_ro.injuries` is **empty**. The route that accepts a 10 MB note
  has stored nothing at all.
- **Q-481 — unprovable from production.** 4 days with water logged, max 1000 ml. Too thin for a
  double-count to show. Read it as the feature being unused, not as the replay not happening.
- **Q-485 — unprovable, and the obvious query is a trap.** 35 of 114 rows have steps and a NULL
  weight, which is the *expected* shape (steps daily from the ring, weight only on scale use). It must
  not be cited as evidence of coerced-away weights — the same trap as sweep 8's Q-460 ("74% lack an
  RPE"), recorded here so the next reader does not pick it up.

## The standing constraint

`claude_ro` is row-scoped to one user and `error_events` prunes at 30 days. Every count is *the
owner's, recently* — a zero means the owner never hit it, never that no user did. Push traffic
*volume* could not be measured directly; the argument that push runs at all is from the call site, not
a counter.
