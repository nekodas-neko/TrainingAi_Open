# 2026-08-04 — Q-54: the prescription and its status are now one write

**Branch:** `fix/prescription-generation-race` · **Domain:** workouts · **Version:** 1.256.4

## The race, confirmed by reading the write sequence

`generatePrescriptionForSession` ended with two statements against the same
`session_periodization` row:

1. `storePrescription(...)` — which **unconditionally reset `prescriptionStatus` to `'pending'`**
2. `updatePrescriptionStatus(..., 'auto_applied')` — only when the run decided to auto-apply

Two generations for the same session can be in flight at once: the duration-preset picker
(Quick/Normal/Long) deliberately builds a *different* dedup key and passes `skipCooldown: true`, so
it is never collapsed against the auto-fire generation that runs at session-open. Interleave them:

```
A.store   → row = A's prescription, status 'pending'
B.store   → row = B's prescription, status 'pending'
A.setStatus('auto_applied')  → row = B's prescription, status 'auto_applied'
```

The row now claims run A's decision about run B's content. That is a session whose plan says
"already applied" for a plan nobody applied.

## The fix, and what it deliberately does not fix

`storePrescription` takes the status and writes both fields in **one statement**. The generation
path passes its computed status straight in; the separate `updatePrescriptionStatus` call is gone
from that path (it stays for the other five callers — 'consumed', 'accepted', post-transition —
which are genuinely status-only writes).

**This does not stop the two runs racing, and it should not.** Last-writer-wins on a whole row is
correct: one of the two generations is the newer intent and it wins outright. The defect was never
that a race existed, it was that the race could produce a row describing *neither* run. One
statement makes that unrepresentable.

The alternative in the plan — broadening the dedup key so the two collapse — was not taken. It would
re-couple the duration-preset picker to the auto-fire generation, which is exactly what
`skipCooldown: true` was added to avoid, and it trades a now-impossible corruption for a latency
regression on a control the owner touches mid-workout.

## Verification

Four DB tests against the real table. The first **reproduces the old interleaving explicitly** —
store A, store B, then the separate status update — and asserts the mismatched row, so the defect is
pinned rather than described. The others pin the status carrying through in one statement, the
`'pending'` default, and that a genuine concurrent pair leaves whichever run lands last holding
*both* fields.

Full suite 3100/3100; typecheck and lint clean.

## Not verified

**No observed production failure.** The plan said as much — *"this is based on source-reading, not an
observed failure"* — and that is still true: the interleaving is proven reachable in a test, not
caught in the wild. `error_events` carries no instance of it. What changed is that it is now
unreachable, which is worth more than waiting for one.

**Not exercised through the UI.** The duration-preset picker and the auto-fire trigger were not
driven concurrently against a dev server; the proof is at the repository layer, where the defect
lived.
