# 2026-09-26 — DV-8: the outbox was cleared before the rows were confirmed

**Branch:** `fix/dv8-strand-on-confirm-throw` · **Lane A** · cause found and fixed; the heal is still owed

## The signature

Device Verification measured it precisely across two sweeps: local rows sitting at
`sync_status='pending'` while **both `mutations_outbox` and `sync_outbox` are empty** and the
server has already applied the write. Sweep 4b found **36** `food_logs` rows in that state — every
one a delete tombstone, spread over 14 days — plus the original `set_logs` row pending since
2026-09-19. Other domains clean.

That combination is the whole clue. An empty outbox means the mutation was consumed; `pending`
means the local row was never confirmed. Nothing retries a mutation that is no longer queued, and
`applyDelta` only overwrites `synced` rows, so the row cannot be corrected by any later pull.

## The cause was not a missing arm

The obvious reading — a domain whose delete has no confirm arm — is what DV-5 already fixed, and
the food delete arm is present and correct. Two things ruled it out: `markFoodLogSynced` has no
`deleted_at` filter, and the same strand had happened to `set_logs`, a different domain entirely.

`pushMutations` deleted the **whole batch's** outbox entries and *then* ran a hundred-line
per-domain mark-synced loop with **no error handling anywhere in it**. Any arm throwing on a local
read or write aborted the loop, leaving every row after it `pending` with its outbox entry already
gone.

**Proven, not inferred.** A test makes one arm throw and asserts the sibling is still confirmed and
the throwing row keeps its outbox entry. Against the old order it fails — the error escapes
`pushMutations` entirely and the sibling is never marked.

## The fix

Confirm first, per row, guarded; clear the outbox only for rows that actually confirmed. This is
the rule the Oura history cursor already follows and states outright: only advance past what is
durably recorded. A re-push is free because every domain's handler is idempotent; a lost
confirmation is not.

A confirm failure is deliberately **not** recorded as a mutation failure. The server applied the
write, so counting it toward the dead-letter budget would present a success as a failure. The entry
stays queued and the next push retries it. The cost — a permanently-throwing arm retries forever —
is stated in the code and is strictly better than the silent permanent strand it replaces.

## Mutation pass

4 deliberate defects, all killed; 1 deliberately equivalent control, survived.

One survived the first round: swallowing the confirm error silently. That was a real gap rather
than a nitpick — this path does not dead-letter, so the log is the only way a repeating confirm
failure is ever noticed, and silence is exactly what let 36 rows accumulate over 14 days unseen.
The test now asserts it.

## Still owed, and it is the reason DV-8 stays in the queue

**The 36 rows already stranded are not healed.** They have no outbox entry to retry, so they need a
sweep, and DV-8 is now that sweep and nothing else. The entry records the one thing a sweep must
get right: **re-queue, do not mark synced.** A stranded tombstone is indistinguishable from one
whose mutation never got queued at all, so marking it synced would drop a delete that never landed.
Re-pushing is idempotent; assuming is not.

## Not exercised

No device run — this is the JS sync engine, so it reaches the phone through a normal Railway deploy
with no APK. What ran is the unit suite against a fake store. **The reproduction is of the
mechanism, not of the phone's incident**: I have shown the code permits exactly this strand, not
that this is what happened on 2026-08-19. The 36 rows are the evidence for that, and they are
consistent with it, but no log survives from those pushes.
