# 2026-08-18 — a dead database is not a bad mutation (Q-475)

**Lane A** · branch `fix/sync-push-classify-retryable-errors` · server + client, one PR · no
migration, no Kotlin, no APK.

`pushMutations` catches per mutation — which is exactly what makes the poison-pill rule work, and is
also why a database that cannot write reached the client as `HTTP 200 {errors:[…]}`, wearing the same
clothes as a validation rejection. The client saw `res.ok`, **reset** its 5xx backoff instead of
engaging it, kept pushing at full cadence into a server that could not write, and bumped `attempts`
on every mutation. At 30 s → 2 m → 8 m → 32 m, **≈ 42.5 minutes of downtime dead-lettered the entire
outbox** — an ordinary outage length; this repo has recorded two.

Not data loss: the rows survive, the badge shows, the retry works. The cost is that the user is
handed a red badge, a toast claiming a workout failed to sync, and a **per-item-only** retry UI, and
asked to hand-repair a queue that was never broken.

## The fix

The client already stated the principle it was violating, three lines below the bug: *"Transport
failures … are deliberately NOT counted — they say nothing about the mutation itself."* A dead
database says nothing about the mutation either. It was counted only because it did not *look* like
a transport failure.

- **Server** — classify in the per-mutation catch, the only place that still holds the driver error
  with its `cause` chain intact. `isRetryableWriteError`
  (`packages/shared/src/sync/retryable-error.ts`) stamps `retryable: true` on the `PushResult` error
  entry. Conservative by construction: an unrecognised error stays non-retryable, so a wrong answer
  degrades to *today's* behaviour, never to an unbounded loop.
- **Client** — a retryable failure leaves the row queued and untouched (no `attempts` bump) and
  engages the whole-queue backoff exactly as a 5xx does, then stops draining. Non-retryable siblings
  in the same response still record normally. An older server that sends no flag keeps the previous
  behaviour, because the flag is read as `=== true`.

One ordering detail worth keeping: `consecutive5xx = 0` moved to *after* the classification. Left
where it was, a 200 carrying nothing but "the database is down" would reset the escalation on every
attempt and the backoff would never grow past 30 s.

## The bug the unit tests could not see

Every unit test passed, the integration test against an unreachable pool passed — and the first live
`pnpm dev` rehearsal with Postgres genuinely stopped returned `retryable: None`.

The dev `DATABASE_URL` is the **Unix-socket** form. A socket to a dead server is simply *missing*, so
the errno is **`ENOENT`**, not `ECONNREFUSED` — and the classifier called a real outage permanent.
Production is TCP and would have given `ECONNREFUSED`, so nothing but the rehearsal would have caught
it. The rule is now `syscall === 'connect'`, which is unreachability by definition whatever errno
rides along; a bare `ENOENT` with `syscall: 'open'` stays non-retryable, and there is a test pinning
both.

Measured shapes, all transcribed from real runs rather than the pg docs:

| Condition | `cause` |
|---|---|
| connection killed mid-flight | pg `DatabaseError` `57P01` |
| TCP reconnect refused | `Error` `ECONNREFUSED`, `syscall: 'connect'` |
| socket reconnect, server gone | `Error` `ENOENT`, `syscall: 'connect'` |

## Live proof

`POST /api/sync/push` on `pnpm dev`, one valid `body_metrics` mutation and one genuinely malformed
`plan_meal_answers` mutation in the **same** batch, with Postgres stopped:

```
processed 0
  id=d1 retryable=True | Error: Failed query: insert into "body_metrics" …
  id=d2 retryable=None | Invalid plan_meal_answers payload: missing planMealId
```

The outage is retryable; the bad payload is not, and still dead-letters — an outage must not turn
every failure into an infinite retry.

## Not exercised

Railway (inducing a production outage is not on) and the APK. The client half is plain TypeScript in
`sync-engine.ts` with no native dependency. Note the production path is TCP, so the `ENOENT` case
above is a dev-only shape — the TCP shape is covered by both the unit test and the
unreachable-pool integration test.

## Left open

Q-548 is the same class on a different route (a DB outage surfacing as `{"error":"Forbidden"}`) and
is still queued. Two independent routes are now known to misreport an outage as something else; a
sweep of how outages surface across `app/api/**` is worth someone's hour and is not this entry.
