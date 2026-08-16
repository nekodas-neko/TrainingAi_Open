# 2026-08-16 — labels that pointed at nothing

Q-258, found while writing the E2E goal spec and fixed here. v1.317.3.

## What was wrong

Six number inputs had `<Label>`s associated with nothing — no `htmlFor`, no `id`:

| File | Fields |
|---|---|
| `components/profile/goal-targets-section.tsx` | Steps Goal, Sleep Goal, Daily Water Goal, Calorie Goal |
| `components/profile/required-info-section.tsx` | Weight, Body Fat % |

A screen reader announces those as unnamed number fields. Sighted users see a label; anyone using
assistive tech gets "edit, blank".

**The convention already existed in the same file.** `required-info-section.tsx` correctly pairs
`goals-height` and `goals-birthYear`. So this is a consistency fix against a pattern already in the
directory, not a new idea imposed on it — the six now follow the same `goals-<field>` id scheme.

## The proof, which is a deletion

The Q-258 entry specified how to know it worked: re-point the E2E selector at `getByLabel` in the
same PR. `e2e/goal-round-trip.spec.ts` had been anchoring on DOM position —

```ts
page.getByText('Daily Water Goal').locator('xpath=following::input[1]')
```

— a brittle selector whose brittleness *was* the symptom. It is now `page.getByLabel('Daily Water
Goal')`, which resolves through the accessible name and therefore only works if the association
exists.

| State | Result |
|---|---|
| Association in place | **2 passed** |
| `goal-targets-section.tsx` reverted to `main` | **1 failed** |
| Restored | **2 passed** |

Full E2E suite green cold on a fresh database with `--retries=0`: **7 passed**.

That is a better guard than a new assertion would have been. Nobody has to remember to keep an
accessibility test alive — the spec cannot navigate the screen at all if the labels come unstuck.

## What was deliberately NOT fixed

Six more `<Label>`s in `components/profile/` still have no `htmlFor`, and they are a **different
shape**: they front button groups or static text rather than form controls, so there is no `id` to
point at. Fitness Goal, Biological Sex, Activity Level, Timezone, Weight Units, Food Region.

They are not bundled here because the fix is not mechanical. `<Label>` renders
`@radix-ui/react-label`, whose entire job is associating text with a control — pointed at a `<div>`
of buttons it is the wrong element, not an unfinished one. Whether each wants `role="group"` +
`aria-labelledby` or simply should not be a `<Label>` differs case by case (Timezone and Weight Units
front a value and a button, not a set of options). Filed as **Q-261** with that question stated,
rather than guessed at here.

Recording them matters because Q-258 swept this directory: stopping at the input pairs without
saying so would leave the sweep looking complete when it is not.

## Verification

`npx tsc --noEmit` · `pnpm lint` 0 errors · `pnpm build` · `pnpm check:rules` — **Ran 36 of 36** ·
unit suite **478 files / 3,939 tests** · E2E as above, including the revert.

**Not device-verified**, and the honest limit is sharper than usual here: Playwright resolving
`getByLabel` proves the accessible name is wired, which is the mechanism. It is not the same as
hearing TalkBack announce the field on the S25. The mechanism is what was broken and is what is
fixed; the announcement itself is unverified.
