# The diary row is the shared row, and the sheet it opens can delete (Q-406)

**Branch:** `feat/diary-row-shared-shape` · **Lane B** · v1.367.0

## What shipped

The diary row in `meal-card.tsx` is now the shared `FoodRow`: name, a grey line of *what and how
much*, calories right-aligned, chevron. The inline pencil and bin are gone; editing and deleting
both live in the sheet a tap opens.

**`QuickEditLogSheet` gained a delete in the same change**, and that is the whole reason this could
ship. Q-406 says so outright: converting the diary row without it *"removes the only way to correct
a logged food. That is LB-1's failure exactly."* The sheet had no delete, so the conversion was
gated on adding one.

Q-395a was supposed to carry this — *"convert it in Q-395a, in the same PR that adds the sheet"* —
and did not. This closes that gap.

## A pre-existing defect this turned up: five sheets cannot be opened in `pnpm dev`

The converted row would not open its sheet. It renders with `log` truthy for two renders and then
closes itself. **The same is true on `main` from the pencil** — checked by stashing, so this is not
something the conversion introduced.

The cause is `lib/hooks/use-sheet-back-dismiss.ts`. It pushes a history entry on open and its
cleanup calls `history.back()`. Under React StrictMode's dev double effect-invoke the sequence is
push → cleanup's `back()` → push again, and the `popstate` from that `back()` lands *after* the
second push carrying the pre-push state. The handler sees a `sheetId` that is not its own and calls
`onClose()`.

With `reactStrictMode: false` the sheet opens correctly — verified, then reverted. So **production
is unaffected** (no double-invoke there), but `pnpm dev` is this repo's own pre-merge test surface,
and five sheets are unopenable on it: `quick-edit-log-sheet`, `food-logger-sheet`,
`food-library-sheet`, `morning-checkin-sheet`, `end-of-day-review`. Filed as **LB-10**; same family
as Q-461, where an animation made the workout write path undrivable.

## Verification

Driven at 412×915 against `pnpm dev` + local Postgres. The edit and delete legs needed
`reactStrictMode: false` for the reason above — CLAUDE.md sanctions the toggle for verification, and
it was reverted:

| | |
|---|---|
| row shape | *"Chicken pate · Drava · 2 servings · 96 g · 298 kcal"* with a chevron |
| inline pencil/bin | **0** remaining |
| tap → sheet | *"Edit Serving · Chicken pate · Drava · 48g per serving"* |
| edit | `×3` then Save → DB `quantity_multiplier` **2 → 3**, row redrew as *"3 servings · 144 g · 447 kcal"*, day total followed to 767 kcal |
| delete | Remove closes the sheet and opens exactly **one** confirm (*"Delete food log?"*); Delete took live logs **2 → 1**, the row vanished, totals fell to 320 kcal |

`tsc --noEmit` clean · `eslint` zero warnings introduced · `pnpm check:rules` **Ran 56 of 56** ·
`check-memo-prop-stability` clean (the row needed the same `.map()` wrapper pattern —
`onQuickEdit` takes an **id** now, resolved against a `logsRef` in the parent, so the row's props
stay scalar).

## What the row gave up, deliberately

The per-item **P/C/F** line. Q-406's agreed shape has no macros on the row — they are in the sheet's
live preview, which updates as you change the serving. The meal's totals footer still carries the
macro split at rest, so the screen has not lost the numbers, only the per-row repetition.

## Not exercised

**Nothing on the S25**, and the row is now the app's most-repeated element on the Nutrition tab.

**The edit and delete legs were driven with StrictMode off.** That is production's configuration, but
it is not the configuration `pnpm dev` runs, so a future session re-checking this by hand in dev will
find the sheet refusing to open and should read LB-10 before concluding anything is broken.

**A tap does not reliably hit the sheet's Remove button in the harness** — it lands on the scrim and
closes the sheet. `el.click()` works. That cost two runs here and is worth knowing.
