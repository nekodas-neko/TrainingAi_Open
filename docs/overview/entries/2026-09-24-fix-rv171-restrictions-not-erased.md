# 2026-09-24 — RV-171: a failed request while the meal-plan setup opened erased every allergy

**Branch:** `fix/rv171-restrictions-load-guard` · **Lane:** B · **Domain:** nutrition

## What was wrong

The sheet loaded dietary restrictions with a bare `fetch` whose failure path was
`if (!d) return` / `.catch(() => {})`, so `restrictions` stayed at its initial `[]`.
`handleGenerate` then PUT `{ entries: restrictions }` **unconditionally** into
`replaceUserDietaryRestrictions`, which **deletes every row for the user** before inserting.

So one 429, 5xx or dropped request while the sheet opened wiped the owner's allergies and
intolerances — and the plan was then generated without them, because the generate route reads them
back from the database. The only visible hint was an empty restrictions step.

The code's own comment said it: *"a new plan must never start from a blank slate and quietly forget
an allergy."* That is exactly what a failed load caused.

## The fix

Two guards, and both are load-bearing:

- **`loadedRestrictions: RestrictionSelection[] | null`** — what the server actually had. `null`
  means no successful load, and the write cannot fire in that state. This is the half that stops
  the erasure.
- **`sameRestrictions(loaded, current)`** — no write unless something actually changed. Writing an
  unchanged set is a delete-and-reinsert of every row for no benefit, which is the same blast
  radius as the bug for none of the value.

Skipping the write is safe either way, because the generate route reads the stored restrictions
itself. The PUT's response is now read, and a refused save says so rather than being swallowed.

A failed load renders an error line saying the saved restrictions are untouched and the plan will
still use them — true, and the reassuring half matters as much as the warning.

**`sameRestrictions` compares sets, not lists.** The picker rebuilds the array on every toggle, so
order shifts without the selection changing; ordered comparison would make almost every open look
like an edit and re-run the very delete-and-reinsert the guard exists to avoid.

## Verification

- `components/nutrition/__tests__/rv171-restrictions-not-erased.test.ts` — **10 tests**. Five drive
  `sameRestrictions` as the pure function it is (order-insensitivity, a severity change, addition,
  removal, and the asymmetry the `every` half alone would miss); five assert the guards on source.
- **Control-run against `origin/main`: the 5 guard assertions go red**, the 5 logic ones correctly
  pass either way.
- `pnpm check:rules` · `tsc --noEmit` clean · lint clean.

**Not exercised: the browser path.** The setup sheet is only reachable with no active plan, and the
seeded e2e user has one, so driving it would have meant reshaping the fixture for one spec. The
failure path is therefore argued from source and from the extracted logic, not observed. Stated
plainly rather than papered over.

`sameRestrictions` moved to `components/nutrition/restrictions-diff.ts` — vitest's unit project does
not transform JSX, so nothing is importable out of a `.tsx`. Same pattern as
`meal-count-reduction.ts` beside it.

## Next

Lane B's queue head is RV-166, then RV-167, RV-176.
