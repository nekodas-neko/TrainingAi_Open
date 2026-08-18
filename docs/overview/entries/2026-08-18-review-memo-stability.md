# 2026-08-18 — Review: are the memos actually memoising?

**Agent:** Review 📖 · **Branch:** `claude/review-render-discipline` · **Docs-only.**
**Filed:** Q-490 · **Review:** [`docs/reviews/2026-08-18-memo-stability-audit.md`](../../reviews/2026-08-18-memo-stability-audit.md)

## Why

`CLAUDE.md` warns that an inline arrow or object literal *"defeats the memo silently"*. A defeated
memo looks optimised and does nothing, so nothing surfaces it. Nobody had checked whether the current
memos hold.

## Result — 64 of 66 hold

All 66 `memo(...)` declarations were collected and every JSX call site scanned for an inline
arrow/object/array in its props. **No inline arrows exist anywhere** in a memoised component's props.
Two components are defeated, both from one module and both by the same prop.

## Q-490

`MealMacroBars` and `DayMacroTotals` (`meal-macro-bars.tsx:58,83`) are called with
`target={{ calories: …, proteinG: …, carbsG: …, fatG: … }}` — a fresh object identity per render —
from `meal-plan-review-step.tsx` and `meal-plan-edit-sheet.tsx`, in both cases inside
`variant.meals.map(...)`.

The edit sheet holds 9 `useState` hooks including per-keystroke handlers, so **every keystroke
re-renders every meal row's macro bars** — exactly what the memo was added to prevent. Performance,
not correctness, and bounded by the handful of meals in a day.

The fix wants **scalars** rather than a `useMemo` at the per-meal site: a `useMemo` there would need
one memo per row, which is worse than the bug.

## A stale clause in the rule

The rule says *"both long-standing memos in the codebase were defeated exactly this way"*. There are
now **66** memoised components, not two. The rule is right and stays; the count is from an earlier era
and reads as though memoisation is rare here, which would discourage adding one. Same class as Q-480.

## Not verified

Static analysis. **No render counts were measured** — the re-render claim follows from object identity
and React's shallow compare, not a profiler run. The call-site scan matches JSX elements that fit in
~900 characters without a nested `<`, so a memoised component invoked with deeply nested children in
its props could be missed; the 66 declarations are exhaustive. Not on the APK.
