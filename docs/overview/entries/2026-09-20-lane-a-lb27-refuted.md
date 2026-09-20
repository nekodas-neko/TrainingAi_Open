# 2026-09-20 — LB-27: the hang has no mechanism and does not reproduce

**Branch:** `lane-a/lb27-refuted` · **Lane A** · docs-only. Third KEEP-mined item of the session,
after LA-63 and LA-123.

## What the entry said

Health's launch fires ~25 API requests in seven seconds. Adding one more — a
`PATCH /api/user/preferences` from a card's mount effect — left that PATCH **and a `GET` behind it
pending past sixty seconds**. Measured 2026-08-30 with Playwright's `requestfinished`, so genuinely
unresolved rather than slow.

Its hypothesis, and the whole of its `Keep:`:

> the pool is `max: 10` with `pg`'s default `connectionTimeoutMillis: 0`, which waits **forever**
> for a client rather than erroring

## That was never true in this repository

`lib/data/postgres/client.ts` sets **`connectionTimeoutMillis: 5_000`**, and `git log -S` over the
full history dates it to `6c072f9bfca`, *TrainingAI — initial public snapshot*, **2026-08-16** —
two weeks **before** LB-27 was filed. The `Keep:` asked for a decision that had already been made
before the entry existed.

(That the premise was stale was already known: **PS-38** has carried *"strike LB-27's
already-decided Keep"* since 2026-09-06, unactioned. What is new here is that it is not merely
stale — it is refuted, which is what retires the entry rather than one line of it.)

**And the mechanism is impossible for a different reason as well, which the entry could not have
seen while it was looking at the wrong number.** `statement_timeout` and
`idle_in_transaction_session_timeout` are both `15_000`. So a pool wait errors at 5 s, a running
query is killed at 15 s, and a transaction left open is reaped at 15 s. **Nothing in this pool can
produce a request pending past sixty seconds.** Whatever stranded those requests, it was not the
database layer.

## Measured, not merely argued

Re-run on current `main` against a CI-shaped database, instrumented the same way (`requestfinished`,
so a strand is distinguishable from a slow response), with a **75-second** observation window —
anything shorter measures route compilation rather than stranding, which is the mistake the first
attempt at this made.

| | in-burst PATCH | settled PATCH | API requests | Postgres peak |
|---|---|---|---|---|
| warm server | **200 in 771 ms** | 200 in 378 ms | 38 started, 37 finished | — |
| **cold server** (`.next` deleted) | **200 in 1741 ms** | 200 in 380 ms | 38 started, 37 finished | **1 active, 0 idle-in-transaction, 13 total** |

Sampled `pg_stat_activity` every 2 s throughout the cold run: the pool never came close to
saturation and never held a transaction open.

The one request that reads as unfinished in both runs is the instrumented PATCH itself — the same
URL and method as the control, so the two collide on the event key. It returned **200**, with a
measured duration, in both runs. It is a defect in my probe, not a strand, and it is stated here
rather than left to look like a surviving symptom.

## What still stands, so it is not lost

**The `FOR UPDATE` claim is correct.** `updateUserPreferences` (`adapter.ts:3077`) really does open a
transaction, take `.for('update')` on the `users` row and hold a pool client for the merge. That is
deliberate and documented — two devices on one account, and an unlocked read-modify-write drops
whichever key loses. Nothing here argues against it; it simply is not the cause of a sixty-second
hang, because it cannot outlive a 15-second reaper.

**The nine `networkidle` e2e failures the entry pointed at are also gone** — LA-63's full-suite
measurement the same day read 1 failed, 1 flaky, 220 passed, and none of it is `networkidle`.

## Why the entry is removed rather than re-scoped

The entry's own instruction was: *"Not reproduced in production, and it may be dev-server-specific
(route compilation under concurrency). Establish that first: it changes whether this is a bug or a
harness note."* That is now established — it does not reproduce on the one environment where it was
ever seen, cold or warm, on current `main`, and its named mechanism is ruled out by configuration.
Nothing is owed, so it does not sit in the queue.

## Not exercised — the honest limits of the refutation

- **The trigger is not byte-identical to the original.** The original PATCH came from a card's mount
  effect; mine is a `fetch` from `page.evaluate` immediately after `goto`. Same burst, same route,
  same method, but not the same call site.
- **Dev server only, as the original was.** No device run, and production was never affected (the
  entry says so itself).
- **Three weeks of unrelated change sit between the two measurements.** A non-reproduction today
  does not prove the 2026-08-30 observation was wrong — it proves there is nothing left to fix.

If a launch-time hang is ever seen again, it should be filed fresh from its own measurement rather
than reopened against this hypothesis, which is the part that has been disproved.
