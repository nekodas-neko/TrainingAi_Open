## 2026-09-07 — A menu item is not a preference (LA-73)

**Branch:** `fix/sanitise-exercise-names` · **Lane A**

### The question the entry asked, answered first

LA-73 said to establish whether any stored name actually carries a control character before treating
this as a fix rather than a guard. Measured in production, 2026-09-07:

| table | rows | control chars | angle brackets | untrimmed | longest |
|---|---|---|---|---|---|
| `exercise_library` | 155 | 0 | 0 | 0 | 34 |
| `programs` | 5 | 0 | — | — | 22 |
| `program_sessions` | 22 | 0 | — | — | 27 |
| `progression_styles` | 25 | 0 | — | — | 24 |

Nothing to repair. This ships as a guard on the write, and no backfill rides it.

### What shipped

`promptSafeLine(value)` in `packages/shared/src/ai/untrusted-text.ts`, applied to the exercise name
in `POST /api/exercises` as a Zod `.transform()`.

**It is deliberately not `sanitiseUserText`.** An exercise name reaches four prompts as a **menu
item** the model must quote back verbatim so the route can match it to the library — wrap those in
`<user_text>` and the tag turns up in the answer. So `promptSafeLine` removes only what could give a
name structure the prompt does not intend (control characters, whitespace runs) and **keeps `<` and
`>`**, which the fence strips. A test pins both halves against each other: `promptSafeLine('Deadlift
<100kg')` keeps the bracket, `sanitiseUserText` on the same string removes it.

`.min(1)` runs before the transform, so a name of nothing but control characters passes the length
check and would arrive empty — hence a `.refine()` after it.

### Verification

- `packages/shared` + `lib/__tests__` + `app/api/__tests__`: **3434 passed**, 10 skipped.
- The route tests go through the real `POST` handler, not `promptSafeLine` directly — the helper
  being right proves nothing about whether the schema calls it, which is the mistake BF-129 made
  earlier today and had to rewrite.
- **Mutation-checked:** removing the `.transform()`/`.refine()` fails two of the three route cases.
- `pnpm check:rules` — **Ran 68 of 68**. `tsc --noEmit` clean, ESLint clean. `pnpm dev`: the route
  returns 401 rather than 500.

**Not exercised:** no model ran (no API key in the sandbox), so what is verified is the stored value,
not how a prompt containing it behaves. Nothing device-facing; no version bump — a user cannot see
this unless they type a newline into an exercise name.

### What the guard could not reach, and why

**LA-74: `workout-templates` and `progression-styles` take an unvalidated body.** Neither has a Zod
schema at all — each spreads the request body into its repository call. It is *not* mass assignment
(`saveProgram`'s `.set({ name, isActive, updatedAt })` key-whitelists, so an injected column cannot
land), but nothing types or bounds any value, and both carry targeted ownership checks
(`phaseSetId`, `styleId`) that read as validation while covering two fields out of many.

That is the reason this guard reached one table out of four rather than a scoping decision: the
other three name-bearing tables have no schema to hang a transform on. Q-484 fixed this exact
asymmetry on `POST /api/injuries` — a create path beside a fully-validated edit path — and these two
were never revisited.
