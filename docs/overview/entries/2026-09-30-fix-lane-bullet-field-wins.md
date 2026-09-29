# 2026-09-30 — the bullet that declares an entry's lane now outranks a quoted lane in its prose

**Branch:** `fix/lane-bullet-field-wins` · **Lane A** · queue tooling.

## What was wrong

`RV-208` was in Lane A's READY list while its own field reads `- **Lane: B.**`. Forty lines above
that, its body says the time-of-day item was *"moved out to `LB-183` (`Lane: A`)"*. `lane.js` already
let a field-form lane outrank bare prose, but a **quoted** field in the prose is field-shaped too, so
the first one won.

## What changed

- `scripts/lib/lane.js`: a `Lane:` field that opens a bullet (`LANE_BULLET_RE`) wins over any other
  mention. After it come any field form, then loose mentions, as before. The bare bullet
  `- **Lane B**` is deliberately not included, so the existing "disagreeing bare mentions read `?`"
  rule is unchanged.
- **Measured across all 520 entries, old parser against new: exactly three change, and all three move
  to their own bullet field.** `RV-208` A→B, `TN-67` T→B (its prose cites `OR-200` as `Lane: T`),
  `TN-33` O→A (its prose quotes `Lane: O`).
- `RV-218` gains `Needs: LA-180`. Its one open item, ①, is which number the ring's budget stands on,
  which is the owner's answer on `LA-180`. Until then it headed Lane A's READY list with nothing
  buildable.

## Verified

`backlog-lane-resolution.test.ts` gains the three real shapes, and all 457 script tests pass.
`check-backlog-pointers` is OK.
