# 2026-08-18 — the one push branch that could not survive a replay (Q-481)

**Lane A** · branch `fix/outbox-water-delta-dedupe` · migrations **199** + **200** · no Kotlin, no APK.

The outbox delivers **at-least-once**. Eighteen of the nineteen push branches survive that: they
upsert on `(user_id, date)` or on a client-supplied row id, so a second delivery writes the same row
again and nothing moves. The nineteenth — `body_metrics` carrying `waterMlDelta` — *adds*:

```
3 × {"id":"water-fixed-id-001", …, "payload":{"waterMlDelta":250}}
→ water_ml = 750,  each push answering {"processed":1,"errors":[]}
```

The addition is not the bug and must not be "fixed". `incrementWaterLog` does it inside the upsert
(`COALESCE(water_ml,0) + $ml`) precisely so two concurrent quick-adds sum instead of clobbering each
other (SYNC-P7). Being atomic-and-additive is what makes it right under concurrency and wrong under
replay, and an absolute set would trade one for the other.

Replay is reachable by ordinary means on the canonical runtime, not only by a crafted request: if a
push reaches the server and **commits** but the response is lost — signal dropped mid-response, the
OS killing a backgrounded app, a timeout — the mutation is still `status='pending'` on the device,
nothing marks it in-flight, and the next sync re-pushes it. The server kept no record of which
mutation ids it had applied.

## The fix

`applied_mutations(user_id, mutation_id, applied_at)`, PK on `(user_id, mutation_id)` — and only the
water branch writes to it.

**Claim-then-apply, not check-then-apply.** `ON CONFLICT DO NOTHING … RETURNING` makes the claim
itself the exclusion, so two simultaneous replays of one id cannot both read "not applied" and both
add. That is the same shape as `completeWorkoutSession` reading its own affected-row count (Q-473)
rather than a prior SELECT — the third time this week that deriving a decision from a read taken
before the write was the defect.

Both statements share a transaction, so a refused write releases the claim and the mutation can be
retried rather than silently swallowed. A replay still reports `processed`, because it *was*
processed on an earlier delivery — the client confirms and drops it instead of retrying forever.

Scoped deliberately. Extending the ledger to all nineteen branches would cost far more than it buys
and would turn pruning from trivial into a real problem.

## Verified

The five regression tests, and two of them fail without the fix — 750 vs 250, and 400 vs 200 on the
concurrent case. The other three pass either way by design: they are the must-not-break guards
(distinct adds still sum, the ledger is user-scoped, a refused delta leaves no claim).

Live through the real route on `pnpm dev`:

| | before | after |
|---|---:|---:|
| 3 × the same mutation id, 250 ml | **750 ml** | **250 ml** |
| 3 × distinct ids, 250 ml each | 750 ml | **750 ml** (1000 total) |

Full suite 501 files / 4077 tests green.

## Pruning, because a ledger with no prune caller is the Q-538 mistake

Pruned opportunistically off the write path at 90 days, throttled to once a day per process — the
established shape here (`retention-throttle.ts`, and the `oura_heartrate` / `rr_intervals` sites),
since this app has no cron layer. 90 days is far past anything replayable: a replay only happens
because the device lost the response to a push the server already committed, and it re-pushes on the
next sync after reconnect.

## Two traps, both of which cost a step

**A new table is invisible to `claude_ro` until it has a view**, and the coverage guard is what says
so — it failed exactly as designed. Regenerating needs a **new** migration number (200), never an
edit to the committed one, because `ensureSchema` tracks by filename.

**The generator must be run with the production owner id**, not the local test user's. It reads
`CLAUDE_RO_OWNER_USER_ID` and will happily bake in whatever it is given; the committed migrations
carry `fe481797-…`, and the first run here produced a file scoped to the local seed user. (Also:
redirect its log with `2>/dev/null`, not `2>&1`, or the summary line lands inside the SQL.)

And `claude-ro-readonly-role.test.ts` **pins the newest views migration by filename** and has to be
repointed. Its own comment records that this pin went stale silently once before, between 181 and
185. Repointed 197 → 200 here.

## Confirmed clean from the same review, recorded so they are not re-run

- `complete_workout` replayed 3× → `sessions_in_phase` = 1. Independent confirmation of the **Q-473**
  fix that merged earlier today, covering the replay vector its comment named, where the earlier
  re-run covered the concurrent one.
- Absolute `body_metrics` (`weightKg`, `steps`) replayed 3× → one row, correct values.
- `activity_logs` replayed 3× → one row. This looks like it contradicts an earlier sweep where
  `POST /api/activity-logs` gave 5 rows for 5 concurrent calls; they are **different writers**. The
  web route mints a server-side id, the outbox payload carries a client-generated one and upserts on
  it. Neither is a defect.

## Not exercised

The APK. The replay was driven by re-posting the same envelope — exactly what the client does — but
the client-side trigger (a lost response) was read from source, not induced. Fifteen of the other
eighteen branches were read rather than individually replay-tested.
