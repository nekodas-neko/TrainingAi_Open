# The button on the collection widget was the moon

Implementation Lane B, 2026-09-26. `BF-208`, and the revert of half of `BF-206`.

## What the owner was pointing at

*"there is that button on the widget the white circle"* — then, after a first trace landed on the
wrong control, *"No not the ai coach white button; its the one on the collection widget."*

It is decoration drawn to look exactly like a control: in `scene-meadow.svg`,
`<circle cx="300" cy="36" r="14" fill="#f3ecd2"/>` — a **28 px solid near-white disc** on a night
sky, rendering near 1:1 into the pen, in the upper-right corner. Four things converge: it is the
highest-contrast element on the card, brighter than any text; it is a hard-edged filled circle,
the shape of every icon button in the app; it sits in the corner that means "control"; and
`+12 more` sat 30 px to its left, styled as a pill.

## What shipped

Each offending disc is softened and moved off the corner — meadow `cx 300 → 72` at `.55`, space
`cx 300 → 82` at `.8`, kitchen `cx 290 → 232` at `.6`, staying inside its drawn window frame. That
breaks two of the four factors, which is what the entry asked for. And `+N more` is a caption now
rather than a pill, keeping a text shadow in place of the background plate because the scene
behind it ranges from a night sky to a kitchen wall.

**Making the chip a real button was the wrong call and stays rejected:** the whole card is already
the link to `/collection`, so a button inside it is a second tap target for the same destination —
the nested-interactive shape the repo's own Custom Rules check exists to catch.

## The scenes are generated, and a guard caught me editing the output

The first pass hand-edited `public/cats/scene-*.svg`, and
`collection-sprites.test.ts` failed with *"an edit to the art source without a rebuild fails
here"* — the twelve backdrops come out of `scripts/collection-art/scenes.mjs` via
`build.mjs`, and the test compares every file on disk against the generator's output. It was
right and the fix went into the generator. Worth knowing before touching this art again:
`public/cats/` is build output, not source.

(Space's disc turned out to be a *ringed* planet, so the `<ellipse>` had to travel with it. The
hand edit would have left the ring behind in the corner.)

## The sweep found a different set than the entry predicted

The entry expected `space`, `snow` and `bedroom` to have their own bright disc in the same corner.
Measured across all twelve: it is **`meadow`, `space` and `kitchen`**. `snow` and `forest` have no
large disc at all; `bedroom`'s sits at `cx=90`, the left quarter, so the corner factor fails; and
`kitchen`'s is a moon inside a drawn window frame, which nothing in the entry would have suggested.

`components/home/__tests__/bf208-pen-corner.test.ts` holds the corner for the thirteenth scene:
any `<circle>` of r ≥ 6 at opacity ≥ .9 with `cx > 240, cy < 60` in any `public/cats/scene-*.svg`
fails it. That is the half a one-file fix leaves open, and the reason the entry called for a sweep.

## And the revert

`BF-206` was filed against the wrong button by the same misread, and the Orchestrator struck its
second finding — *"nothing identifies the Coach button"* — as an unrequested restyle of a working
control. **#1730 had already shipped it.** The extended "Coach" pill is reverted here.

Keeping it because it was already merged is the tempting move and the wrong one: it is a visual
change to the screen the owner opens first, he did not ask for it, and CLAUDE.md puts that on his
side of the line. The case for a label is genuine — a sparkle is this app's generic AI mark, so on
its own it names a category rather than a destination — so it is filed as `LB-164`, an owner
preference with a recommendation attached, rather than deleted.

The clearance half of `BF-206` stands untouched: it was measured from the CSS rather than inferred
from his words, so it is true whatever he meant.

## Failure surfaces not exercised

The S25. Whether a moon at 55 % still reads as a moon rather than a smudge is the owner's eye, and
the pen is his screen. Rendered at 412 px dark here with a stubbed collection: the corner is clear
and the caption is legible over the sky.

## Verification run here

`pnpm lint` · `pnpm check:rules` Ran 80 of 80 · `pnpm test` · `pnpm build` · `tsc --noEmit` ·
`check-test-typecheck` · doc-size, backlog-pointers and doc-links green. 13 new assertions across
the twelve scenes; control run: restoring meadow's moon fails the corner guard.
