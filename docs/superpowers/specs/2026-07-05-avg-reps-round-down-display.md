# Recommended-workout card: round average reps down, not to nearest — Design

**Date:** 2026-07-05
**Status:** Approved by user (session request)
**Branch (this planning PR):** `claude/average-sets-reps-review-13gndm`

## Problem

The "Recommended Workout" card (pre-workout screen, and the calendar day-detail
sheet once #11/U9 lands) shows one representative line per exercise, e.g.
`9 × 60kg · est 1RM ~85kg · 28 June`. The rep count is `avgReps()`
(`components/workout/pre-workout-screen.tsx:40-44`), which does
`Math.round(mean(lastReps))`.

`Math.round` rounds `.5` up. Verified against a real logged session (Pull, 28
June): Sumo Deadlift sets were `8, 8, 8, 10` (mean 8.5 → displayed **9**) and
Pull-Up sets were `5, 4, 4, 5` (mean 4.5 → displayed **5**). Both cards show a
rep count the user never actually hit on more than one of four sets — the
display overstates what was consistently achieved.

## Decision

Change the display helper's rounding from "nearest" (`Math.round`) to "down"
(`Math.floor`). Rationale (user-confirmed):

- **The card should show a number of reps the user is guaranteed to have
  completed**, not a number that can round up past every set but one.
- **Zero effect on 1RM math.** `estimated1rm` is computed server-side in
  `app/api/workout-data/route.ts` from the raw per-set log (via `lib/1rm.ts`),
  independently of this display helper — confirmed by reading both call
  sites. Changing `avgReps()`'s rounding only changes the text on the card.
- Scope is display-only: no change to `estimated1rm`, `target80`, stored
  `avg_reps` (1-dp, computed separately in `lib/workout/log-exercise.ts` /
  `app/api/workout-entry/route.ts`), or any progression/periodization math.

## Coordination with already-queued work

Two other queued backlog items touch this exact function and must not
contradict this decision:

1. **Backlog #2 (`docs/superpowers/plans/2026-07-04-acwr-formula-consolidation.md`,
   Task 4)** plans to extract a shared `computeSetAggregates()` and have
   `pre-workout-screen.tsx`'s display helper "reuse the same `avgReps` (1-dp)
   rather than its own integer version" — i.e. it currently proposes dropping
   the integer rounding entirely in favour of the stored 1-decimal value. That
   would silently undo this change (a 1-dp value has no "round down" concept
   applied to it the way a whole-rep display does). Task 4's wording has been
   amended in place (this session) to keep the *display* copy as a rounded
   integer, sourced via `Math.floor`, even after the extraction — only the
   log/edit-path trio (`volume`, `intensityPct`, stored `avg_reps`) gets
   deduplicated into the shared helper.
2. **Backlog #11 (`docs/implementation-backlog.md` item 11, U9)** plans to
   export `modalWeight()`/`avgReps()` for reuse in the calendar day-detail
   sheet. Whichever of #11 or this item lands first must preserve the other's
   requirement: exported, and floored.

## Non-goals

- Not touching `live-1rm-readout.tsx`'s separate `avgReps` (already displays
  1-dp live-set averages during an active exercise, a different UI with a
  different, already-correct honest-average intent — out of scope).
- Not changing `modalWeight()` (weight display is unaffected — this is a
  reps-only rounding concern).
