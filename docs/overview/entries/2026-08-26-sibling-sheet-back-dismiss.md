# 2026-08-26 — The dialog that closed on the frame it opened (BF-34)

**PR:** `feat/capture-one-screen` · **Lane B** · **Gate: device**

## What the owner saw

*"the delete feature doesnt work. so its not removing from my.UI"*, then the detail that decided it:
*"when I press the delete button; it opens up the confirm dialog; but then instantly minimizes so we
cant click it."* Opens and is then dismissed — not the `pointer-events: none` variant, where it would
sit there ignoring taps.

## The cause, and why it was app-wide

The diary's quantity sheet closes itself and opens the confirm dialog **in the same tick**
(`quick-edit-log-sheet.tsx:140`). React runs the unmounting cleanup before the mounting effect, so
the sheet's `history.back()` is already in flight when the dialog mounts. The dialog then receives a
pop carrying a state that is not its own — indistinguishable from a real back gesture — and closes
itself.

The flag that marks *"this pop is one of ours"* was **per-instance**. That is exactly why the dialog
could not see it: a sheet closing and a dialog opening are different hook instances. Since BF-27 put
`BackDismiss` inside every `SheetContent` and `DialogContent`, every close-one-open-another
transition in the app ran this sequence; the diary delete is only the first one pressed.

It is a **module-level counter** now, consumed by whichever surface receives the pop, which then
re-pushes the entry the surface still open needs. One listener owns the stack rather than one per
instance — and keeping it attached for the life of the page is what stops the counter leaking, since
our pop is consumed even when it arrives with nothing open. Before, a stale flag made the next sheet
skip its push and left it with no entry at all.

## Two corrections to the entry's own analysis

**The prescribed fix had an ordering trap.** "Share the flag across instances" is right, but `absorb`
— the listener that clears it — is registered by the *closing* sheet, so it runs **before** the
newly-mounted dialog's handler and would clear a shared boolean too early. Consuming it reliably
needs one listener that always exists, which is what turned a one-word change into a small rewrite.

**LB-17 (v1.382.0) did not fix this**, though it changed the same line hours earlier. That was the
*nested* case — a back landing on the middle sheet's entry, closing the bottom one too. This is the
*sibling* case. Different failures through one guard; the fix keeps both mechanisms, depth and
counter.

## Why the logic moved to its own file

`lib/hooks/sheet-back-stack.ts` now holds the decision — when to close, when a pop is ours, how deep
a surface sits — and `use-sheet-back-dismiss.ts` is React wiring and nothing else. All three failures
this primitive has carried (LB-10, LB-17, BF-34) were in *when to close*, and every one was found on
a device or in an e2e run because while the logic sat inside an effect there was nothing smaller to
aim at.

Seven tests drive the sequences directly, with an injected fake history that models `back()` as the
async traversal it is. **Reverting to the per-instance flag fails both sibling tests and the
StrictMode one** while the nested tests keep passing — which is the check BF-34 asked for, that a fix
does not trade one case for the other.

## What I got wrong on the way, since it will be tried again

I claimed a web reproduction and did not have one. The sibling sequence **cannot be staged through
the web UI**: the bin that triggers it is not actionable in Chromium at all — `locator.tap()` times
out on it. A raw coordinate tap "worked" only in the sense that it landed on the overlay, closed the
sheet, and never called `onDelete`, so the dialog never mounted. That reads exactly like the bug and
is not it. A `MutationObserver` installed before the tap is what settled it: one transition, the
sheet closing, and no dialog mount to close.

## Not exercised

- **The S25.** Verified against the state machine and the nested/StrictMode e2e specs, never on
  device. The device press: tap a diary row, tap the bin, the confirm dialog must **stay** open and
  be tappable, and Cancel must cancel. Then the LB-17 nest (Log Food → My Foods → a meal) must still
  unwind one layer per press.
- Samsung's WebView popstate timing, which is where BF-27's gate always pointed.

## Files

`lib/hooks/sheet-back-stack.ts` (new) · `lib/hooks/use-sheet-back-dismiss.ts` (now wiring only) ·
`lib/hooks/__tests__/sheet-back-stack.test.ts` (new, 7 tests).
