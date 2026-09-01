# 2026-09-01 · Lane A — the prune that was working (BF-93, refuted)

Branch `lane-a/error-events-retention`. No runtime code changed. One retraction in CLAUDE.md, one
regression test, one entry removed.

## What the entry claimed

*"`error_events` does not prune, and every doc says it does."* Searched 2026-09-01: **no
`DELETE FROM error_events` outside tests, no `pg_cron`, no retention trigger.** Corroborated, it
said, by the data — the oldest row was **2026-07-31, 32 days old**, past a retention that supposedly
enforces 30.

It was wrong on every count.

## The prune is in `insertErrorEvent` and has never been absent

`lib/data/postgres/adapter.ts` fires
`DELETE FROM error_events WHERE created_at < now() - interval '30 days'` after each insert,
throttled to once a day by the shared `shouldPrune`. `git log -S` puts it in the **initial public
snapshot**. Nothing regressed; the search missed it.

## The evidence for the finding was the prune working

This is the part worth carrying. The prune fires **from a write path**, not a scheduler — there is
no cron layer, and `retention-throttle.ts` says so in its own comment. So it runs only when a fault
is recorded, and faults are now rare: 5 rows in the last week against 3,324 two weeks ago, after
Q-539's dedupe landed. Between faults the oldest row drifts past the window and stays there.

Measured against production the same day:

| | |
|---|---|
| last write | **2026-08-30** |
| oldest row | **2026-07-31** |
| span | **exactly 30 days** |
| 30-day cutoff computed from the last write | **2026-07-31** |

The oldest row is the cutoff **to the day**. Reading its age against *today* rather than against the
*last write* is what produced "32 days old", and from there the whole false conclusion.

## The expensive part was CLAUDE.md

The finding was written into the file every session reads first, as *"It does NOT prune, despite
what this line said until 2026-09-01"* — so every session after it would have started from a false
model of the fault record, and `lib/export/export-map.ts`'s correct *"pruned at 30 days"* was named
as the thing still to fix. CLAUDE.md is retracted with the measurement and the reason the mistake
was easy to make. `export-map.ts` is untouched, because it was right.

The file also contradicted itself: line 47 kept saying *"on top of the 30-day prune"* the whole time.

## The test, and why it is behavioural

`lib/data/postgres/__tests__/error-events-prune.test.ts` writes a fault and asserts a row past the
window is gone — plus the inverse, that an aged row survives while nothing is writing, which is the
production shape that was misread. **A grep is what failed the first time**, so the guard is not one.

Mutation-tested: removing the `DELETE`, widening the interval to 90 days, and closing the throttle
each turn it red.

## Two owner answers, asked twice

The retention question went to the owner on the entry's premise — *add a prune or delete the claim*
— and came back **"keep forever, fix the docs"**. Once the premise was falsified that answer meant
something else: **deleting a working prune** rather than declining to add one, trading a bound this
database has always had. Put again with the correction, the answer was **leave it alone**.

The approved message truncation (5,780 rows over 1,000 chars, ~39 MB) went the same way. Under a
working 30-day prune those rows age out by themselves and new ones are already capped by Q-539, so
an irreversible `UPDATE` over production buys about one month of 39 MB — roughly half a cent.
**Skipped**, with the owner's confirmation.

**The lesson is not "ask twice".** It is that a question inherits the premise of the entry it comes
from, and an entry can be wrong. Re-verifying the plan against current `main` before building is the
standing rule; this is the case where doing it after asking meant going back.

## What the 52 MB actually is

`error_events` is the second-largest object in the database — and that is **30 days of retained
payload**, not unbounded growth. 12 MB heap, 728 kB index, the rest TOASTed message text. A fact
about how much this app writes when it is failing, not a leak.

Verified by `pnpm check:rules` (**Ran 67 of 67**) and the full suite. **Not exercised:** no runtime
code changed, so there is no app or device surface here.
