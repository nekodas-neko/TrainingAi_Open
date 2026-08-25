# 2026-08-25 — the nutrition screens move to the top, and the device run closes two gates

**Branch:** `feat/nutrition-screens-priority` · docs-only · BugFix Intake

## What this session did

Two things, in order, both driven by the owner.

**One: the nutrition arc was in two blocks 1,000 lines apart**, and the lower one — the meal
creator/planner — carried a heading reading *"Nutrition — pushed to the top"* while sitting below
the phases it follows. Fourteen entries now sit contiguously at the head of the queue.

The reorder's real finding was that **queue order was never what held the screens back**: every
Lane B entry in the arc was parked, and none of it on code — two on `Gate: device`, one on
`Needs:`, one on `Gate: owner`. Reordering alone would have looked like progress and delivered
none.

**Two: the owner ran the device checklist**, which is what unparked it.

## The device run

The owner ran a ten-step checklist on the S25 against v1.370.1 and answered every step. Both gates
passed:

- **Q-395a** (quantity sheet, v1.364.0) — the Remove button sits clear of the gesture bar, and
  Remove works end to end. The floored inset holds where bare `env()` would not. **Closed.**
- **Q-395b** (day screen, v1.365.0 + v1.366.0) — the meal list and the energy block render as
  grouped sections, the energy pair is one section, and no `bg-muted/60` child lost its background.
  The Samsung compositor hazard the gate existed for did not fire. **Closed**, which unparks
  **Q-395c**.

Both entries were removed from the queue rather than marked done in place, per the protocol.

**Not exercised:** the light-theme half (steps ⑤ and ⑨). It was not run, and BF-25 may delete the
requirement rather than satisfy it, so it is not being held open as a gate. If light mode survives
that decision, the quantity sheet needs a light-theme pass.

## What the run produced instead of closing

Four findings, none of them a check failure — all of them came out of the answers.

| Entry | From | Lane | Gate |
|---|---|---|---|
| **BF-24** — the shipped day screen and artboard 1 are different layouts | ② *"thats not what the mockup looks like"* | B | — |
| **BF-25** — the light theme has no switch, and the owner wants it gone | ⑤ | B | owner |
| **BF-26** — the quantity sheet's controls are all the same size, radius and fill | ⑧ | B | owner |
| **BF-27** — 5 of 45 sheets handle the Android back gesture | ⑩ | B | — |

**BF-24 is the one worth reading.** The owner attached artboard 1 for comparison, and its fixture
numbers (1,284 of 2,100 · 816 left · +412 burned · Breakfast 486 · Lunch 798) are the ones in the
attachment — so the attachment **is** the drawing, not a screenshot of the app. Reading the shipped
source against the artboard's inline styles found seven divergences, of which one matters most:
**the grouping is inverted.** Q-395b grouped meals within the screen; the drawing groups food rows
within a meal, with the meal name as a label outside its card. Both are "grouped", which is why the
checklist step passed and the screen still looked wrong.

Q-395b did not claim to build that artboard — it ticked a coverage list and measured gap
reclamation — so BF-24 is work that was never scoped, not a regression. The entry says so, to stop
it being opened as a bug against a phase that shipped.

**BF-27 is measured, not estimated:** `use-sheet-back-dismiss.ts` is imported by five components;
45 files render `<SheetContent>` and 6 render `<DialogContent>`. On roughly forty sheets the back
gesture navigates the page away instead of dismissing what is on top of it.

**BF-25 answers a question before proposing anything:** there is no theme switch. `setTheme(` has
zero call sites, and `app/layout.tsx:140` runs `defaultTheme="system" enableSystem`, so the theme
follows the phone. Light mode is not a choice the owner made; it is what the app becomes if the S25
is ever set to light. The recommendation is `forcedTheme="dark"` — one line, instantly reversible —
and explicitly **not** deleting the light palette, which costs nothing while unreachable and is the
half that cannot be undone.

## A defect this session introduced and caught

The reorder commit left a **headless orphan**: Q-395b's body without its heading, stranded where the
block used to be. `check-backlog-pointers.js` did not catch it, because the check keys on headings
and this fragment had none. It surfaced only as a merge conflict against `main`, where #455 had
deleted the same region for its own reasons.

Worth noting for the next person who moves a block: the conflict was **two deletions of overlapping
regions**, the shape this repo's own rule warns about — resolving it meant keeping *neither* side,
since one side's content had already been moved elsewhere in the same branch.
