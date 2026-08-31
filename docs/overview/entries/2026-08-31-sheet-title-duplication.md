# 2026-08-31 — a sheet should say its name once (LB-23)

**Branch:** `claude/implementation-agent-lane-b-43nmep` · **Lane B** · v1.405.1

## What it was

Radix needs a `SheetTitle` for the dialog's accessible name. Next to an already-styled header, the
obvious way to satisfy that is to add an `sr-only` one beside the visible `<h2>` — and three sheets
did: `end-of-day-review`, `morning-checkin-sheet` and `food-logger-sheet`. A screen reader then
reads the name once as the dialog's and again as a heading, and `getByRole('heading', { name })`
matches two nodes, which is why `e2e/day-review-one-door.spec.ts` had to match on the dialog and
leave a comment pointing at this entry.

`<SheetTitle asChild><h2 …>` is the whole fix: one node, which *is* both. `SheetTitle` is typed as
`React.ComponentProps<typeof SheetPrimitive.Title>`, so `asChild` needed no change to
`components/ui/sheet.tsx`. Its own `text-foreground font-semibold` merges with the heading's
`text-base font-semibold` through Radix's Slot — different properties plus one idempotent
duplicate, so nothing is lost.

## `quick-edit-log-sheet` is not a violator, and that distinction is the rule

It has an `sr-only` `SheetTitle` reading "Edit Serving" and a visible header showing the *food's
name* — two different strings, so nothing is said twice. An `sr-only` title on its own stays
perfectly legal. That is why the guard matches on the **text** rather than on the `sr-only` class:
a check that banned the class outright would have failed a correct file.

## Verified, both directions

- `e2e/day-review-one-door.spec.ts` now asserts `getByRole('heading', { name: 'End of Day' })` has
  count **1** and that the dialog's accessible name still carries it — the locator the entry said
  the spec could go back to using. Reverting the fix on that one sheet makes it read **2**, so the
  assertion is load-bearing rather than decorative.
- `components/ui/__tests__/sheet-title-duplication.test.ts` scans `app/` and `components/` for an
  `sr-only` `SheetTitle` whose text also appears inside a heading in the same file. Restoring the
  `morning-checkin` pattern fails it by name; the real tree passes; `quick-edit-log-sheet` is
  untouched by it. It catches an interpolated title (`{STEP_LABELS[step]}`) as well as a literal,
  which is how `food-logger-sheet` said it twice.
- `tsc --noEmit` clean · `pnpm check:rules` **Ran 63 of 63**.

## Not exercised

- **A real screen reader.** The defect is an announcement, and what is proven here is the DOM that
  produces it: one node where there were two, with the dialog's accessible name intact. A TalkBack
  pass is owed and is already on the device queue as a carried item.
- The other two sheets have no e2e assertion of their own — reaching Morning Check-in and Log Food
  costs two more navigations for a property the source guard already holds across all three. The
  guard is the coverage; the e2e assertion exists because one rendered proof beats three static ones.
