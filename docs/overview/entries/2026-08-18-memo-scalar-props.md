# 2026-08-18 — the meal-plan macro bars memo for real now (Q-490)

Lane B. v1.324.9. Three component files, one new Custom Rules step, one Q filed.

## The defect

`MealMacroBars` and `DayMacroTotals` (`components/nutrition/meal-macro-bars.tsx`) are both wrapped in
`memo(...)`, and neither has ever held. `memo` compares props shallowly; every call site passed a
**fresh object identity**, so the compare failed on every parent render.

`meal-plan-edit-sheet.tsx` holds nine `useState` hooks including per-keystroke handlers
(`onChange={e => setInstruction(e.target.value)}`, `setRenameText`), and `MealMacroBars` renders
inside `variant.meals.map(...)`. **Every keystroke in the rename or instruction field re-rendered
every meal row's macro bars** — precisely what the memo was added to prevent.

## The correction to the finding

The Q-490 entry named `target` as the fresh object. **`actual` is fresh at three of the four sites
too**, so fixing `target` alone would have left three of four still defeated and the sheet still
re-rendering on every keystroke:

```
meal-plan-review-step.tsx:132  dayActual = sumMacroTotals(...)              ← fresh
meal-plan-review-step.tsx:212  m.actual                                     ← stable (the only one)
meal-plan-edit-sheet.tsx:236   dayActual = sumMacroTotals(...)              ← fresh
meal-plan-edit-sheet.tsx:301   actual = sumIngredients(m.ingredients)       ← fresh, inside the map
```

`sumMacroTotals` and `sumIngredients` both return a new object, and both are called in the render
body.

## The fix, and why scalars rather than `useMemo`

Both components now take the eight macro numbers as **scalars**. The entry recommended this for the
per-meal site and the reasoning generalises: `MealMacroBars` renders inside `variant.meals.map(...)`,
where a hook is not allowed, so there is no `useMemo` that can stabilise a per-row object. Scalars
remove the class rather than working around it — a future call site cannot reintroduce it by
accident, because the type is a number.

The compiler named all four call sites the moment the props changed, which is the other half of the
argument for scalars over a custom `areEqual` comparator: a comparator is a hand-maintained equality
that silently stops covering a prop someone adds later.

## The check, and the four sites the audit missed

`scripts/check-memo-prop-stability.js` collects every `memo(...)` component in `app/` + `components/`
(66 of them), finds every JSX call site of one, and fails on an inline `{{…}}`, `{[…]}` or
`{… => …}` in a prop. Shrink-only per-file baseline, same shape as `check-hex-literals.js`.

Run repo-wide it found **six** defeated call sites, not two. The Q-490 review had reported *"No
inline arrows exist anywhere"*; there are four, on four different memoised components, none of them
the two this PR fixed:

```
app/nutrition/nutrition-content.tsx:627        <MealPlanReviewCard>   4 inline arrows
app/nutrition/nutrition-content.tsx:638        <MealPlanSection>      1 inline object
components/nutrition/saved-meals-sheet.tsx:587 <SavedMealCard>        5 inline arrows, inside a .map
components/oura-ble/oura-ble-debug.tsx:704     <LogConsole>           1 inline arrow
```

They are baselined and **filed as Q-357** rather than swept here: `SavedMealCard`'s fix is a callback
contract change (`onLog={quickLog}` with the child calling `onLog(meal)`), which is a different piece
of work from this one. Frozen is the point — nothing new can join them.

Mutation-checked both ways: re-introducing the Q-490 shape at a non-baselined site fails the check,
and fixing a baselined site fails it too until the row is lowered.

`CLAUDE.md`'s parenthetical — *"both long-standing memos in the codebase were defeated exactly this
way"* — is corrected in the same commit. There are 66, and a count from when memoisation was rare
read as discouragement from adding one.

## What was NOT exercised

- **No render counts were measured.** The claim follows from object identity and React's shallow
  compare, not a profiler run — same standing as the review that filed it. What *is* verified is
  that the props are now primitives, which is the property the compare needs.
- **No device run.** JS-only; reaches the APK through a Railway deploy with no rebuild.
- **The edit sheet itself was never driven.** `/nutrition` loads and `/api/nutrition/meal-plans`
  returns a seeded plan (three meals, two with ingredients and one without, so both the bars branch
  and the no-ingredients fallback are reachable) — but two Playwright attempts to open Manage plan →
  Edit meals failed to reach the sheet, the second because `scrollIntoViewIfNeeded` parked the
  button under the fixed bottom nav and the tap navigated to `/workout` instead. Not pursued
  further; the probe was deleted rather than committed half-working.
- **The transposition risk was closed differently.** A scalar refactor can silently swap two numbers
  and still compile, so all **40** prop mappings across the three files were machine-checked: every
  `actualX`/`targetX` prop must read from the matching field. Zero mismatches. That is a weaker
  check than seeing the bars, and it is what was actually done.
- The four baselined sites are untouched and still defeated.
