# Nutrition stops reading a partial day as a fault, and one item goes back to the owner

Implementation Lane B, 2026-09-27. `RV-212` items ①②; ③⑤ were already struck by sweep 64; ④ is the
owner's and is now `LB-167`.

## What shipped

1. **The energy-balance headline is no longer painted by zone.** At 2 pm a legitimately partial day
   drew a red 2xl number, which reads as an error rather than as "the day is not over".
2. **A taken supplement is muted rather than struck through.** A strikethrough reads as cancelled
   or deleted; taken is the opposite, and the green tick beside it already carried the meaning.

## Item ① was half-shipped on purpose, and the half not done is the interesting one

The entry asked for neutral *everywhere* while the day is open. `energy-card.tsx` had already faced
this and split it: plain foreground for the number, **colour retained on the label** because the
label carries " so far" on the current day, which makes it a running state rather than a verdict.
Its comment names `CalorieBalanceBar` as the component still colouring the number — so the fix here
was following an in-repo decision, not inventing one.

Overriding the label half would have re-litigated a documented decision on evidence the entry did
not bring. What the entry *did* add is the compounding — "in red, over a red bar" — and removing the
largest red element addresses that without discarding the qualified verdict. Both halves are pinned
by the test, so a later sweep cannot quietly take the label's colour as well.

## The sibling that must NOT be swept

`manage-supplements-sheet.tsx` also strikes through a supplement — but on `!s.active`, meaning
discontinued, where crossed-out is exactly right. A sibling-surface sweep on "line-through in
nutrition" would have taken both. The test asserts that one survives.

## Item ④ goes back to the owner, because he specified it

The entry asked to drop the meal tile's fork-and-knife placeholder as reading like a failed image.
`meal-thumb.tsx` records his instruction in its own docstring — *"it should show the default one in
the mockup if no image is attached"* — and states the placeholder is *"the always-present state,
not a fallback bolted on afterwards"* (BF-32), because a row without the box makes the list read
ragged.

Implementing it would undo a design he asked for, which is the shape the Coach-label revert
(`LB-164`) was about. Filed as **`LB-167`, `Lane: O`, ungated** — getting the answer is the work, and
`Gate: owner` would park it out of the Orchestrator's list. The brief recommends keeping it, names
what dropping it would genuinely be better at, and offers a third option (keep the tile, change the
glyph) that nobody has costed.

## Not exercised

**Not verified on device.** Both changes are colour and text-decoration on daily nutrition
surfaces, delivered through a normal Railway deploy with no APK. The sandbox cannot speak for how
the muted row and the now-uncoloured number read on the S25 — but neither adds an element, so there
is no layout risk, and no Known-Issues row is claimed for a device pass that would only confirm a
colour.
