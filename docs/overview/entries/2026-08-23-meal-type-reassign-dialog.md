## 2026-08-23 — the meal-type delete button can no longer only fail (Q-326)

**Branch:** `feat/meal-type-reassign-dialog` · **v1.333.5** · user-visible.

`DELETE /api/nutrition/meal-types/[id]` refuses with a 409 when food logs reference the type. The
manager turned that into a toast — naming an action, *"move them to another meal type"*, that the app
had never implemented, so the only escape a user could find was deleting every log by hand (Q-412).
The server half shipped `?reassignTo=` on 2026-08-19; this is the half that lets someone ask for it.

**The 409 is now the question, not an error.** It carries `logCount`, so the dialog opens already
knowing the stakes and nobody meets a button whose only outcome was a toast saying it could not work.
Driven end to end against `pnpm dev`:

```
DELETE …/meal-types/8bc3574b…                    → 409  MEAL_TYPE_HAS_LOGS logCount 7
  dialog: "Afternoon Snack has 7 entries. Choose where they go, then Afternoon Snack is deleted."
  5 options, "Move & delete" disabled until one is picked
  on picking Lunch: "…anything logged as Afternoon Snack on an earlier day will read as Lunch."
DELETE …/meal-types/8bc3574b…?reassignTo=293fcdfe… → 200  moved 7
  toast "Moved 7 entries to Lunch"; the row is gone; all 7 logs are on Lunch in the database
```

**It says the move rewrites history**, because that is the surprising part and it is not what "move"
implies on its own. The line names the target once one is chosen.

**Guarded** by `e2e/meal-type-reassign.spec.ts`, which creates its own meal type rather than
borrowing a seeded one — the flow ends by deleting what it acts on, so using `Afternoon Snack` would
leave every later spec running against a program the seed does not describe. It asserts the **count**
in the dialog (only obtainable from the refusal's `logCount`, so a generic confirm cannot pass it),
that the confirm is disabled until a target is picked, and that the logs land on the new type in the
database rather than merely detaching from the old one. Mutation-checked: disabling the 409 branch
reds it.

### Three things the work turned up

**The "Delete them instead" secondary was not built, because nothing can do it.** Q-326 asked for one.
`reassignAndDeleteMealType` is the only escape the repository offers — there is no
`deleteFoodLogsByMealType` — so the button would have been dead on arrival. Filed as **LB-2**, Lane A
and owner-gated, since discarding real logged history in one tap deserves a decision and the move
already covers the case that was actually blocked.

**Every delete button had the same accessible name.** Six rows, six buttons all labelled *"Delete
meal type"*, which gives a screen-reader user no way to tell which one they are on. Now
`Delete ${mt.name}`. It also made the row targetable, which is how the flow above got driven at all.

**`invalidateMealTypes()` is not enough after a reassign.** It clears the definitions list and the
adherence view; the move re-stamps every affected log's meal type and time, so the day's food list,
the weekly summary and the timeline are all stale too. The handler calls `invalidateNutritionWrite()`
as well.

**A locator trap worth carrying.** `getByRole('button', { name: 'Delete Spec Snack' })` resolves to
**two** elements — the button and an ancestor that inherits the accessible name — and the ancestor is
not what carries the click, so `.first().click()` silently does nothing and no request is made. That
looks exactly like the documented "`.click()` does not always activate a button" case and is not:
`page.locator('button[aria-label="…"]')` is unambiguous and works first time. Verified in the DOM —
there is exactly one such `<button>`, 48 × 48, inside the sheet.

**Verification.** Full local Playwright suite: **30 passed**. `pnpm check:rules` — Ran 51 of 51, all
passed. `pnpm lint` 0 errors. `tsc --noEmit` clean.

**Not exercised.** Nothing on the S25 — Q-326 asks for the device pass explicitly (reassign, then
confirm the entries show under the new type with the same calories, the day total is unchanged, and
it survives a restart), and that has **not** been done. The dialog is also **online-only**: meal-type
writes have never gone through the outbox, so this inherits that and does not worsen it.
