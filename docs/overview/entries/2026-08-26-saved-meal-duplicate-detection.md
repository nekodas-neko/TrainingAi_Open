# 2026-08-26 — A meal you already have, asked about rather than added again

**Branch:** `feat/saved-meal-duplicate-detection` · **Entry:** BF-11d · Implementation Lane B

A recipe link is easy to paste twice. BF-11c made that cheap enough to do by accident, and a
multi-dish page pasted twice adds every dish again in one press. Both save paths now check first.

## What "close" means, and why it is two tests

`fitDistance` (`packages/shared/src/nutrition/meal-macro-fit.ts`) is reused rather than a new
threshold invented: it already reduces a macro comparison to one relative number, and its own doc
says it exists *"so two candidate versions of the same meal can be compared without a second opinion
about what 'better' means"*. That is this question.

**But macros alone match every protein shake against every other one**, so a normalised name match is
required alongside — and both must pass. `DUPLICATE_MAX_FIT_DISTANCE` is 0.15, an average of 5% per
macro: inside the rounding noise a re-import produces, well outside a different meal of similar size.

**The name test is equality after normalisation, not fuzzy.** BF-38 measured 19 redundant
`food_items` rows and its guidance is explicit — *prefer under-merging*, because collapsing *Greek
Yogurt Plain* into *Greek Yogurt Vanilla* silently corrupts the macros of every past log. The
asymmetry decides it: under-matching costs a duplicate the owner can delete, over-matching offers to
overwrite the wrong meal.

## Two save paths, two ways of asking

BF-11c added the second one, and the entry carried a warning about it into this session.

- **The builder's Save** gets the prompt the plan describes: *"You already have X"* → **Update it** /
  **Save as new**. Save as new is one tap and is the safe answer, so the dangerous one takes a
  deliberate press. It runs on save, never per keystroke, and never again on the way through its own
  answer.
- **The multi-dish picker** does not get four dialogs for four dishes — that is nagging, not asking.
  The ask is the tick already there: duplicates start **unticked** and say *already in your meals*,
  and one tap keeps a copy anyway. The choice is presented before the action, in the UI that exists
  for choosing.

**Update keeps the existing id.** `meal_plan_meals.saved_meal_id` references it, and so does a
printed QR label that may already be stuck on a container — a new id orphans the label.

## The builder hit its ceiling four times in two entries

`saved-meals-sheet.tsx` crossed 800 lines on nearly every step of BF-11c and BF-11d. Four children
came out of it: `meal-batch-size.tsx`, `meal-builder-footer.tsx`, `meal-builder-header.tsx`, and
`save-meal.ts`. That is the size rule working rather than failing — a hotspot absorbs new features
into children instead of growing. The file ends at **784**.

**Nibbling did not work and the log shows it**: three of those extractions were chosen to reclaim
ten or twenty lines and the file went straight back over. What finally held was moving the whole
save *write* out — logic rather than markup, so it travelled without threading a single prop.

**`DuplicateMealPrompt` is deliberately NOT memoised**, unlike its siblings there. They sit above an
ingredient list and re-render on every keystroke; this one is mounted only while the question is on
screen. `check-memo-prop-stability.js` flagged an inline arrow into it, which was the right prompt to
ask whether the `memo()` was earning anything. It was not.

## The Q-216 guard followed the code

`local-store-write-fallback.test.ts` scans source text for the offline-first fallback shape, and it
named `saved-meals-sheet.tsx`. Moving the write broke three of its assertions.

**It was re-pointed, not relaxed.** The invariant is that a local write which throws must reach the
server rather than an error toast — and it now has two legal shapes: a `savedLocally` flag consulted
after the try, or an early return from the successful local path with the API call at top level.
`save-meal.ts` takes the second because it is a function with a return value rather than a handler
mutating component state. The test states both, and gained an assertion neither had: the API call
must never be the `else` of the store check, which is the exact arrangement Q-216 was about.

## Verification

- `npx tsc --noEmit` clean · lint clean on `components/nutrition`
- `pnpm check:rules` — **Ran 60 of 60**, all passed
- Unit suite — **5,215 passed / 57 skipped**, including 7 new tests on the matching rule
- `check-component-size` — nothing over 800 beyond the four recorded hotspots

### Failure surfaces NOT exercised

- **The S25.** A new inline prompt in the builder and a changed default tick state in the candidate
  list. `Gate: device`.
- **A real duplicate import.** The matching rule is tested directly, but no test pastes the same
  live recipe URL twice — the scan is a live AI call, so that path is only exercised on the phone.
- **The native local store.** `saveMealToLibrary`'s local branch is device-only; the web fallback is
  what ran here, and the Q-216 guard is a source-text check rather than an executed failure.
