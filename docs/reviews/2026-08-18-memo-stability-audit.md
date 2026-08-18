# Review — are the memos actually memoising?

> **Corrected 2026-08-18 while shipping Q-490.** Two of this audit's findings did not survive being
> acted on. (1) It names `target` as the fresh object; **`actual` is fresh at three of the four sites
> too** — `sumMacroTotals(...)` and `sumIngredients(...)` both build a new object in the render body —
> so fixing `target` alone would have left three of four memos still defeated. (2) *"No inline arrows
> exist anywhere"* is wrong: running the same rule as a script found **four**, on four different
> memoised components (`MealPlanReviewCard`, `MealPlanSection`, `SavedMealCard`, `LogConsole`), one of
> them inside a `.map()`. They are baselined by `scripts/check-memo-prop-stability.js` and filed as
> Q-357. The audit's headline — that the great majority of the 66 memos hold — stands; the two
> specifics above do not.

**Date:** 2026-08-18 · **Agent:** Review · **Lens:** render discipline
**Findings filed:** Q-490 · **Clean results recorded:** two

## Why

`CLAUDE.md` states the rule and the failure mode together:

> Any card/widget rendered repeatedly or under a fetch-heavy parent gets `React.memo`, **and** its
> call site passes stable props — an inline arrow or object literal defeats the memo silently (both
> long-standing memos in the codebase were defeated exactly this way…).

A defeated memo is invisible: the code looks optimised and does nothing. Nobody had checked whether
the current memos hold.

## Result — 66 memos, 2 defeated

Every `memo(...)` declaration was collected (66) and every JSX call site scanned for an inline arrow,
object literal or array literal in its props. **Two components are defeated, both from the same
module and both by the same prop:**

```
components/nutrition/meal-plan-review-step.tsx:132   <DayMacroTotals target={{ … }} />
components/nutrition/meal-plan-review-step.tsx:212   <MealMacroBars  target={{ … }} />   ← inside a list
components/nutrition/meal-plan-edit-sheet.tsx:236    <DayMacroTotals target={{ … }} />
components/nutrition/meal-plan-edit-sheet.tsx        <MealMacroBars  target={{ … }} />   ← inside a list
```

**64 of 66 hold.** That is a genuinely good result and worth recording as the headline — the
discipline this rule asks for is being kept almost everywhere.

## Finding (Q-490) — the meal-plan sheets re-render every meal row on every keystroke

`components/nutrition/meal-macro-bars.tsx:58,83` export both components wrapped in `memo(...)`. Every
call site passes `target={{ calories: …, proteinG: …, carbsG: …, fatG: … }}` — a **fresh object
identity on every parent render**, so `memo`'s shallow compare always fails and the components
re-render unconditionally.

**It matters here because of what the parents are.** `meal-plan-edit-sheet.tsx` holds **9 `useState`
hooks**, including per-keystroke handlers:

```ts
onChange={e => setInstruction(e.target.value)}
onChange={e => setRenameText(e.target.value)}
```

and `MealMacroBars` is rendered inside `variant.meals.map(m => …)`. So **every keystroke in the
rename or instruction field re-renders every meal row's macro bars**, which is exactly what the memo
was added to prevent.

**Severity: low-moderate, and it is a performance issue, not a correctness one.** A meal plan has a
handful of meals per day, so the wasted work is bounded — but it is the documented failure shape, the
memo is currently pure decoration, and the fix is small.

**Fix shape:** hoist the target object out of JSX —
`const target = useMemo(() => ({ calories: variant.targetCalories, … }), [variant.targetCalories, variant.targetProteinG, variant.targetCarbsG, variant.targetFatG])` —
or change the props to four scalars, which removes the class rather than working around it. The
per-meal site additionally needs its object memoised per row, so passing scalars is the cleaner
option there.

## A stale line in `CLAUDE.md`, worth correcting alongside

The rule says *"both long-standing memos in the codebase were defeated exactly this way"*. There are
now **66** memoised components, not two. The rule itself is right and should stay; the parenthetical
is a count from an earlier era and reads as though memoisation is rare here, which would discourage
someone from adding one. Same class as Q-480 — a stale factual clause inside a sound rule.

## Clean results

- **64 of 66 memos have stable call sites.** No inline arrows were found in any memoised component's
  props anywhere in the codebase — the two hits are object literals only.
- **The `onRpeChange` / `hrData` regressions named in `CLAUDE.md` are gone.** Those two are the
  "both long-standing memos" the rule refers to; neither appears in this audit's hits.

## Not verified

Static analysis. The call-site scan matches a JSX element that fits in ~900 characters without a
nested `<`, so a memoised component invoked with deeply nested children in its props could be missed;
the 66 declarations themselves are exhaustive. **No render counts were measured** — the re-render
claim follows from object identity and React's shallow compare, not from a profiler run. Not on the
APK.
