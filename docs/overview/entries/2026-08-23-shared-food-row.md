# 2026-08-23 — one shared food row, and the two call sites that must wait (Q-406)

**Branch:** `refactor/nutrition-food-row` · **Lane B** · v1.338.0

`components/nutrition/food-row.tsx`: name · grey secondary line · calories right-aligned in a fixed
column · optional chevron. The food library sheet and the food-database search row draw it. **Q-395a's
`Needs: Q-406` is satisfied.**

## The scope decision, which is most of this entry

Q-406 says to convert all four call sites. Two of them cannot be converted yet, and both reasons are
worth carrying.

**The diary row keeps its inline edit and delete.** The agreed row's only trailing element is a
chevron, and Q-395a retires the list-row editor in favour of a quantity sheet — but **that sheet does
not exist yet**. Converting the diary row now would remove the only way to correct a logged food.
That is LB-1's failure exactly, from earlier the same day: a capability deleted by a UI move whose
replacement had not been built, invisible because the screen that lost it was not the screen anyone
looked at. It converts in Q-395a, in the same PR that adds the sheet.

**The external food-database row keeps its own shape.** It carries a macro-mismatch warning line and
an in-flight spinner. The agreed row has nowhere to put either, and adding a slot for them is what
Q-406 itself calls the difference between a unification and a wrapper. Where a per-row warning goes
is a design answer, and it belongs with Q-395's drawings.

So this ships the component and the two conversions that are unambiguous, and says in the entry
which two are outstanding and what each is waiting on. Half a sweep announced is better than a whole
one that removes a control.

## A blocker for the phases behind this one

**`unit-options.png` is not in the repository.** Q-395a names it as the reference for its expanded
and collapsed rows; `docs/design/` holds mockups for cardio, the score rows and the AI coach, and
none for nutrition. The row here was built from Q-406's *written* description, which is complete
enough for it — but Q-395a/b/c reference drawings no session can open, and will otherwise be built
from prose with no way to check the visual match. Recorded in the entry; the fix is to commit them
under `docs/design/`.

## Two details

**Props are scalars, and the check caught me anyway.** The row renders inside `.map()`, where a hook
cannot live, so an inline object literal would defeat `React.memo` silently. Both call sites use a
small memoised wrapper component to hold the identity — the sanctioned way out. My first attempt
still built the secondary line with an inline `[...].filter().join()`, and
`check-memo-prop-stability.js` failed it: the array is allocated every render whatever it collapses
to. `useMemo` in the wrapper fixes it.

**The optional thumbnail is deferred.** No call site passes one, and an unused `<img>` costs a
`no-img-element` exemption for arbitrary user photo URLs. The phase that first shows a thumbnail adds
it, with the loader decision made where it can be seen.

## Verification

The guard asserts the calories are a **fixed-width right-aligned sibling of the name**, not text
inside the grey line beneath it — because that placement is the change. A test that only checked the
number appears would pass against both old shapes. Reverting the library row to its old
stacked-calories markup fails it.

Gates: `pnpm check:rules` 52 of 52 · full unit suite · full e2e suite · build clean.

## Not verified

**Nothing ran on the S25.** This is a visual change to two lists, judged at 412 px in Chromium and in
the light theme only.
