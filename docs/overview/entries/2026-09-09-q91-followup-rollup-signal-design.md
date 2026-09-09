# 2026-09-09 — the BLE rollup's invalidation signal, scoped (Q-91-followup)

**PR:** `lane-a/q91-followup-rollup-signal-design` · **Lane A** · **docs only — nothing implemented.**

Q-91-followup is a deferred *decision*, not a bug, and its own text said it needed a scoped design
rather than a quick add-on. This is that design:
[`docs/superpowers/plans/2026-09-09-oura-ble-rollup-invalidation-signal.md`](../../superpowers/plans/2026-09-09-oura-ble-rollup-invalidation-signal.md).

## The answer, and why the question was too narrow

**No — the rollup should not emit its own signal, and it does not need to.** The entry framed this
as a latency trade: the rollup is fire-and-forget for I20 reasons, so hanging a signal off its
completion risks the timeout class behind the I19/I20 storm and the 2026-08-13 outage.

That trade only exists if the server is the only place a signal can come from, and it isn't.
`OuraRingService.emitStatus()` already pushes `ouraStatus` — carrying `draining` — through the
plugin bridge on every state change, background drains included, and `lib/oura-ble/plugin.ts`
already declares the listener. **The client can hear drain-end today, with no native change and no
server change.** The I20 coupling never has to be built.

## The trap that keeps it from being a two-line fix

**Drain-end is not rollup-done.** The POST returns once raw rows are stored; the rollup is a 3-second
trailing-edge debounce and then runs off-loop. So an `ouraStatus` listener that invalidates when
`draining` goes false — the obvious implementation — can refetch *before* the rollup has written and
**cache the pre-rollup read**. That is worse than the staleness it replaces: stale data gets
corrected by the next mount, whereas data refilled from a pre-rollup read looks fresh and is held for
the full TTL.

The design instead confirms the watermark advanced. `oura_rollup_state` (migration 184) already
persists `last_rolled_ds`/`epoch` per user after each *successful* run, and is **not exposed over
HTTP** — one small GET is the entire missing piece. `afterDrainSettles` has the same race today and
converges onto the same helper rather than keeping a second mechanism beside it.

## Two filing mistakes I made and corrected, because the field changes what the queue does

I first gave the entry `Gate: device`, which **parks** it — recreating exactly the unstartable-queue-
head problem #1047 existed to fix. Then `Verify: device`, which files it among entries that have
*shipped* and owe only a check; this one is unbuilt. The right answer is **neither field**: the build
is ordinary unit-testable work, only *observing* it is device-bound, and that is the standard
Canonical Runtime case — ship with a Known-Issues row. The note stays in prose, where it informs the
implementer without changing classification.

Worth recording because both wrong answers looked right in isolation, and `check-backlog-pointers`'s
advisory about a *different* entry is what surfaced the first one.

## Status

Entry stays in READY at position 2, now with a plan behind it. Nothing is implemented, and no claim
here should be read as shipped.
