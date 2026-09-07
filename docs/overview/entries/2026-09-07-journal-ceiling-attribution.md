# 2026-09-07 — the journal ceiling stops blocking PRs that cannot fix it (LB-58)

**Branch:** `fix/journal-ceiling-attribution` · **Lane A**

## The defect

`entriesVerdict` has two limits written differently. The **foldable runaway limit** carries BF-36's
attribution — it fails the branch that added entries and merely notes the overflow for one that did
not. The **total ceiling** directly below it had no such guard, so once `main` reached the ceiling,
the next PR to add any journal entry failed Custom Rules whoever it belonged to.

Measured twice, by the two sessions it blocked: 2026-09-03 at 251 against a 250 ceiling (a spec fix,
which paid by folding three entries), and 2026-09-06 at 320 against a 320 ceiling (an e2e-drift PR,
which paid by folding 46). Both had added exactly one entry, and both times the sweep was unrelated
to the change under review.

## Why the entry's prescribed fix would not have worked

LB-58 said: *"The fix is one condition, mirroring the branch above: fail on the ceiling only when
`grewIt`."* That does not solve the problem it describes, and the entry's own evidence is why —
**every session writes a journal entry**, so `grewIt` is true for practically every PR. Both measured
cases had `addedHere = 1`. Gating on `grewIt` would have failed them exactly as before.

The entry's own verification bullet is the tell: *"with `main` at the ceiling, a branch adding one
entry passes with a note."* Under `grewIt` that branch fails. The two bullets contradict each other,
and the verification one describes the behaviour actually wanted.

**The gate is now whether this branch's entries CROSSED the ceiling** — `baseTotal <= ceiling &&
total > ceiling`. The crossing PR fails and is told what the base was; every PR after it gets a note.

## The reason this limit deserves different treatment from the one above it

They are not the same kind of debt. The runaway limit is payable by the branch it blocks: fold the
unlinked entries and the number comes down. **The ceiling is not.** It counts *all* entries, and at
the time of writing 286 of 295 are linked by a durable doc and therefore unfoldable — so the sweep
the failure demands cannot get under the number. The old message said so itself: *"a sweep alone will
not fix this: the durable docs citing the other N need to point at the batched history instead."*
It failed the author while telling them the fix was someone else's.

The consequence, stated plainly rather than buried: **once the base is over the ceiling, nothing
fails again until the durable docs are restructured.** That is the Orchestrator's job and a real one
— headroom is 25 entries and the linked floor only rises. A loud note on every PR is a better prompt
for it than a red check on an arbitrary author.

## Verification

- Mutation-tested three ways, and one of them is the entry's own prescription: restoring the
  unguarded ceiling fails 5 tests; **gating on `grewIt` instead of crossing fails 2**; letting an
  unreadable base go silent fails 1. The middle one is the evidence that the deviation from the
  entry is tested rather than asserted.
- Two pre-existing tests asserted `fail` "regardless of who added what". They encoded the defect,
  not the contract, and are rewritten to assert what each was really protecting — that the ceiling is
  a separate gate from the runaway limit and still surfaces when that limit is excused. A third was
  added so the gate is not silently gone: the branch that crosses still fails.
- Exercised against the **real check**, not just the pure function: with the ceiling lowered so the
  base is over, `check-doc-index-size` prints the note and exits 0 where it previously failed.

**Not exercised:** nothing device-shaped — this is a CI script with no runtime path.
