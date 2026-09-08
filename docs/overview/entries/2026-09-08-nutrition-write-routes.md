## 2026-09-08 — A delete that lied, and a prompt that must not trust its caller (PS-39)

**Branch:** `test/nutrition-write-routes` · **Lane A**

### What shipped

12 tests across `nutrition/saved-meals/[id]` and `nutrition/meal-plans/generate/meal`; `BASELINE`
**134 → 132**. Seven of the twelve believed-tested-and-not routes now have real tests.

### RV-45 — the delete that confirmed itself

A delete matching no row was reported as one that removed something. The sheets calling it do
`if (!res.ok) throw`, so a refused cross-account delete, or a stale id, **confirmed itself to the
user** — and the row came back on the next pull, which reads as the app losing a change rather than
refusing one. Pinned both ways: no row → 404, a row → `{ success: true }`, and the delete is scoped
to the caller so an id alone is never enough. Mutation-checked by deleting the 404.

### The prompt reads restrictions from the database, never from the request

The invariant with real consequences on `generate/meal`: a client that omitted them would silently
get a meal built **without an allergy the user has recorded**. Pinned by seeding an allergy and an
avoid, then asserting both reach the prompt under `MUST NOT CONTAIN (allergy)` and that the lookup
was made against the session's user. Mutation-checked by taking the list from the request instead.

Also pinned there: a rewrite needs **both** an instruction and a meal to apply it to (an instruction
with nothing to apply it to is a fresh generation wearing the wrong prompt); PS-37's error copy,
where the else branch used to say *"Could not rewrite that meal"* on a fresh generation — the one
thing the user had not asked for; that totals are summed in code from ingredients, so a model that
invents a `totalCalories: 99999` cannot move the day's numbers; and that the user's own text is
fenced as `<user_text>`.

### The schema invariant worth more than the one I first wrote

The first draft asserted `{ name: 'x' }` is refused. It is not, and correctly so — `items` and
`servings` default. What the schema actually protects is subtler and now tested:

- **`servings` divides**, so a zero makes one portion infinite. `0`, `-1` and `51` are all refused.
- **Omitted and explicit-null are kept apart** for `imageDataUri` and `mealTypeIds`. Omitted means
  "the caller did not mention it" and must leave a stored value alone; null clears it. A
  `.default([])` on `mealTypeIds` would turn "did not mention tags" into "clear the tags" — and
  every save from the saved-meals sheet omits them until BF-11f ships a picker. Mutation-checked by
  adding that default.

### Verification

- `pnpm check:rules` — **Ran 70 of 70**. `tsc --noEmit` clean, `check-test-typecheck` at baseline,
  `pnpm build` exit 0, full suite green.
- **Mutation-checked three ways**, each failing exactly its own case: removing the RV-45 404, taking
  restrictions from the request, and defaulting `mealTypeIds`.

**Not exercised:** the model is stubbed, and `scaleWithTopUp` is stubbed to the identity — so the
portion scaling and top-up are covered by their own tests, not these. What is pinned is what the
route sends the model, what it refuses, and what it does with the result.

**Five of the twelve remain**: `workout-data` (600 lines), `weekly-digest`,
`nutrition-goals/recommend`, `workout-review/session/[sessionId]`,
`ai-periodization/session/[sessionId]/prescribe`.

No version bump: tests only.
