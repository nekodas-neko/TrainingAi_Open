# 2026-08-19 — the two nutrition files have room again, and Q-406's method did not (Q-406)

Lane B. v1.325.3. Two extractions, no behaviour change. **The row component this entry is named
after was deliberately not built** — see below.

## The blocker was real

`app/nutrition/nutrition-content.tsx` sat at **exactly 800** and
`components/nutrition/saved-meals-sheet.tsx` at **793**, neither grandfathered in
`check-component-size.js`. One added line failed Custom Rules, so Q-395's rework could not land a
single change in either file.

## The method was not

Q-406 proposed extracting a shared `food-row.tsx` and said that would take both files under the
line. It would not, and both reasons were measured rather than reasoned.

**Extracting a food row frees zero lines from either file.** Neither contains row markup.
`nutrition-content.tsx` renders no food rows at all — `MealCard` owns the diary row, and the file's
only `foodItem` references are data mapping. `saved-meals-sheet.tsx` had already delegated both of
its lists, to `SavedMealCard` and `IngredientRow`; its 793 lines are the builder form, ten handlers
and the sheet's own state.

**And the four call sites are four different shapes, not one shape drawn four times:**

| site | calories | secondary line | trailing |
|---|---|---|---|
| diary, `meal-card.tsx:82` | fixed `w-16` right column | coloured P/C/F chips | edit + delete buttons |
| library, `food-library-sheet.tsx:100` | right-aligned, serving beneath | brand | whole row is a button |
| search/db, `ingredient-search.tsx:72` | **inside** the secondary line | kcal · P per serving | `+` icon |
| search/external, `ingredient-search.tsx:132` | inside the secondary line | kcal · P · C · F per g | spinner, plus a macro-mismatch warning |

A component covering all four faithfully needs a secondary-line node, a trailing slot and a
calories-placement variant — a wrapper, not a unification. Unifying them properly means changing how
three of the four look, and this entry explicitly forbids that: *"Behaviour must not change… Any
visual difference belongs to Q-395."*

**So the row cannot be extracted before deciding what it should look like, and that decision is
Q-395's.** The entry is corrected in place rather than struck, with the per-site table, so it is not
attempted as written a second time.

## What was done instead

The extractions that actually create headroom, both pure moves:

- **`AddFoodByHandForm`** out of `saved-meals-sheet.tsx` — **793 → 753**. A self-contained five-field
  form whose state nothing else read. `handleAddFoodAndIngredient` now takes parsed values and
  returns whether the food was created, so the form clears only on success; the `parseFloat`-or-zero
  rule sits next to the inputs that produce it instead of two hundred lines away. The button's
  `disabled={saving || !name.trim() || !calories}` was carried across verbatim — it was dropped in
  the first draft and put back before commit, which is the kind of thing "pure extraction" quietly
  loses.
- **`useFoodLogsLoader`** out of `nutrition-content.tsx` — **800 → 732**. Sixty-nine lines, the
  file's largest and most self-contained function: four inputs, no JSX, no other state. **Every
  comment moved with the code**, because this is the path behind the "logged food vanished on
  reload" reports — the ordering of local render, server fetch and hydrate, and the rule that a
  local-store failure must never blank the list, are the fixes for those.

Both files are now well under the ceiling **with no new BASELINE rows**, which was Q-406's own
done-condition and the reason the shrink-only ratchet exists.

## What was NOT exercised

- **The row component does not exist.** Q-395 needs it; it needs Q-395 first.
- **No device run.** JS-only; reaches the APK on the next Railway deploy with no rebuild.
- **`useFoodLogsLoader`'s offline branches were not driven.** `getLocalStore` returns null in the
  web sandbox, so the local-first read, the `applyDelta` hydrate and the "hydrate failed, render the
  server copy" fallback all took the null-store path. The move is textually identical, but the three
  branches that matter most on device were not executed here.
- **No new test.** `decideLogsApplication`, the one piece of this with real logic, was already
  extracted and tested (Q-245); the rest is I/O sequencing that the node environment cannot drive.
