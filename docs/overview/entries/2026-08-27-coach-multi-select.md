# 2026-08-27 — "Select all", and the six lists the Coach was paying to retype (Q-407)

**Lane A + B · branch `feat/coach-multi-select-options`**

The owner, on the meal-plan wizard: *"there should be options for 'select all' as I keep clicking
each grocery store."* Q-407 diagnosed it precisely and the diagnosis held on re-reading:
`ChoiceListSchema` had `prompt`, `source`, `sourceId`, `options[]` and **no multi flag**, and
`ChoiceList`'s callback was `onChoose?: (option) => void` — one option, singular. There was no
configuration that produced a multi-select; the widget had never had one.

## What shipped

- **`multi` and `selectAll` on `ChoiceListSchema`** — flat optional booleans, not a discriminated
  union of single/multi variants. The schema's own comment says why: *"Gemini's function-declaration
  schema is fussy about unions, and this feature has already lost a day to one."* Both absent by
  default, so every existing call site parses byte-identically.
- **`ChoiceList` gained checkbox rows**, a Select-all row carrying `n of m`, and a Continue button.
  Select-all sits **above** the scroll region — with more rows than fit, a control you have to
  scroll to find is one you will not find, and saving taps is its entire purpose. Continue sits
  **below** it, always reachable however long the list is, disabled rather than hidden at zero picked
  so the rows do not jump under a finger on the first tap.
- **One callback for both modes**, taking an array. A second `onChooseMany` would have made every
  call site handle two shapes for one question.
- **`WidgetResultSchema`'s `chose` carries `ids`** alongside the existing `id`, both optional under a
  refine. `id` staying required and holding the first of five is the kind of quiet lie that is true
  until someone reads it.
- **Six new choice sources** — `grocery_stores`, `proteins`, `carbs`, `fats`, `vegetables`,
  `dietary_restrictions` — served from `/api/coach/options`. The five staple lists moved out of
  `meal-plan-setup-sheet.tsx` into `@trainingai/shared/nutrition/grocery-catalogue`, one copy read by
  both. This is the measured half: a nine-option picker the model typed out cost **~554 output
  tokens**, and output tokens are essentially all of Coach's latency.

## The catch, which only appeared once the branches were placed

`/api/coach/options` opens with `const program = await repo.getActiveProgram(userId); if (!program)
return { options: [] }`. That is right for `sessions`, `exercises` and `swap_candidates` — they *are*
the program. Put the catalogue branches below it and **a grocery picker comes back empty for anyone
without a training program**: a nutrition question failing on a training precondition, for exactly
the new user most likely to be asking it.

The catalogue branches sit above the gate, and a test asserts `getActiveProgram` is never even
called for them — asserting the returned list alone would still pass if the gate ran first and
happened not to fire.

## The dead branch a mutation found

`joinChoiceLabels` — extracted to a `.ts` because both vitest projects are `environment: 'node'` and
cannot parse JSX, so a join living in `widget-registry.tsx` could not be asserted at all — was
written with a `length === 2` special case. A mutation deleting that line **passed**, which is what
said it was dead rather than defensive: `slice(0, -1)` on two labels is one label and joins to
itself, so the general line already produces *"Coles and Aldi"*. Removed, with the reasoning kept
above it.

Ten mutations in total, each with an asserted anchor. One anchor missed and reported as a miss rather
than a pass — which is the guard working; it was redone by locating the line rather than
string-matching through a shell.

## Verification

Full suite green. `tsc` and lint clean. Route and schema behaviour covered by 26 tests across
`coach-options-catalogues`, `widgets` and `choice-label`.

**Not exercised: the widget rendering.** JSX cannot be unit-rendered here, and the widget only draws
inside a live Coach conversation, so the checkbox rows, the Select-all row and the Continue button
have not been seen. The logic behind them is asserted; the pixels are not. That wants the S25 pass
Q-407 will need anyway.

## Deliberately not done

**The conversation.** Q-407's larger half — the seven-step sheet becoming at most three exchanges,
the plan arriving as a widget rather than prose, and the nutrition scope as a *named record* of
prompt section + tool subset + patch domains + widget sources — is untouched. What shipped is the
widget that half needs and could not have been built without. The entry keeps it.
