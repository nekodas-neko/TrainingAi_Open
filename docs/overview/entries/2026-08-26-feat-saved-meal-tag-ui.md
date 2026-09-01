# 2026-08-26 — `feat/saved-meal-tag-ui` (BF-11f) — tagging a meal, and the click event that was eating the argument

**Lane B · v1.388.0 · one entry shipped (BF-11f), one entry filed (LB-20).**

## What shipped

**BF-11f — the meal builder can tag a meal with the slots a plan may use it in.** BF-11e built the
column, the join table, the route field, the local table and the outbox replay, and deliberately
shipped **no way to set any of it**. This is the last link.

- `components/ui/chip-group.tsx` — `ChipGroup`, lifted out of `meal-plan-setup-sheet.tsx`, which had
  the only copy and six call sites for it. Generalised so an option may be `{ value, label }` as well
  as a plain string. **That generalisation is the whole reason it moved rather than being copied:**
  the wizard's options are strings that are their own labels, but a tag's value is a meal-type **id**
  the user must never see, and reusing the string form verbatim would have keyed the chips by name.
- `components/nutrition/meal-type-tags.tsx` — the picker. Memoised, and the `{ value, label }`
  mapping happens **inside** it, over the state arrays the sheet already holds, so the call site
  passes no fresh identity (Q-490).
- `components/nutrition/use-ingredient-quantities.ts` — the ceiling extraction. The builder was at
  784 of its 800 lines; this took the ingredient list and its per-row unit out, leaving the
  arithmetic in `saved-meal-qty.ts` where the tests already are.
- `save-meal.ts` carries `mealTypeIds` to **both** write paths from one destructure. `[]` clears the
  tags, `undefined` leaves them alone — the distinction BF-11e built through the route, the local
  table and the outbox replay, and it is load-bearing in one specific place: overwriting a meal found
  by duplicate detection writes over a meal the builder **never showed**, so it sends `undefined`.
  Sending the builder's (empty) list there would silently wipe that meal's tags.

**Untagged means every slot, not none.** `eligibleForSlot` already returns true for an untagged meal
and is well tested; what this entry had to get right is the *copy*, because chips with nothing ticked
read as "excluded from everything". The hint under them changes with the selection and says which it
is.

## The bug the new test found

`handleSave(overwrite?: ComparableMeal)` was wired as `onClick={onSave}`. React hands the click event
to the first parameter, so **`overwrite` was truthy on every save from the footer button**. Two
consequences, both silent:

1. `if (!overwrite && !duplicateAnswered)` never ran — so **BF-11d's duplicate prompt, shipped
   yesterday in v1.387.0, had never fired once**. Its pure half (`findDuplicateMeal`) is well tested;
   the wiring was not.
2. Once this entry added tags, `mealTypeIds: overwrite ? undefined : mealTypeIds` sent `undefined`.

Neither TypeScript nor `check-memo-prop-stability.js` can see this: `() => void` accepts a handler
taking *more* parameters, and `onClick` accepts a nullary one. What caught it was the new e2e
round-trip failing and the **Playwright network trace** showing a PUT body with no `mealTypeIds` key
at all — not a wrong value, an absent one, which is what pointed at the argument rather than the
state.

Fixed at the boundary in `meal-builder-footer.tsx` (`onClick={() => onSave()}`), because that is
where the event is introduced.

## The sweep, and what it is honest to claim

Two greps over `app/` and `components/` for a handler with an optional first parameter passed bare as
an `on*` prop:

```
function [a-zA-Z]+\([a-zA-Z]+\?:      # declared functions
const [a-zA-Z]+ = useCallback\(\(?[a-zA-Z]+\?:   # arrow handlers
```

Three hits, one benign (`onLogged: (log?) => void` — the prop type declares the parameter and every
caller passes a log). The second real one: `food-list.tsx`'s `onClick={onBuildFirst}`, wired to
`openBuild(meal?)`, which does `meal.items.map(...)` — an event has no `.items`. Fixed the same way.

**That second site was fixed by inspection and NOT reproduced** when this shipped — it is only
reachable with an empty meal library and no spec had one (`food-row-shared.spec.ts:109` matches
`/^(New|Build your first meal)$/` and always lands on `New`, because the seed has meals), so **LB-20**
was filed for the gap.

> **Closed the same day, v1.388.1 — and the reproduction changed one claim here.** With the fix
> reverted, React **swallows** the TypeError: nothing reaches `pageerror`, the sheet stays on an
> empty Meals tab, and the only symptom is a dead button. So the prediction above ("throws") was
> right about the mechanism and wrong about what a user would see — this would have been reported as
> *"the button does nothing"*, not as a crash. See
> [that entry](../history-2026-09-01.md).

## Verification

- `pnpm check:rules` — **Ran 60 of 60**.
- Vitest — **5,220 passed**, 57 skipped, 631 files. Five new tests in
  `components/nutrition/__tests__/save-meal-tags.test.ts` assert the tags reach the local upsert
  **and** the outbox payload from one call, that `[]` survives both, that `undefined` omits the key
  on both, that the web fallback carries them, and that Q-216's inner catch still does.
- Playwright — **the full suite**, not a hand-picked subset. That is this session's own correction:
  #567 was verified with nine chosen specs for a change to a shared write path, and a failure reached
  CI. This PR changes the save path for every meal, and the duplicate prompt now fires where it never
  could before, so a subset would have proved nothing about the six other specs that save a meal.
- `e2e/saved-meal-tags.spec.ts` is the round-trip: tap a chip, save, read `saved_meal_meal_types`
  back out of Postgres, then **reopen the meal and assert the chip is ticked**. The reopen half is
  the one a write-only test cannot see — without seeding from the stored tags, the next save sends an
  empty list and clears what was just written.

## Not exercised

The APK. `getLocalStore` returns null in the browser, so e2e covers the route and the read-back;
the local upsert and the outbox payload are covered by unit tests at the call site, not on a device.
Tags are a plain write to an existing synced domain with no new migration, so the device risk is the
ordinary one for this area — but it is unverified, and stays that way until the S25 pass.
