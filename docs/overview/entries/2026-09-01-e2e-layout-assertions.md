# 2026-09-01 · Lane A — the visual assertions that already existed, and the one flow that had none (BF-91)

Branch `lane-a/e2e-visual-assertions`. One new E2E spec, one README section, one follow-up entry.
No runtime code changed.

## The entry's headline, checked

*"58 E2E specs run at the S25 viewport and assert nothing visual."*

`grep -rl toHaveScreenshot e2e/` returning 0 is true. *"Assert nothing visual"* is not: **21 of the
58** assert layout through `boundingBox`, `stableBox` or computed style. And the four flows the
entry named as needing coverage — BF-73, BF-75, BF-52, Q-406 — have dedicated specs already
(`nutrition-sheet-surface`, `meal-label`, `food-row-shared`), each written around the exact claim
that would otherwise regress.

So the gap is not "nothing looks"; it is "no pixel baselines", and those turn out to be blocked.

## A session cannot generate a baseline CI would accept

`playwright.config.ts` runs the sandbox Chromium at a fixed path because the managed download is
proxy-blocked — its own comment says so. Measured:

| | |
|---|---|
| sandbox binary | **141.0.7390.37** |
| `@playwright/test` | 1.62.1, pinning chromium revision **1234** |
| what CI installs | **151.0.7922.34** |

Ten major versions of font rasterisation and compositing apart. A baseline committed from here fails
on its first CI run and every one after. That is a property of the sandbox rather than of any spec,
so it is split out as **LA-50** with what a CI-side `--update-snapshots` job would actually cost:
Actions write permission, a human approving the first images, and every baseline pinned to CI's
Chromium so a Playwright bump regenerates all of them.

## The flow that genuinely had nothing

BF-73's own `Keep:` records measurements — *"`New` 324×48 filling the row, the bin 48×48"* — and
**nothing asserted them**, so the claim lived in prose while the layout was free to drift back.
`e2e/meal-library-action-hierarchy.spec.ts` pins it: `New` at least four times the bin's width, the
bin square, both on one row, together filling it, and the bin still announcing itself as
`Delete meals` while deleting nothing on tap.

Ratios rather than pixel counts, so a viewport change cannot fail it — only a layout that stops
distinguishing the two controls.

## The assertion worth having, which is about a global rule

Both controls are written `h-11` — **44 px** — and both render **48**, because `globals.css` sets a
bare `button, [role="button"] { min-height: 48px }` that beats the utility. BF-73 found the same
rule in the other direction: `min-h-[84px]` on a `<button>` computes 48, so BF-50's `min-h-[62px]`
tile never applied and measured its content's 60 px instead (LB-32).

That makes the global floor load-bearing rather than incidental. **Mutation-tested: deleting the
`min-height` line from `globals.css` turns two of these tests red** — the buttons silently fall to
44, under this repo's own tap floor, with no class in the diff having changed. A source-level check
would read `h-11` and call it fine.

## Two spec bugs found by running it

The bin renders only when `canSelect={meals.length > 1}`, so a spec that seeds nothing asserts
against a control that is not there. It seeds two meals now, and says why in the comment.

And `getByRole('dialog', { name: /delete/i })` — meant as "no destructive confirm opened" — matched
the library sheet itself, whose accessible name contains the bin's label. It asserts on the data
instead: both meals are still listed after the tap.

## Why not a screenshot, stated once so it is not re-litigated

A baseline proves **change**; someone has to approve the first image, which converts a recurring
check into a one-time one rather than removing it. These assertions can be **wrong on the first
run**. Both halves are now in `e2e/README.md`, next to the existing note that nothing in this
harness touches the S25 — insets render as 0 here, which is the bug class that keeps recurring and
the one no browser test will ever catch.

Verified by `pnpm check:rules` (**Ran 67 of 67**), the full vitest suite, and the E2E spec passing
5/5 with three mutations each turning it red. **Not exercised:** no runtime code changed, and this
harness never touches the device.
