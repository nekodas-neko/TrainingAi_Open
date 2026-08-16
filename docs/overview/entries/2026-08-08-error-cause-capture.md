# 2026-08-08 — Recording the Postgres error behind every "Failed query"

**Domain:** platform — v1.270.10, JS-only (no APK rebuild)

Q-107, first half. The backlog entry says this ships **before** the batching work, and why:
without it the batching fix cannot be proven to have worked.

## The gap

`/api/sync/pull` fails intermittently in production — a different domain table each time, the same
stuck `since` cursor across four days, and the same `Failed query` signature also showing up on
`/api/readiness-score` and `/api/body-battery`. The leading theory is pool contention
(`getSyncDelta` fires 22 queries into a `max: 10` pool), but it has stayed a *theory* because every
`error_events` row was undiagnosable.

The reason is one omission: `DrizzleQueryError` sets its message to `Failed query: <sql>` and puts
the **real** Postgres error — the one carrying `code`, `severity`, `detail` — on `err.cause`
(`node_modules/drizzle-orm/errors.js:11-19`). `reportServerError` recorded `err.message` and
`err.stack` and dropped `cause` entirely.

That single field is the difference between the two competing explanations: `57014`
(`query_canceled`, i.e. `statement_timeout`) versus a pool-acquisition timeout, which arrives with
no code at all.

## The fix

`summariseCause(err)` in `lib/observability.ts` reads the cause and returns a message prefix plus a
detail block. `reportServerError` prefixes the message and prepends the block to the stack.

**The code goes in a prefix, not a suffix, deliberately.** The standing session-start query groups
by `left(message,120)`, and a `Failed query:` message runs well past that — anything appended at the
end is invisible in exactly the read that is supposed to surface it. A cause with no code (the pool
case) contributes its message instead, truncated to 80 chars.

No migration: the code lands in `message`, the full breakdown (severity, code, message, detail,
constraint, table) in `stack`.

## Verification

`tsc --noEmit` clean · `eslint` clean on both files · full suite 409 files / 3241 tests, one failure
(`scale-ble-multi-reading.test.ts`) that **also fails on a stashed clean tree** — needs a second user
row the local seed lacks. Pre-existing, unrelated.

Four unit tests cover the shapes: a `57014` statement timeout, a code-less pool timeout, a
constraint violation carrying detail/constraint/table, and the no-cause no-ops.

**Verified against a real Postgres, not just synthetic objects** — ran two genuine failures through
the live local driver and printed what `summariseCause` produced:

```
undefined table: {"prefix":"[pg 42P01] ","block":"cause: ERROR | 42P01 | relation \"table_that_does_not_exist\" does not exist"}
timeout:         {"prefix":"[pg 57014] ","block":"cause: ERROR | 57014 | canceling statement due to statement timeout"}
```

The second is precisely the code Q-107 needs to tell its two hypotheses apart. That probe was a
throwaway — it is not committed, because it mutates `statement_timeout` on a shared connection and
would be a poor citizen in the suite.

## What this deliberately does NOT do

**The batching half of Q-107 is not here.** The entry is explicit that the observability half ships
first so the batching fix is measurable; the backlog entry stays open with the batching work and a
note that the cause capture landed. It also stays open because the fault is **wider than sync** —
`/api/readiness-score` and `/api/body-battery` show the identical signature and are the same fault,
so "fix `getSyncDelta`" would not close the class.

**Nothing is proven about the cause yet.** This change makes the next occurrence readable; it does
not diagnose the outstanding one. The next session on Q-107 should read `error_events` in production
first — the codes will now be there.

**Not exercised:** no on-device run (server-side only, no native/safe-area/gesture surface), and no
production data yet, by construction — the value of this change only appears the next time a query
actually fails in prod.
