# The memo baseline is empty now, and the list site was the one that mattered (Q-357)

**Branch:** `fix/memo-call-site-stability` · **Lane B** · v1.349.0

## What was wrong

`memo()` compares props shallowly, so **one** inline arrow at a call site defeats it entirely — and
the component keeps its `memo(...)` wrapper and keeps reading as optimised. Q-490 shipped
`scripts/check-memo-prop-stability.js` with four such sites baselined. This clears all four and
empties the baseline, so a new one is a regression rather than a debt row.

The scanner already computed a per-site `detail` list and never printed it; running it with that
line uncovered is how the four were located, rather than by grep.

## The expensive one, and why it needed a different fix

`components/nutrition/saved-meals-sheet.tsx:598` renders `<SavedMealCard>` inside
`visibleMeals.map(...)` with **five** inline arrows. A hook is not allowed inside a `.map()`, so the
usual "wrap it in `useCallback`" does not apply — which is exactly the case CLAUDE.md's memo rule
carves out: *pass scalars, or move the identity into the child.*

The child already holds `meal`. So each callback now **takes the meal and hands it back**
(`onLog: (meal: SavedMeal) => void`), which lets the parent share one stable `useCallback` per
action across every card. That is also the shape the mutation-callback contract asks for anyway — a
callback that carries the entity rather than a parameterless "something happened".

The parent's five handlers were plain `function` declarations, so they were re-created every render
even before this; they are `useCallback` now. Two are stable by React's guarantee rather than by
hope (`openBuild`, `toggleSelected` touch only setters); `quickLog` and `deleteMeal` list their real
closures, so they change when their inputs do and not on every keystroke.

## The other three

- `app/nutrition/nutrition-content.tsx` (×2) — `MealPlanReviewCard` and `MealPlanSection`, four
  inline arrows between them, all setter-only. Four named `useCallback`s.
- `components/oura-ble/oura-ble-debug.tsx` — `LogConsole`'s `onClear`. Admin-only, but this console
  appends a line **per BLE frame**, so it is the one screen where re-rendering the whole log on
  every render is measurable.

## Verification

- `node scripts/check-memo-prop-stability.js` — **75 memoised components, 0 defeated call sites**,
  against an empty baseline.
- `pnpm check:rules` — Ran 55 of 55. Typecheck clean; lint unchanged (0 errors).
- `e2e/food-logging-complete.spec.ts` + `plan-meal-to-saved-meal.spec.ts` — 7 passed.
- `e2e/meal-label.spec.ts` + `food-row-shared.spec.ts` — 6 passed. These are the specs that drive
  `SavedMealCard`'s label and log controls, i.e. the callbacks whose signatures changed.

## Not exercised

**No measurement of the render saving.** The change is justified by the rule and by the shape (a
memo defeated inside a `.map()` re-renders every row), not by a profile — nothing here counted
renders before and after, and on a list of the owner's current size the saving may be small.

**Not checked on the S25**, and the Samsung WebView is where a re-render cost would actually show.
`oura-ble-debug.tsx` in particular is an admin surface that only does anything with a ring
connected, so its change is verified by reading.
