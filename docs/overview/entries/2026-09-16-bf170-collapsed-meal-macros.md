# 2026-09-16 — BF-170: the footer was withheld on a promise the collapsed row does not keep (BugFix intake)

Docs-only. Owner: *"Same issue here where the singular meal doesnt show macro below it."*

His diary makes the comparison itself. **PRE WORKOUT** holds one saved meal (*Protein Shake +
Cruskit*, 5 ingredients) and shows **no P/C/F**. **POST WORKOUT**, directly below, holds one loose
food and shows **P 17g · C 17g · F 10g**.

## The suppression is deliberate and rests on a false premise

```ts
// A group row states its own macros AND calories; a loose row states neither.
return kinds[0] === 'meal' ? { show: false, … } : { show: true, … }
```

`mealFooter` withholds the section footer for a lone meal because the group row is believed to state
its own macros. It does not — `diary-meal-group.tsx` puts the P/C/F line **inside `{open && (…)}`**,
under the ingredient rows. The always-visible header carries the name, the ingredient count, the
calories and a chevron. **Collapsed, which is the default and what his screenshot shows, the row
states calories only.**

So the footer is skipped for a claim that is half true, and the macros appear nowhere.

## It is BF-120's own defect with the kinds swapped

`meal-card-footer.ts` records why BF-120 existed: *"a section holding one loose food showed protein,
carbs and fat **nowhere**, while the section above it showed all three."* That is his screenshot
again — except the section showing nothing is the meal and the one below showing all three is the
food.

## Fix at the group, not at the footer

Move the P/C/F line out of `{open && …}` so a collapsed meal states its macros beside its calories.
That makes the comment true, leaves the decision table untouched, and fixes every meal group rather
than only the lone-in-a-section case. Patching `mealFooter` instead would print the macros twice the
moment the group is expanded.

Out of scope: whether a loose row shows per-item macros in the diary. Q-406 moved those into the
detail sheet on purpose and BF-120 settled the section-level answer that followed.

## Not exercised

Docs only. Both components and the decision module were read in the shipped source; the comparison
comes from the owner's screenshot.
