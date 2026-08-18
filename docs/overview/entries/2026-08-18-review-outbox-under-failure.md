# 2026-08-18 — Review: the outbox under failure

**Agent:** Review 📖 · **Branch:** `claude/review-outbox-failure` · **Docs-only.**
**Filed:** Q-475, Q-476 · **Review:** [`docs/reviews/2026-08-18-outbox-under-failure.md`](../../reviews/2026-08-18-outbox-under-failure.md)

## What this sweep was for

`CLAUDE.md`'s **Offline Sync** block is the longest rule set in the file, and its core rule is blunt:
*"One bad mutation must never wedge the queue (3 production incidents). A 4xx/validation failure is a
poison pill … 5xx/429 = back off and retry."* Nine sweeps had run under this role and **none had ever
posted a batch to `/api/sync/push` and read what came back.** This one did, including one push with
the database stopped.

## The good news first: the poison-pill rule holds

Five mutations, poison placed third so four siblings sit behind it → `processed: 4`, one error keyed
by **outbox id**, and all four sibling rows written to `body_metrics`. Enforced at both layers — the
route's per-mutation `safeParse` and the adapter's per-mutation `try/catch`. The rule that cost three
production incidents is genuinely in force. Both findings are about what happens *around* that core.

## Q-475 — a database outage arrives as HTTP 200

Stopped Postgres, pushed two ordinary valid mutations, got **200** with a per-item error for each.
That is a consequence of the same property that makes the poison-pill rule work: `pushMutations`
catches per-mutation, so at the wire a dead connection is indistinguishable from a validation
rejection.

The client (`sync-engine.ts:798-833`) sees `res.ok`, **resets** `consecutive5xx` instead of engaging
the whole-queue backoff, keeps pushing at full cadence into a server that cannot write, and bumps
`attempts` on every mutation. The per-item backoff is 30 s → 2 m → 8 m → 32 m before the fifth attempt
dead-letters, so **≈ 42.5 minutes of outage dead-letters every queued mutation** — an ordinary outage
length, and this repo has recorded two.

It is not data loss: rows are kept, the More-tab badge reflects them, Tier-A domains toast, and retry
exists. The cost is that a user emerges from a transient outage with every pending write
dead-lettered and a **per-item-only** retry UI — no "retry all" — asked to hand-repair a queue that
was never broken. The client's own comment already states the principle: *"Transport failures … say
nothing about the mutation itself."* Neither does a dead database.

Same class as **Q-548**, filed the same day by another lane: a DB outage surfacing as
`{"error":"Forbidden"}` on `/api/admin/db-query`. Two independent routes now known to misreport an
outage as something else.

## Q-476 — the worse failure gets the softer handling

A mutation rejected by the route's `MutationSchema` returns `errors: []` — which is how the client is
told everything succeeded — so the row is **deleted**, with no badge, no toast, no way back. A
mutation that fails one layer later, inside `pushMutations`, is kept, badged and retryable. Measured
both ways: an unknown domain gave `processed: 2, errors: []` on a batch of three; a malformed date
gave `processed: 0, errors: []`.

The route calls this "quarantined". Quarantine is what the *other* path does. And `pushMutations`'
`Unsupported domain` branch argues at length against exactly this silent drop — while being
unreachable behind the route's `z.enum`. The layer that got the policy right is the one that never
runs.

**Latent, not live.** I checked the date argument at all 36 `queueMutation` call sites: every one is
safe today. The unknown-domain case needs a domain to be *removed* while devices hold queued rows.
Filed as the trap it is.

## Recorded clean

The poison pill isolates correctly; a per-item failure never deletes data; an envelope-level 4xx
quarantines its chunk and keeps draining rather than breaking; and the `id`-keyed confirmation is
real, with the `domain:date` fallback reachable only for pre-v13 clients.

## Method note

Stopping the local cluster (`pg_ctl -D /var/lib/postgresql/local-dev -m fast stop`) and restarting via
`scripts/local-db/setup.sh` is safe and idempotent — the two migration warnings on restart (`082`,
`157` already present) are the normal already-applied lines, not damage. It is a cheap way to reach
error paths nothing else in the harness exercises, and this sweep's main finding came out of it.
