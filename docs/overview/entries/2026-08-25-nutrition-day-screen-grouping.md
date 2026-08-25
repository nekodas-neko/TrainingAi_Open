# The rest of the day screen's gapped cards become grouped sections (Q-395b, complete)

**Branch:** `feat/nutrition-day-screen-grouping` · **Lane B** · v1.366.0

The half I left on Q-395b's `Keep:` line yesterday, finished. The reason for stopping was scope
caution rather than a real blocker, and it does not survive a second look: taking a card from
`rounded-2xl border` to full-bleed is a small change per component, and the browser can check it at
the right viewport in both themes — which is what happened here.

## What shipped

Two more grouped sections, on the same pattern `MealCard` established:

- **Today's energy** — `CalorieBalanceBar` + `MacroRing`. They are two views of the same number and
  a gap between them read as two unrelated cards.
- **Reference** — `WeeklyNutritionChart` + `SupplementsSection`. Neither is about today's meals;
  both are reference rather than action.

Each of the four components takes a `grouped` prop that drops its own rounding and border, because
inside a section those put a second hairline against the section's and re-open the gap the grouping
closes.

## The whole arc, measured

Same seeded day throughout:

| | scroll height | gap px | share |
|---|---|---|---|
| before Q-395b | 2,649 | 420 | 16% |
| after the meal list (#440) | 2,580 | 320 | 12% |
| after this | **2,538** | **280** | **11%** |

**140 px of gap removed; the screen is 111 px shorter.** Gaps 16% → 11%.

The entry claimed the gaps were *"most of the vertical space this screen spends on nothing."* They
were 16%, and they are 11% now. Worth doing, not what the entry said.

## What is deliberately still ungrouped, and why it is not scope caution

`MealPlanReviewCard`, `MealPlanSection`, `TdeeAdaptationCard`, `FoodLoggingComplete`, the action row
and the End of Day button. Every one of them is **conditional** — `TdeeAdaptationCard` returns null
unless it has something to say, the plan cards depend on a plan existing — so a fixed group container
around them draws an **empty bordered box** on the days they are absent. Grouping them means adding
`{(a || b) && …}` guards around each pair, which trades the gap for a different kind of clutter.

The two groups shipped here are safe because their first member always renders: the balance bar and
the week chart are unconditional, so `SupplementsSection` being today-only cannot empty its section.

## Verification

Driven at 412×915 against `pnpm dev` + local Postgres, **in both themes, each on a fully loaded
screen** (the previous PR's dark run sampled mid-load — that gap is closed):

```
light  {"scrollHeight":2538,"gaps":280}  gaps 11%  checklist 11 of 11  macro % 25% 3% 72%  errors 0
dark   {"scrollHeight":2538,"gaps":280}  gaps 11%  checklist 11 of 11  macro % 25% 3% 72%  errors 0
```

The dark screenshot was read: the energy section draws as one bordered block with a hairline between
the bar and the ring, and the split arc's three colours are correct against `oklch(0.05 0 0)`.

**Coverage checklist, asserted individually in both themes:** ✓ ScreenHeader + date nav ·
✓ CalorieBalanceBar · ✓ MacroRing · ✓ NutritionActionRow · ✓ MealPlan card/section ·
✓ TdeeAdaptationCard · ✓ MealCard × meal types · ✓ FoodLoggingComplete · ✓ WeeklyNutritionChart ·
✓ SupplementsSection · ✓ End of Day.

`tsc --noEmit` clean · `eslint` zero warnings introduced (the one on `nutrition-content.tsx` is the
pre-existing `useLayoutEffect` dep) · `pnpm check:rules` **Ran 56 of 56** · `check-component-size`,
`check-memo-prop-stability` clean.

## Not exercised

**No device smoke run**, which remains this entry's stated bar and the only thing left on it. Nothing
here is safe-area-sensitive, but `divide-y` over a `bg-muted/60` child is exactly the shape Samsung's
WebView compositor has caught out before, and there are now three such sections rather than one.

**A past date was driven and is fine** — on *Yesterday* the three groups hold 2, 6 and **1** child
(`SupplementsSection` correctly absent), and **zero** of them render as an empty bordered box. That
is observation, not reasoning.

**An empty day was not opened.** The meal group is guarded by `mealTypes.length > 0` in source, so a
brand-new account draws no meal section rather than an empty one — read, not run. The zero-data e2e
account exists and a spec could pin it.
