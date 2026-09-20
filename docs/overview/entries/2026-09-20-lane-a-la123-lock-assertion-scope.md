# 2026-09-20 — LA-123: a test asserting something about other people's tests

**Branch:** `lane-a/la123-lock-assertion-scope` · **Lane A** · filed and shipped the same day, from
a failure seen while gating LA-63.

## What it was

`migration-test-lock.test.ts` ended with:

```sql
SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory'   -- expected 0
```

**`pg_locks` is scoped to neither database, session nor process.** `migrationTestLock` is used by
**15 other test files**; vitest runs files in parallel workers; every one of those workers takes the
same advisory key (`171_0164`) against the same Postgres. So the hook asked whether *somebody else*
happened to be inside their migration at the moment this file finished — which is nobody's
invariant, and is not something this file can do anything about.

It showed up as `Test Files 1 failed | 951 passed` against `Tests 9027 passed | 0 failed`: a file
failing while none of its tests do, which is the signature of a hook rather than an assertion.

## Proving it, rather than re-running until it went away

A second full-suite run was green, which settles nothing — that is what an intermittent failure
looks like from either side. The mechanism was reproduced directly instead: hold the key from one
connection, then evaluate both predicates from another.

| | value | expectation | |
|---|---|---|---|
| old, cluster-wide | **1** | 0 | **fails** |
| new, scoped to this process's pids | **0** | 0 | passes |

That is the observed failure exactly, produced on demand.

**One honest caveat carried over from LA-123's filing:** a second variable was present on the run
that failed and absent on the run that did not (a `pnpm dev` server for an E2E reproduction, on a
different database on the same instance). Those two runs cannot separate the causes. The
reproduction above does not need them to — it does not rely on either run.

## The fix

A pid is one live backend, and a backend belongs to one process's pool. `acquire()` now records the
backend pid it took the lock on; the hook asks Postgres about **those pids and that key**, which
keeps the real database evidence and drops the race.

```sql
SELECT count(*)::int AS n FROM pg_locks
 WHERE locktype = 'advisory' AND objid = $1 AND pid = ANY($2::int[])
```

Two sets, not one: `heldPids` for "did we leak" and `everHeldPids` because the assertion worth
making runs *after* release — *the locks we took are gone* — which a set emptied on release could
not express. The `objid`/`classid` encoding for `pg_try_advisory_lock(bigint)` was read off a live
backend rather than off the documentation (`classid 0, objid 1710164, objsubid 1`).

**The third test was fixed in the same way for the opposite reason.** Its
`toBeGreaterThan(0)` on the same unscoped query passed as readily on a sibling's lock as on its
own — weaker than it looked rather than broken, and it would have gone the same way as the hook
the moment it mattered. It now asserts exactly one lock, at its own pid. That test is also what
keeps the helper honest about not being a no-op, which is why the hook does not need to re-prove it.

## Verification

**Mutation pass — 3 mutations, each caught by its intended assertion:**

| mutation | caught by |
|---|---|
| `release()` stops calling `pg_advisory_unlock` | `postgres still shows our key held on a connection we used` |
| `release()` stops untracking the pid | `a lock this file took was never released` |
| `acquire()` stops recording the pid | the third test's `acquire must record the backend…` |

The first two matter most together: one catches a real leaked lock, the other catches bookkeeping
that has drifted from the database. Either alone would let the other pass silently.

**Equivalent control, green (3/3):** the helper's internal variable renamed, the poll interval moved
20 ms → 25 ms, and the predicate rewritten as `pid IN (SELECT unnest($2::int[]))`. The SQL half is
the one that mattered — it shows the assertion is about the state, not about the shape of the query.

All 15 files that use the helper: **13 passed, 2 skipped**. Full suite below.

## Not exercised

Nothing user-facing is touched — this is test-support code under `__tests__/`, with no route, no
component, no migration and no shipped behaviour. No device check applies and no changelog entry is
owed.

**What this does not fix:** the other 15 files have no such hook, so a lock leaked by one of them is
still caught only indirectly, by the next file in that worker hanging. Adding the hook to all of
them is not obviously worth it — the helper is one small function and its release path is now
asserted here — and it is not filed as follow-up work, on the grounds that a defect nobody has seen
does not need a queue entry to hold its place.
