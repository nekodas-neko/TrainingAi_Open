# "205 workouts" was 205 kcal, and a deficit was printed twice over

Implementation Lane B, 2026-09-27. `RV-218`'s copy bugs. The rest of the entry is Lane A's, and
this establishes that rather than assuming it.

## What shipped

- **`movementSummary` gives every addend its unit.** Under a calorie bar it read *"205 workouts ·
  32 steps"*, where both numbers are kcal — so it parsed as a **count** of workouts and a number of
  steps. That is a different claim about the same day, and a plausible one. It now reads
  *"205 kcal workouts · 32 kcal steps"*, fixed once in the single producer that feeds both Home and
  Nutrition.
- **The deficit prints its magnitude.** `energy-timeline-chart.tsx` printed the signed `net`, and
  on that branch `net` is negative — so the minus sign and the word "deficit" both said "under",
  which reads as a *negative deficit*, i.e. a surplus.

**The surplus branch keeps its "+" deliberately**, where sign and word agree. That asymmetry is
pinned by a test, so nobody tidies it into a second double negative.

## The test caught my own change, which is the guard working

`movement-breakdown.test.ts` pinned the exact string `"320 workouts · 227 steps"` and failed the
moment the unit went in. Updating it was right — but pinning a whole string is what made it a
tripwire rather than a guard, so the new case asserts the unit **per addend** with a regex. A
reworded separator or a reordered list can no longer quietly drop it.

## One of the three copy bugs was already fixed

*"0 / 1534 kcal"* beside *"1,534 left"* was **RV-208's separator item, shipped in #1743 earlier the
same day**. `home-nutrition-card.tsx:113` already calls `.toLocaleString()` on both numbers.
Verified against `main` rather than re-fixed.

## Why the rest of the entry is Lane A's

The entry hedged — *"if the numbers come from different routes, the reconciliation half goes to
A"*. They do:

- **Items ① and ②** (which number the ring's denominator is; making "burned" on Day and Nutrition
  come from one function) are a reconciliation across routes.
- **Item ④** (a "7-day" chart drawing five bars) is the route under-delivering on its own contract.
  `app/api/nutrition/weekly-summary/route.ts` computes the window itself — `from =
  shiftDateStr(today, -6)` — then returns `repo.listFoodLogsSummary(...)` **verbatim**, an
  aggregate that omits days with no rows. **The route is the only layer that knows the window**, so
  that is where the gap belongs. Padding in `weekly-nutrition-chart.tsx` would make every future
  consumer re-derive those seven dates, which is how a second copy of a window starts.

The entry is re-laned to `A` with that reasoning on it, so the next reader does not re-derive it.

## Not exercised

**Not verified on device**, but the one layout risk was checked rather than left open. The new
string is five characters longer per addend, and with three addends that is fifteen — so the
question is whether it overflows. It cannot: `calorie-zone-bar.tsx` renders it inside a
`<p className="text-[10px] leading-snug …">` with **no `truncate`, no `whitespace-nowrap` and no
fixed height**, so it is flowing prose that wraps onto a second line at worst.

Both changes are text in strings and reach the device through a normal Railway deploy with no APK.
