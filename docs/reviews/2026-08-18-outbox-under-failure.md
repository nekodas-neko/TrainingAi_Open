# Review — the outbox under failure: what a bad mutation, and a dead database, actually do

**Date:** 2026-08-18 · **Agent:** Review · **Lens:** offline-sync failure paths
**Findings filed:** Q-475, Q-476 · **Clean results recorded:** four

## Why this lens

`CLAUDE.md`'s **Offline Sync** section is the longest rule block in the file and its central rule is
blunt: *"One bad mutation must never wedge the queue (3 production incidents: #47, #74, #82). A
4xx/validation failure is a poison pill: quarantine it, don't retry forever, and never let it block
the mutations behind it. 5xx/429 = back off and retry."*

Nine sweeps have run under this role and **none had ever pushed a batch at `/api/sync/push` and
looked at what came back.** Every previous sweep took the web fallback path. This one fired real
batches, including one with the database stopped.

Method: local `pnpm dev`, authenticated session cookie, hand-built envelopes posted to
`/api/sync/push`, reading the resulting rows out of Postgres. The DB-outage case was produced by
actually stopping the cluster (`pg_ctl -m fast stop`), not by mocking.

---

## The headline: the poison-pill rule holds, and it is worth saying so first

Five mutations, one of them poison (`waterMlDelta: -1000000000`, which the push branch rejects), the
poison deliberately placed **third** so four siblings sit behind it:

```json
{"processed": 4,
 "errors": [{"id":"m3","domain":"body_metrics","date":"2026-08-12",
             "error":"Error: body_metrics: implausible waterMlDelta -1000000000"}]}
```

All four valid rows landed in `body_metrics`. The failure is keyed by the **outbox id**, not
`domain:date`, so the client confirms exactly the four and re-queues exactly the one. The rule that
cost three production incidents is genuinely enforced, at both the route (per-mutation `safeParse`)
and the adapter (a `try/catch` inside the `for` loop). This is the part of the sync engine that has
been hardened the most, and it shows.

The two findings below are both about what happens **around** that hardened core.

---

## Finding 1 (Q-475) — a database outage arrives at the client as HTTP 200, so the backoff built for it never fires

### Measured

Postgres stopped, then a push of two ordinary valid mutations:

```
HTTP 200
{"processed":0,
 "errors":[{"id":"d1","domain":"body_metrics","date":"2026-08-09",
            "error":"Error: Failed query: insert into \"body_metrics\" …"},
           {"id":"d2", …}]}
```

**HTTP 200.** Not 500. Because `pushMutations` catches per-mutation — which is exactly what makes the
poison-pill rule work — a connection failure is indistinguishable, at the wire, from a validation
rejection. Every mutation in the batch comes back as its own "error".

### What the client then does

`lib/local-store/sync-engine.ts:798-833`. `res.ok` is true, so:

- `consecutive5xx = 0; push5xxUntil = 0` — the whole-queue server backoff is **reset**, not engaged.
  The client keeps pushing at full sync cadence into a server that cannot write.
- every mutation goes to `recordMutationFailures` → `attempts++` → dead-letters at
  `MAX_MUTATION_ATTEMPTS = 5`.

The per-item backoff is `30_000 * 4 ** (attempts - 1)` — **30 s → 2 m → 8 m → 32 m**, then the fifth
attempt dead-letters. Cumulative: **≈ 42.5 minutes of outage dead-letters every queued mutation.**

### The code states the principle it is violating

The comment three lines below the branch that does this:

```ts
// Transport failures (catch/!res.ok above) are
// deliberately NOT counted — they say nothing about the mutation itself.
```

Correct, and exactly the point: a dead database says nothing about the mutation either. It is only
counted because it does not *look* like a transport failure. Had the intended 5xx path fired, the
outcome would have been the designed one — whole-queue backoff (`30s · 2^(n-1)`, capped at 10 min)
and **no attempt counted against any mutation**.

### What it costs

**Not data loss.** `recordMutationFailures` sets `status = 'failed'` and keeps the row; the
dead-letter badge on the More tab reflects it, `workout_log`/`complete_workout`/`session_rpe`/
`fitness_tests` additionally fire a toast, and `retryFailedMutation` restores it. That is a good
design and it is what stops this being severe.

What it costs is this: after a ~43-minute database outage, a user with pending writes finds **every
one of them dead-lettered**, a red badge on More, a toast claiming a workout failed to sync, and a
retry UI that is **per-item only** — `sync-health-card.tsx:109-123` maps each failed row to its own
Retry button and there is no "retry all", so N stranded mutations mean N taps, each firing its own
full `pushMutations` round-trip. The user is asked to hand-repair a queue that was never broken.

The second-order cost is on the server: with `consecutive5xx` reset every round, the client applies
no backoff at all to a database that is already down.

### Fix shape (implementer's call)

The information needed is already present — `pushMutations` knows a connection error from a
validation error, it just flattens both into `String(err)`. Options, in the order I'd try them:

1. **Classify at the source.** Have the per-mutation catch mark the error retryable (a `retryable:
   true` field on the error entry, or a distinct `code`), and have `recordMutationFailures` skip the
   attempt bump for those — the same treatment transport failures already get by policy.
2. **Escalate a whole-batch failure.** If *every* mutation in a batch failed with the same
   connection-shaped error, the route can legitimately return 500; the client's existing 5xx path
   then does the right thing with no client change. Cheaper, but it misses a partial outage.

Prefer (1): it fixes the classification rather than inferring it from a count, and (2) can be layered
on later. Whichever lands, note that the client comment quoted above is already the specification.

### Not verified

Local `pnpm dev`, single node, local Postgres stopped by hand. Not reproduced against Railway (a
production DB outage is not something to induce), and **not** on the APK — but the client half is
plain TypeScript in `sync-engine.ts` with no native dependency, and the arithmetic above is read
directly from it.

---

## Finding 2 (Q-476) — the worse failure gets the softer handling: a schema-rejected mutation is deleted forever, silently

Two failure classes, opposite treatment:

| Failure | Where caught | Outbox row | User signal | Recoverable |
|---|---|---|---|---|
| Fails **inside** `pushMutations` (bad value, FK, ownership) | adapter loop | kept, `status='failed'` | badge + toast (Tier-A) | yes — Retry button |
| Fails the route's **`MutationSchema`** (unknown domain, malformed date) | route, before the adapter | **deleted** | **none** | **no** |

### Measured

```
3 mutations, middle one domain "retired_domain"  →  {"processed": 2, "errors": []}
1 mutation, date "06-08-2026"                    →  {"processed": 0, "errors": []}
```

An empty `errors` array is how the client is told *everything succeeded*. `resolveFailedOutboxIds`
returns an empty map, `confirmed` takes the whole chunk, and `deleteMutations` removes all of it —
including the one that was never written. The route says so in its own comment and calls it
"quarantined":

```ts
// Unsyncable shape — log and drop it so it can't wedge the queue. Omitting
// it from the response errors makes the client treat it as done (quarantined)
// rather than re-pushing it forever.
```

It is not quarantined. Quarantine is what the *other* path does — hold the row, badge it, let the
user retry. This is deletion.

### The same request path contains the opposite policy, written for exactly this case, and it cannot run

`adapter.ts:4355-4362` has an `Unsupported domain` branch whose comment argues the other way:

> *"…treats it as succeeded and deletes it forever. Report it as a retryable failure instead: the
> client's existing bounded-retry/dead-letter path (`MAX_MUTATION_ATTEMPTS`) already caps how long it
> survives, so a genuinely-removed domain still can't wedge the queue forever."*

That branch is **unreachable**. `MutationSchema.domain` is `z.enum(SYNCED_MUTATION_DOMAINS)`, so an
unknown domain is rejected by the route and never reaches the adapter. The layer that got the policy
right is the one that never runs, and the case it was written for — a domain removed from the enum
while devices still hold queued rows of it — is precisely the case that now silently deletes.

### Reachability, stated honestly

- **The malformed-date drop is latent, not live.** I checked the date argument at **all 36
  `queueMutation` call sites**: every one is `todayInTz()`, a `<input type="date">` value, or a
  stored `YYYY-MM-DD`. Nothing currently produces a date the regex rejects. There is no client-side
  validation standing behind that — it holds because every author has happened to get it right.
- **The unknown-domain drop needs a domain to be removed** from `SYNCED_MUTATION_DOMAINS` while
  devices hold queued rows. Not a today problem; squarely a tomorrow one, and `SYNCED_MUTATION_DOMAINS`
  exists precisely because the *inverse* mistake (a domain missing from the enum) once silently
  dropped every new-food log on the APK — the D-1 incident its own comment cites.

So: **file it as the trap it is, not as a live outage.** The asymmetry is the finding. A workout that
dead-letters gets a toast because, in the dead-letter module's own words, *"a lost workout is the
app's worst-case data loss"*. The same workout dropped one layer earlier gets nothing at all.

### Fix shape

Make the route's drop path return an error entry rather than silence, so the client's existing
dead-letter machinery handles it — the row is kept, the badge appears, and `MAX_MUTATION_ATTEMPTS`
still caps it, which is the argument the adapter comment already makes. That single change also makes
the unreachable adapter branch redundant rather than merely dead. A cheap companion: validate
`domain` and `date` in `queueMutation` at write time, so an unsyncable mutation is refused where the
user can still see it instead of at the far end of a sync.

---

## Clean results — recorded so the next sweep does not re-run them

- **The poison pill is isolated correctly.** 4 of 5 processed, all four sibling rows written, failure
  keyed by outbox id. See the top of this document.
- **A per-item failure never deletes data.** `status='failed'`, row kept, reactive badge on More, toast
  for the four Tier-A domains, per-item Retry and Discard.
- **Envelope-level 4xx does not wedge the backlog.** The client quarantines that chunk via
  `recordMutationFailures` and `continue`s to the next chunk rather than breaking the drain.
- **The `id`-keyed confirmation is real, not aspirational.** `resolveFailedOutboxIds` only falls back
  to `domain:date` when an error entry carries no `id`, and every server error path populates `id`
  from `mut.id`. The legacy branch exists for pre-v13 clients and is not otherwise reachable.

## Method note

Stopping the local cluster (`pg_ctl -D /var/lib/postgresql/local-dev -m fast stop`) and restarting
with `scripts/local-db/setup.sh` is safe and idempotent — the two migration warnings it prints on
restart (`082`, `157` already present) are the normal already-applied lines, not damage. This is a
cheap way to exercise error paths that nothing else in the harness reaches.
