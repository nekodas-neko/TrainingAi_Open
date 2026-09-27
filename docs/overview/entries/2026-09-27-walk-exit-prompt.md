# LB-141 — the back gesture asks now, and only one of the two exits was ever real

**Branch:** `feat/walk-exit-prompt` · **Lane B** · `lib/stores/**`, `components/guided-walk/**`,
`components/shell/**`.

Leaving a guided walk by anything other than the End button called `reset()` and kept nothing, at
any duration — walking away from a 39-minute walk discarded it. The owner answered this on
2026-09-26: **prompt on both**, save-or-discard, over the recommended silent save.

## The entry named two exits and one of them cannot fire

LB-141 was filed from a source read of the three `LeaveWalkDialog` callers. Rendered at 412 px with
an active walk seeded into the store, `/activity/guided-walk` has **zero `nav` elements** and offers
exactly one exit, `End walk`. `BottomNav` is mounted by `tab-shell.tsx`; the walk is its own route
outside that shell, so the component's `pathname.startsWith('/activity/guided-walk')` guard is never
true while it is on screen. **The tab-bar exit discards nothing today.**

So the real subject of this entry is the **hardware back gesture**, which is global and does fire.
`e2e/lb141-walk-exit-prompt.spec.ts` pins the reachability fact, with a failure message naming what
to do on the day it changes; whether the walk should be immersive at all is filed as **LB-174**,
`Lane: O`, with a recommendation.

## What shipped

A `'choose'` shape on `LeaveWalkDialog` — three stacked buttons, save first — behind a discriminated
union, so a caller cannot offer the choice without wiring the save. Under `MIN_WALK_SEC` both exits
fall back to the same `'discard'` confirm the End button already shows (BF-191), rather than
offering to save a walk too short to record. Rendered at 384 px: 336×48 each, dialog 300 px tall.

**Save could not be one call, which is the part worth knowing.** The walk's HR samples and cadence
live in `WalkActive`'s refs and the row is written by `WalkSummary`'s **mount** — neither is
reachable from a shell-level handler. Flipping `mode` to `'done'` from out there would read as a
save and write nothing, and `onRehydrateStorage` resets a `'done'` walk on the next load, so it
would not even survive. So the exits set `finishRequested` on the store and the walk screen runs its
own `endWalk`; **Save therefore stays on the walk and lands on the summary rather than going where
the user tapped**, because the summary is both the write and the confirmation it happened. The flag
is cleared before `endWalk` (which unmounts the watcher) and on rehydration (a stored `true` would
end the next walk on launch).

`MIN_WALK_SEC` moved to the store beside a new `walkElapsedSec` — three places now compare against
that floor and must agree, and importing `walk-active.tsx` into the shell would pull the whole walk
screen into every route's bundle for one integer.

## A guard that pinned the old policy

`bf190-bf191-walk-end.test.ts` asserted `outcome="discard"` at both exits — the exact behaviour the
owner changed. It now asserts what BF-191 actually guarantees (one prompt; no offer to save below
the floor) plus LB-141's own shape, and both still hold. Two smaller edits came from the same file:
the early-exit call moved to `elapsedRef.current` so the finish-request effect stays stable, and the
regex that reads the save handler accepts the shell's `requestWalkFinish` alias — a property, not a
name.

Both call sites render **two elements on a ternary** rather than one with conditional spread props.
That is deliberate: a spread hides `outcome=` from the source guard that exists to stop a caller
inheriting a default, and loosening the guard to fit my code is the wrong direction.

## Verification

`tsc` clean · Custom Rules **83 of 83** · lint 0 errors · full unit suite green · build clean ·
`bf190-bf191-walk-end.test.ts` 11/11 · the reachability spec green.

**Not exercised — the prompt itself.** The back gesture is a Capacitor `backButton` listener with no
web equivalent, so nothing here presses it. The dialog was rendered at 384 px by temporarily
loosening the tab-bar guard, capturing, and reverting (`git diff` clean) — a different trigger
reaching the same component, which is evidence about the component and not about the gesture. The
save path in particular writes through `WalkSummary`, and `getLocalStore` returns null in the
sandbox, so the branch that writes the row is one a browser here cannot reach. A Known-Issues row
states the pass test on the S25.
