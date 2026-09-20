# 2026-09-20 — BF-186's note becomes the door, and BF-185 turns out not to be Lane B's

**Branch:** `fix/bf186-manage-supplements-reachable` · **Lane B** · code + docs · no migration ·
**v1.460.4**

The batch `supplement-dose-surface` arrived as two Lane B entries. One was; one was not, and
finding that out before building it is the more useful half of this entry.

## BF-186 — shipped

The vial sheet told the owner his saved dose was *"changed in Manage supplements, under Amount"*.
He replied: *"I dont see a manage supplements section to change the default to 1mg."* He was right —
nothing is called that. Three things stacked:

1. the note said **"Manage supplements"**; the control says **"Manage"**, alone;
2. it is 10 px muted text with a 12 px icon, beside a 10 px "SUPPLEMENTS" label it visually matches;
3. it is on the screen *behind* the sheet giving the instruction.

Matching the words would have fixed one of the three. So **the note stopped naming a destination
and became one**: *"Your saved dose is 0.5 mg. **Change it**"*, which closes the vial sheet and
opens the manage sheet. The navigation is removed rather than described.

Closing one sheet while opening another in the same tick is the sibling sequence
`lib/hooks/sheet-back-stack.ts` handles deliberately — `pendingSelfPops` is module-level for exactly
that case (BF-34), with unit tests. Checked before wiring, not after.

The header control also got `.tap-target-44`, the utility for a small **isolated** control: a
`::before` hit box, so it gains a 44 px target without the header gaining a button. Isolated holds
— its only neighbour in the row is the non-interactive label.

## BF-185 — re-laned to A, unbuilt

The entry says *"Lane: B — the dose toggle in `components/nutrition/supplements-section.tsx`"*. The
toggle never sends a timestamp. `taken_at` is stamped at **`lib/data/postgres/adapter.ts:6756`** —
`lib/data/**`, Lane A by the path rule.

**And the re-stamp is deliberate and documented**, which makes this a request to reverse a decision
rather than to fix an oversight. The comment above the upsert reads:

> *"Re-logging re-stamps because the row is one act of taking it: if the dose was corrected between
> the untick and the re-tick, the second value is the true one."*

That reasoning is coherent. It is simply wrong for the case BF-184 needs, where the stamp feeds a
dose-timing correlation against overnight HR. Whoever takes it has to argue against that comment,
not delete it.

There *is* a Lane B half — the server already honours an explicit `takenAt`, so an editable-time
control can send one — but it is worthless until the re-stamp stops, because the next re-tick would
wipe the edit. Engine half first. The batch is split; a cross-lane batch cannot be one PR.

**This is the sixteen-and-counting pattern again:** an entry's stated cause and lane are prose until
something checks them. The check cost one grep.

## Verification

`e2e/bf186-saved-dose-note-is-the-door.spec.ts` creates a mg-dosed supplement, opens the vial sheet,
taps the note, and asserts the manage sheet opens and the vial sheet closes — plus that the dead
phrase is absent from the rendered copy. **Proven red with the callback unwired:** *"the saved-dose
note carries no control, so the dose stays unreachable"*.

`Ran 75 of 75` Custom Rules · **9048 vitest tests** (0 failed) · tsc clean · tests-typecheck at
baseline (320/90) · lint 0 errors.

## Not exercised

**The 44 px tap target**, which is the point of half the fix and the one thing a browser cannot
check: `domClick` bypasses hit-testing entirely, and synthetic input does not reach these handlers
at all (measured in `vial-dose-calculator.spec.ts`). The spec proves the wiring and the words. The
target is owed on the S25, and the entry carries `Verify: device` saying so.
