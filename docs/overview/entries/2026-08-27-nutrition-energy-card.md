# 2026-08-27 — Artboard 1's energy block, and the number it did not change (BF-24 ②)

**Lane A working Lane B's surface at the owner's request · branch `feat/nutrition-energy-card`**

BF-24 shipped artboard 1's header and meal grouping and kept four items. ② was the energy block: the
drawing puts a 104 px donut and the day's numbers in **one card**, where the screen had
`CalorieBalanceBar` and `MacroRing` as two rows of one grouped section. The entry deferred it because
`CalorieBalanceBar` also renders on `/health`, so merging the two components would have changed two
screens.

**That risk never arose, because the merge did not have to touch the shared component.** The day
screen gets a new `components/nutrition/energy-card.tsx`; `CalorieBalanceBar` is untouched and still
serves `/health`. `MacroRing`, whose only call site was the day screen, is deleted.

## The premise I got wrong, on my own reasoning this time

Reading the two components side by side, they appeared to show **two different "left" numbers**:
`MacroRing` drew `targets.calories − eaten`, a static goal; `CalorieBalanceBar` leads with
`remainingKcal`, which accounts for what you actually burned. On an active day those differ by
hundreds of kcal and both were labelled "left" — Q-401's exact shape, one row above the other. I
wrote a component doc saying so, and a resolution for it.

**It was already handled.** `nutrition-content.tsx` computes `effectiveTargets` with
`calories: effectiveCalorieGoal` — the burn-aware `budgetProvenance(...).total` — substituted in, so
`MacroRing` was drawing the same number all along. The two agreed by construction:
`budget.total − intake` on one side, `expenditure + targetNet − intake` on the other, which is the
same subtraction written twice.

Worse, my first draft called `budgetProvenance` **inside the card**. That is precisely the fourth
number Q-417 warns about (*"this used to be `targets.calories + activeEnergyKcalToday`, and it
produced a third budget"*), and it would have bypassed Q-323's earned-scaled macro targets — the fix
for a day with 551 kcal earned reporting fat *over* when it was well under.

The card now takes `goalCalories`, `earnedKcal` and the **effective** targets as props and derives
none of them. Three findings put that discipline there; a component that re-derives is how a fourth
gets added.

## What shipped

- **`EnergyCard`** — one card: 104 px conic donut (`intake of goal`, arc split by macro share), the
  headline `N kcal left` / `over` with `+N burned` opposite, and three macro columns (`%` in the
  macro colour, grams, name). Below a divider, still inside the card: the zone label and
  `CalorieZoneBar`, with Eaten/Burned/Net and the maintenance line behind the existing info toggle.
- **Two deliberate differences from the drawing, both stated per BF-28's verification rule:**
  1. **The zone band is kept**, below the two drawn rows. The artboard stops at the fold and the band
     is the only thing that says whether "left" is on track rather than arithmetic. It went inside
     the card rather than into a second one, because a second card is what Q-395b already found reads
     as two unrelated things.
  2. **The macro target rides on the grams line** (`87 /150 g`) rather than becoming a fourth line.
     Dropping it would leave the day screen with nowhere to see protein against target, which on a
     training app is a daily number; Profile is where it is *set*, not tracked.
- **One correction to the drawing.** The artboard's headline is plain foreground and
  `CalorieBalanceBar` coloured it by zone. Kept plain: colouring it paints the headline red at 10 am
  on a day that is legitimately "well under **so far**" — the qualifier `CalorieBalanceBar`'s own
  comment says exists so the bar is not read as a verdict. The verdict keeps its colour, on the label
  below where it is qualified.

## Verification

Rendered at **412 dp in Chromium, dark**, logged in as the seeded user with four food logs, and read
against the artboard: donut, headline, `+burned`, three macro columns, band. **Zero page errors** on
both `/nutrition` and `/health`. `tsc` clean, lint clean, and the UI ratchets —
`check-hex-literals` (427, unchanged: the macro palette is imported, not pasted),
`check-component-size`, `check-memo-prop-stability` — all pass.

**A local-environment trap worth recording.** The first full-suite run failed one file with
`role "claude_readonly" already exists` — `claude-ro-owner-bootstrap.test.ts`, whose `beforeAll` does
`DROP ROLE IF EXISTS` (swallowed) then `CREATE ROLE`. Cause: **`pnpm dev` was running against the
same local Postgres**, and its `ensureSchema` re-applies the `claude_ro` views migration. It passed
6/6 alone with dev stopped. That is a third signature for the same class as the advisory-lock and
`rate_limits` ones already in `CLAUDE.md`: **stop the dev server before believing a DB test failure.**

## Not exercised

**The S25.** Safe-area insets render 0 in the sandbox and Samsung's compositor is not Chromium — and
this card is a conic-gradient donut, which is exactly the construct the repo prefers *because* of that
compositor, so it wants a look. BF-24's device gate already covers artboard 1 and now covers this too.
