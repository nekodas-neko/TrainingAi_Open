# A full queue audit, and a policy that unfroze four entries at once

Orchestrator, 2026-09-27. Docs plus one baseline. The owner asked for a full review of assignment and
a bulk ask for anything needing him.

## The audit

All 538 entries run through the parser against five consistency tests. Four classes came back:

- **40 entries carried `Gate: owner` with no `Ask:`** — a question nobody had written down. This is
  the whole remaining blockage.
- **Five looked like a FAILED device result filed as verification debt.** Two were real, one was
  already discharged, two were false positives on prose.
- **Two `Verify:` on unbuilt work** — both correct on inspection (`DV-12` is a pass test, `DV-21`
  shipped).
- **No duplicate or conflicting lane fields**, and lane coverage stayed at 536 of 538 resolved, the
  two exceptions deliberate.

## The two real FAILED-under-Keep entries

**`RV-103`** — sweep 4a passed the original fix and found a new defect 1 of 1: after using **Retry**,
deleting that food left the card on 1,454 for 16 s while the server said 1,534. Deletes that had not
used Retry refreshed fine. The entry's own text said *"that is what this entry now owes"* and its
`Keep:` filed it as residue, pointing at the device. The diagnosis is already written — the Retry path
looks like it leaves the card's refresh subscription dead — so nothing is owed by the phone. Reopened
as Lane B work.

**`BF-98`** — the fix shipped, the S25 said it FAILED, and `Verify: device` kept printing it as
*shipped, a look is owed*. Struck.

## Four gates that were not the owner's

`TN-16` said *"NOT SIGNABLE yet, so do not offer it in a tuning batch"* — an instruction not to ask
him, written in the field that makes every sweep count it as his; it is `Lane: T` now, which is what
that lane exists for. `Q-29` said *"the ball is OURS, not theirs"*. `OR-115` gates the per-control
call on an inventory **that does not exist yet**, so it was owner debt for work nobody had started.

## Four answers, and one of them is a policy

**Production DB changes now have a standing rule** rather than four separate asks: **add and backfill
are authorised, dropping a proved-dead object is authorised with the evidence shown, and anything that
deletes rows holding data stays confirm-first** — every run behind a snapshot that is taken *and*
restored, printing its affected-row count against the prediction. It is in `CLAUDE.md`, not on the
entries, because it governs every future migration and an entry-local policy is one the next migration
will not find. `LA-143` and `BF-144` unfroze on it; `LA-71` and `Q-30` D4 correctly did not.

**`Q-279`: switch ACWR to uncoupled EWMA.** Measured over 95 real days — early-deload 12/95 → 15/95,
taper 4 → 1. He was offered re-tuning the 1.5 threshold to preserve the current four tapers and
**declined it**, which the entry now records: fitting a threshold to hold an outcome is how a
calibration drifts, and the point of the switch is that the four were not all genuine spikes.

**`Q-251`: no staging service yet**, with the trigger named — the first migration that damages
production authorises it without asking again. The gate is gone because nothing waits on him; the
entry waits on an event.

**`BF-98`: reading (b)** — the grouped meal row, not the section. Reading (a) is struck, so nobody
re-opens `meal-card.tsx:90` looking for a bug that is not there.

## Where it leaves the gates

`Gate: owner` **46 → 39**. `Ask: owner` sits at 22. Thirty-nine to go, and the two patterns that keep
paying: read the gate's own text first, and look for the one question whose answer unfreezes a cluster.
