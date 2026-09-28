# 2026-09-28 — LB-173: the pre-workout primary action drops its dumbbell

**Lane B.** Branch `feat/start-workout-button-no-icon`. v1.478.2.

## What shipped

`components/workout/pre-workout-screen.tsx` — `DumbbellIcon` removed from **both** action states of the
screen's primary button (`Start Workout` and `Continue Workout`), and the now-unused import dropped.
Guard: `components/workout/__tests__/lb173-start-workout-no-leading-icon.test.ts`.

The decision was the Orchestrator's, made 2026-09-28 and explicitly not put to the owner: of 43
full-width primary `<Button>`s across `components/**` and `app/**`, **33 are text-only — 77%**, so the
icon-less form is the house convention and this screen was the outlier. CLAUDE.md's mockup rule exempts
an entry that merely restyles a component, and the 2026-09-22 narrowing puts a derivable choice on the
agent.

## Two corrections to the entry, both from re-verifying it against `main`

**1. There were two dumbbells, not one, in the same button.** The entry named only `Start Workout`.
`Start Workout` and `Continue Workout` are adjacent states of **one** primary-action slot, and both
carried `DumbbellIcon`. Stripping only the named state would have made the icon appear and vanish as
the workout started — an inconsistency *inside* one button, which is worse than the between-screens
one the entry was raised to fix. Both are stripped; that is the sibling-surface rule applied to states
rather than to files.

**2. "Both become text-only" overstates the outcome, and there is a third site.** The entry describes
the comparison as the session card's button having "no icon". It does not: `recommendation-card.tsx:300`
renders `Start Workout` followed by a **trailing arrow SVG**. And a third button exists that the entry
never names — `app/workout-select/workout-select-content.tsx:472`, which *is* genuinely text-only.
So after this change the three read: pre-workout text-only, workout-select text-only, session card
text-plus-trailing-arrow.

**That does not change the call**, and the reason is the entry's own: a trailing arrow is a directional
affordance, not a decorative leading icon — the same distinction the entry used to exclude 8 `Loader2`
spinners from its 43-button census. The dumbbell was the only decorative leading icon in the set. It is
worth recording because "both become text-only" would otherwise read as a claim someone could check and
find false. Neither of the other two buttons was touched: both are hand-rolled `<button>`/`<motion.button>`
elements, so they were never in the `<Button>` census to begin with.

## What is deliberately left

`RefreshCwIcon` on the `Preparing…` state and `CheckIcon` on `Complete Workout` / `Done for today`
stay. A spinner is a state indicator on the entry's own reasoning, and a completion mark carries meaning
the text does not. The resulting rule is coherent: the two **action** states are text-only, the two
**completion** states keep their check. The guard asserts this positively, so stripping either check
fails it.

## Verified

- Guard 5/5, and **control-run in every form it claims to cover** — re-adding the icon to
  `Start Workout` (the collapsed string-literal branch) fails 2, re-adding it to `Continue Workout`
  (the JSX text-node branch) fails 2, stripping the `CheckIcon` fires the negative control, and the
  restored tree is 5/5. The first draft of the guard was itself wrong and its own run caught it: a
  plain `indexOf('Complete Workout')` matched the phrase inside a **comment** above the block and
  walked backwards from there. It keys on a line that *is* the label now.
- Centring checked by reading `components/ui/button.tsx` rather than assuming: the base is
  `inline-flex items-center justify-center gap-2`, so a lone text child centres and the `mr-2` left with
  the icon that owned it.
- `npx tsc --noEmit` clean · `pnpm check:rules` **Ran 83 of 83** · `pnpm lint` 0 errors · full
  `pnpm test` green · `pnpm build` clean.

**Not exercised:** not rendered on screen and not device-verified. This removes an icon from a button on
a path the owner uses daily, so it is visible on his next workout — the entry's own note that the
**reversal cost is two lines** is what makes that acceptable rather than a gap to close first. No
offline-first, native, safe-area, gesture or notification surface is touched.
