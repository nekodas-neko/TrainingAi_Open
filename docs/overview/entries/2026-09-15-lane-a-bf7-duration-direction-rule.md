# 2026-09-15 — the prescription was reading a label where it meant a direction (BF-7 PR 2a)

**Branch:** `lane-a/bf7-duration-direction-rule` · **Lane A** · no version bump — behaviour-preserving by construction

## What shipped

`durationDirection(sessionBudgetMin, preset)` in `packages/shared/src/workout/duration-model.ts`,
and the two prescription branches now read it instead of the preset label.

`short` and `long` were never really labels. They selected **three different algorithms**
(`generate-prescription.ts`): `short` → `dropToBudget` (removes whole exercises), standard →
`fitToBudget` (removes sets only), `long` → `fitToBudget` + `expandToBudget` (adds sets to MRV). What
the branches actually needed to know was whether today is **shorter, the same, or longer** than the
session the user configured — and the labels were a proxy for that which only works while there are
exactly three of them.

Deriving the direction from minutes is the whole of BF-7's hard part. When `DurationPreset` becomes a
number (PR 2b), `durationDirection` is the only function that changes and every algorithm selection
downstream is already right.

**Nothing changes today, and that is asserted rather than assumed:** the first test pins that the
three labels map to −1 / 0 / +1, which *are* the old `=== 'short'` / neither / `=== 'long'` branches.

## The plan I wrote this morning was wrong about one thing

It said to compare the chosen budget against the anchor. `budgetForPreset` **clamps** at
`MIN_PRESET_BUDGET_MIN` (20), so a session configured at or near the floor has its `short` clamped
back up to its own budget:

```
budgetForPreset(20, 'short') === 20      // nowhere lower to go
budgetForPreset(25, 'short') === 20      // 25 − 30 would be −5
```

A direction read off that says **"same"**, which would silently switch those sessions from dropping
exercises to trimming sets — a behaviour change smuggled inside a refactor advertised as
behaviour-preserving, on exactly the sessions least able to absorb it.

So `requestedBudgetMin` is split out as the unclamped half and the direction reads that. **The
request is the intent; the clamp is what is achievable.** Both are tested at the floor and at
`floor + 5`, where the clamp still bites.

The plan is corrected in place rather than left to mislead the next reader.

## Why this is PR 2a and not the whole thing

The plan's steps 1, 2 and 4 — `DurationPreset` becoming a number, and the route's Zod enum widening —
are PR 2b's, because they are what the *control's* new values need and the control is Lane B's. This
step touches **no Lane B file and no wire contract**: the route still accepts the three strings, the
components still send them, and the engine converts to a direction internally. It is shippable alone
precisely because it changes nothing observable.

## Verification

Nineteen tests in `packages/shared/src/workout/__tests__/duration-presets.test.ts`: the label
equivalence, relativity (a 90-minute session asked to go short is still shorter, even though 60 would
be "standard" for the owner's usual session), the floor edge in both directions, and a sweep over
seven budgets asserting a standard session **never** reports "longer" — that is the only thing that
runs `expandToBudget`, and the under-fill it would spend is the finish-early margin.

Mutation pass, exit codes captured directly:

| Mutation | Caught |
|---|---|
| direction read off the **clamped** budget (the plan's error) | ✅ |
| standard reports "longer" — would spend the finish-early margin | ✅ |
| `requestedBudgetMin` re-applies the floor | ✅ |
| the prescription call site reverted to the label | ✅ |
| **control** — direction spelled with `Math.sign` (equivalent) | correctly passed |

The fourth needed its own guard. Nothing behavioural could catch it: `durationDirection` returns
exactly what the labels selected, so reverting the call site leaves every other test green. It reads
the source, strips comments first (the change's own note names the labels it replaced, and the first
version failed on its own explanation), and it is honestly the weakest test here — it is present
because the alternative is nothing.

Full gate green: `Ran 75 of 75 Custom Rules steps`, lint, both typechecks, `8693 passed | 87 skipped`.

**Not exercised: the S25, and no user-visible change to look at.** The control still offers three
segments and the plans they produce are byte-identical. The device check belongs with PR 2b, when 45
becomes selectable.
