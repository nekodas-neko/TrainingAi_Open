# 2026-09-04 — the header row got an overflow strategy, not more shrinking (BF-116)

**Branch:** `fix/bf-116-header-chip-overflow` · Lane B · CSS and one extraction, no APK.

The owner: *"the grid and battery pill still intersect."* **"Still" is the word that mattered — the
cause was the previous fix.**

## How a correct fix became the next bug

BF-96 gave the weather chip `whitespace-nowrap shrink-0` on 2026-09-01, and it was right: the chip
was the row's only compressible item, so it absorbed 100% of any shortfall and `UV 5` broke at its own
space, two lines tall. Q-111 then added device chips on 2026-09-02 carrying the same pair, and the
date already had it.

**So every item in the row became unshrinkable, and a shortfall had nowhere to go.** It used to wrap;
now it overflowed. `HeaderChips` returns a bare fragment, so there was no wrapper to constrain either
— content spilled past the `flex-1 min-w-0` column and crossed the action buttons.

## What shipped

**The date is the item that gives.** It is the longest, the least informative, and the only one whose
length varies — `EEEE d MMMM` runs 12–20 characters across the year, which is the variable BF-96 had
already identified as running the row out of width. It drops `shrink-0` and takes `truncate min-w-0`;
`min-w-0` is what lets a flex item shrink below its content at all.

**`overflow-hidden` on the row is the floor, not the fix.** Once the date has truncated to nothing,
chips alone can still outgrow the width — a third is already expected, since anything with a battery
is a candidate and only the scale deliberately has none. Clipping keeps that case off the buttons.

**The chips keep `shrink-0`,** because wrapping them is the bug BF-96 fixed. The entry is explicit
that this row wants an overflow strategy rather than more or less shrinking, and that holds.

## The extraction was forced, and it was the right shape anyway

The explanatory comment pushed `session-select-content.tsx` past its shrink-only baseline (1454
against 1448), and the rule at that hotspot is to extract rather than append. So the row moved to
`components/home/header-meta-row.tsx` — which is the same reason `HeaderChips` exists, per its own
doc comment. The hotspot ended **7 lines smaller** than it started.

One detail worth not losing: `HeaderChips` was a `dynamic(…, { ssr: false })` import in the page. The
chips fetch; the date does not. Making the whole row lazy would blank the header on first paint,
which the instant-paint rule calls the worse outcome — so the dynamic import moved *inside* the new
component, and the date still paints immediately.

## BF-96's own guard caught this, which is the best thing that happened

`swipe-marker-honoured.test.ts` asserted the date carried `whitespace-nowrap shrink-0`, and said of
itself: *"if the date ever becomes compressible this guard is the wrong shape — but it would also
mean the row's behaviour under pressure changed, which is worth a failing test rather than silence."*
It failed on exactly that. **It was updated, not deleted** — the chip must still resist compression,
but the reason changed, and the assertion now points at the new file and the new contract.

Five more cases in `components/home/__tests__/header-meta-row-overflow.test.ts`, **three mutations
killing them**: putting the date back to `shrink-0` (the original bug), removing the overflow guard,
and making the chips eager. Full suite **6,461 passed / 0 failed**, run twice — the first two runs
reported one failure and that was BF-96's guard, so the green is confirmed rather than assumed.

## Not exercised

**The device, at the S25 width, which is the whole verification.** This is a CSS reflow: both vitest
projects run `environment: 'node'`, so nothing here renders, and the guards read classes rather than
layout. BF-116's check stands unchanged — on the longest weekday-plus-month combination
(`Wednesday 30 September`) with weather and two device chips, nothing may cross the grid icon and no
chip may wrap; with one chip and a short date the layout must be unchanged.
