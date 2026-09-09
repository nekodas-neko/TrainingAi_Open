# 2026-09-09 — the injury warning moves to where the decision is made (BF-135)

**PR:** `fix/injury-header-crowding` · **Lane B** · `components/workout/active-workout-screen.tsx`,
`components/workout/injury-notice.tsx` + `injury-muscles.ts` (new).

The owner, mid-set on Legs: *"ui gets a bit quoted for injury ones"* — Barbell Hip Thrust carrying
the injury banner, the AMRAP banner, and set 1 disappearing behind the logging sheet. BF-135 traced
it: the active-exercise header is `flex-none space-y-2 mb-2` above a `min-h-0` set list, nothing in
that branch has `overflow-y-auto`, so every row the header grows squeezes the rows below with no
scroll to recover them.

## What shipped

- **The full banner moved to the ready screen**, above the bar-load card, the warm-up ramp and the
  set targets. That is where swapping a movement or going lighter is chosen — not between set 3 and
  set 4 — and **that screen had no injury warning at all before this**, so the warning used to arrive
  after the weight was already picked. It scrolls, so it costs no other content.
- **During the set it is a chip** on the exercise-name row: `⚠ Injury: Chest  Swap`, 157 × 48 px,
  clearing the repo's 48 dp tap floor without a second row. Swap comes with it — BF-135 rules out
  suppressing this warning, and the swap is its only action.
- **`injury-notice.tsx` renders both**, from `injuredMusclesFor()` computed once, so the two screens
  cannot come to disagree about the same injury.
- **The header gained `max-h-[45%] overflow-y-auto overscroll-contain`.** With the banners gone it
  never engages; it is there so the next conditional thing added to that block scrolls instead of
  pushing set 1 off-screen.

## The AMRAP banner is deleted, not made conditional

BF-135 recommends showing it on the first exercise of a baseline session only. **The ready screen for
every exercise already carries the same instruction in fuller form** — *"Pick a weight you can manage
for 8–15 reps. Do as many reps as possible with good form — this sets your working weights for the
whole program"* — and every exercise passes through that screen before its sets, including one
resumed from a superset buffer, whose `timerStarted: true` only exists because it was started there.
So the active-screen banner was a strict duplicate of copy the lifter had just read, costing a
full-width row on the most contested space on the screen. "First exercise only" is still one row of
duplication.

Worth stating why it never stopped appearing: `isBaseline` is gated on the phase, and **BF-131 is why
the baseline never completes**, so this was permanent rather than a first-session artefact.

## Two smaller things found in the same code

- The old filter concatenated `mainMuscles` and `secondaryMuscles` and never de-duplicated, so an
  exercise listing the injured muscle in both read *"Lower back, Lower back — train with caution"*.
- It hand-rolled the lowercase comparison against `activeInjuries`. It now goes through
  `activeInjuredMuscles()` — the shared definition the swap sheet's own filter already reads — while
  keeping the exercise's spelling for display, since the shared list is lowercased.

The chip says `Injury: Chest` rather than `Chest`: the bare muscle name beside the title reads as the
back arrow two rows above when the muscle *is* `back`, and a safety warning is the wrong place to
make someone work that out. More than one injured muscle shows as `Lower back +1` — the count rather
than a truncated list, with the full list in the ready-screen banner and in the chip's accessible
name.

## Verification

`pnpm dev` against the local non-prod database, driven through the Playwright harness at 412 px with
an injury seeded on the reached exercise's muscle. Rendered and measured on both screens: the ready
banner sits above the bar-load card with Swap reachable; the chip is 157 × 48 px on the name row; the
active header measures 210 px including the set grid, all sets visible, `Log Set 1` at y = 803 of
915. Screenshots taken and read.

Full unit suite green; `pnpm check:rules` **Ran 71 of 71**; production build clean.

**Not exercised, and this is the gap that matters:** the reported case is an injured exercise on a
**baseline** session — the two-banner worst case. The seeded account is mid-`Accumulation`, and
forcing `isBaseline` needs the program's phase set rewritten, which the sandbox seed does not carry.
So the two-banner state was reasoned about and its removal is pinned by a source test, but it was
never rendered. Nor was any of this seen on the **S25**, where the failure actually lives — the log
sheet covering the bottom half of a real device is what BF-135 asks for a device look at.
