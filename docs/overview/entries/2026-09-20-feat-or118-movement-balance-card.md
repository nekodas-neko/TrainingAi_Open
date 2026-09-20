# 2026-09-20 — OR-118's movement balance card, and the four days it spent invisible

**Branch:** `feat/or118-movement-balance-card` · **Lane B** · code + docs · no migration ·
**v1.460.0**

Lane B's READY list read **0** for five consecutive queue checks. It was wrong, and the way it was
wrong is worth more than the card.

## The card

Health tab → Training → **Movement Balance**: how the last 60 days of sets split across push, pull,
legs and core. `components/health/movement-balance-card.tsx` fetches `/api/muscle-sets` over a
trailing 60 days and folds the rows with `movementPattern`; `components/health/movement-balance.ts`
holds the fold as a pure function so it can be tested in the node environment.

Both halves it depends on had shipped and had **no callers**: `/api/muscle-sets` (LB-111,
2026-09-18) and `movementPattern()` (LB-103, 2026-09-13). This is the first caller of each.

**No target and no verdict.** There is no defensible universal push:pull ratio, and the owner asked
to see the split rather than be graded on it. All four rows always render, zeros included — **an
empty pull column is the finding**, so dropping empty rows would hide the one case worth seeing.

**Why not the windowed route that already existed.** `muscle-tonnage-trend` spans weeks but reports
tonnage. Legs move far heavier loads, so a tonnage share overstates them and would have hidden the
pull deficit the card exists to show. Rendering it under a set-balance label would be a false claim.

## Why it was invisible, which is the part to keep

Nothing blocked OR-118 after 2026-09-18. Its `Needs:` was empty and the entry said in words that it
was *"now startable"*. It printed under PARKED anyway, because `next-item.js:97` reads a `⛔`
**anywhere** in an entry as the legacy prose blocker — and three bullets up, one was being used as
emphasis on a corrected premise.

That is **LB-121**, filed two days earlier by this lane, and this is its first measured cost: a
buildable card sat behind a READY list reading 0. Two more Lane B entries are parked the same way
right now, **TN-3b** and **Q-305**, both recorded on LB-121 rather than quietly unparked.

**The habit that found it:** when READY reads 0, read PARKED. The baton already said so — *"READY
running low is not 'no work'"* — and it took five checks before I did it.

## Verification

`movement-balance.test.ts`, 11 cases, and the mutations are what make them worth quoting:

| mutation | result |
|---|---|
| ignore the shared classifier (everything → `other`) | **5 fail** |
| drop zero rows | **5 fail** |
| sort rows by size instead of the fixed order | **1 fail** |
| drop the non-finite / negative guard | **1 fail** |

`e2e/or118-movement-balance-card.spec.ts` proves the card is mounted and renders all four patterns,
and goes red — *"the card is not mounted in the Training list"* — with the section unregistered.

**It refuses the empty state deliberately.** `seed.sql` logs Bench Press at 2, 3 and 5 days ago with
`muscle_groups = '{chest}'`, so a fresh CI database lands in-window with one pattern populated and
three at zero: the drawing path and the zero-row case exercised in the same run. Accepting "no data"
would have been the LB-98 trap, where a spec can only ever assert that nothing is there while the
path that draws the bars ships unexercised.

The hex-literal ratchet caught the first version's palette. The four colours are theme tokens now
(`--accent-cyan` / `--accent-purple` / `--accent-green` / `--color-muted-foreground`) — four
*categories*, not a scale, so none of them is green-for-good; colouring push green would imply the
verdict the card refuses to make.

## Gate

`Ran 75 of 75` Custom Rules · **8988 vitest tests** (948 files, 0 failed) · new e2e green and
`cardio-baselines-placement` (the sibling Training-panel spec) still green · tsc clean ·
tests-typecheck at baseline (320/90) · lint 0 errors.

## Not exercised

**The S25.** The pattern word sits beside a set count and a bar on a narrow row — that is a
412 px-width judgement the harness can assert the existence of and not the look of. `Verify: device`
on the entry.

Also untouched: offline/local-store paths (this card is a server read with no local mirror), and
the accuracy of the underlying attribution, which is LB-111's and was pinned there.
