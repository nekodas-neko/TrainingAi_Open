# The day screen's meals are one grouped section, and the ring is split by macro (Q-395b)

**Branch:** `feat/nutrition-day-screen-sections` · **Lane B** · v1.365.0

## The entry's justification is overstated, and the measurement is the finding

Q-395b says grouped sections replace gapped cards because the gaps are *"most of the vertical space
this screen spends on nothing."* Measured on the same seeded day, before and after:

| | scroll height | gap px | share |
|---|---|---|---|
| before | 2,649 | 420 | **16%** |
| after | 2,580 | 320 | **12%** |

So the gaps were **16%**, not most, and this reclaims **100 px** of them. The screen is 69 px
shorter rather than 100 — the other 31 px is the per-macro percentage this PR adds under each label,
which is a deliberate trade, not a regression.

Sixteen per cent is still a screenful of scroll over the page, and worth taking. It is not the
argument the entry makes, and the next phase should not inherit that claim unexamined.

## What shipped

**The meal list is one bordered block with full-bleed dividers**, not six cards with gaps between
them. `MealCard` takes a `grouped` prop that drops its own rounding and border — inside the section
those put a second hairline against the first and re-open the gaps the grouping closes. Standalone
callers keep the card.

**`MacroRing`'s arc is split by macro.** The sweep still measures progress toward the calorie goal;
what changed is that it is coloured by where those calories came from. One ring, three segments — a
second ring was the alternative and the design pass rejected it. Degrees accumulate rather than each
segment being placed independently, so rounding cannot open a hairline between two colours. Each
macro's share is printed under its label, because a coloured segment on its own does not say it is
25% and the colour is the only thing tying the two together.

Observed with two foods logged: **25% / 3% / 72%** against 19.1 g protein, 2.3 g carbs, 24.8 g fat —
76.4 / 9.2 / 223.2 kcal of 308.8. Correct to the digit.

## The Atwater factors had four copies; `components/` now has one

Writing the split needed kcal-per-gram, and the honest way to get it exposed a "One Formula, One
Place" violation: `packages/shared/nutrition/calorie-balance.ts` has a `KCAL_PER_G` that is **not
exported**, `goal-recommendation.ts` hardcodes `* 4` / `* 9` at three call sites, and
`components/nutrition/saved-meal-card.tsx` wrote the sum out longhand.

`components/nutrition/macro-energy.ts` is now the one copy `components/` uses, and
`saved-meal-card.tsx` was converted to it — so this branch **removes** a duplicate rather than
adding a fifth. The two in `packages/shared/` are Lane A's and cannot be reached from here; filed as
**LB-9**. Adding a sixth copy to close that gap is how there came to be four.

## Extract before adding

`nutrition-content.tsx` was at **789 of a hard 800** — it is not on `check-component-size.js`'s
baseline, so it fails CI the moment it crosses, and this phase adds to it. The trailing group
(finished-logging marker, week chart, supplements, End of Day) moved to
`components/nutrition/day-tools-section.tsx`. The file is **773** now, with room for phase 4.

## Coverage checklist — all 11 sections, ticked against the running app

Driven at 412×915 and asserted individually:

✓ ScreenHeader + date nav · ✓ CalorieBalanceBar · ✓ MacroRing · ✓ NutritionActionRow ·
✓ MealPlanReviewCard / MealPlanSection · ✓ TdeeAdaptationCard · ✓ MealCard × meal types ·
✓ FoodLoggingComplete · ✓ WeeklyNutritionChart · ✓ SupplementsSection · ✓ End of Day

**The entry's list is one short.** It names 11; the screen renders **12** — `FoodLoggingComplete`
shipped with BF-6 after the entry was written, and sits between the meals and the week chart. Its
stated order is also wrong in one place: End of Day is last on the page, after supplements, not
between the meals and the chart.

`tsc --noEmit` clean · `eslint` zero warnings introduced (the one on `nutrition-content.tsx` is a
pre-existing `useLayoutEffect` dep, confirmed by stashing) · `pnpm check:rules` **Ran 56 of 56** ·
`check-component-size`, `check-memo-prop-stability` clean.

## Not exercised

**No device smoke run**, which is this entry's stated bar (*"as Q-395a"*). Nothing here is
safe-area-sensitive — no new bottom-anchored control — but the grouped list changes borders and
backgrounds across the screen's largest block, and Samsung's WebView compositor is exactly where a
`divide-y` over a `bg-muted/60` child is worth a look.

**Dark theme was not measured on a fully-loaded screen.** The dark run sampled mid-load (3 of 7
probes, macros still 0), so the numbers and the checklist above are from the light run. The light
screenshot was read; the dark one was not re-taken. Both themes render the sheet correctly per
Q-395a's checks a few hours earlier, and nothing here introduces a colour literal, but the grouped
list's dividers in dark are unverified.

**The gapped-card treatment is untouched outside the meal list.** CalorieBalanceBar, the plan cards,
the week chart and supplements still draw their own rounded borders with gaps between them. Taking
those full-bleed too means editing eight more components' chrome with no device check available,
which is a worse trade than leaving it — phase 3 is the entry's, and this is the part of it that is
genuinely better done.
