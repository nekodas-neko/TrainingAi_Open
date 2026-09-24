# 2026-09-24 — RV-121: `/collection` gets a permanent address

**Branch:** `fix/rv121-collection-more-row` · **Lane:** B (Implementation) · **Domain:** app-shell

## What shipped

One `MoreRow` in `components/more/profile-tab.tsx`, under **Your setup**, pointing at `/collection`.

Before this the route had **exactly one door**: a link inside `home-card-widget.tsx`'s
`case 'card_collectionWidget'`, which returns `null` unless that widget is enabled — and
`DEFAULT_CARD_WIDGETS` is `[]`. On a fresh install the screen existed and nothing could reach it.

## The decision was the owner's, and he took the recommendation

Two ways to fix it, and they are not equivalent: a More-tab row, or turning the Home card on by
default. The second changes what Home shows on every install, which is the owner-gated class. He
chose the row and **`DEFAULT_CARD_WIDGETS` stays empty**, so Home is untouched.

**Why "Your setup" despite the label.** BF-82 collapsed seven one-row groups into two, and the split
it chose is *your stuff / the app*. A third heading would re-create the defect it removed, and the
collection is his rather than configuration — so it goes in the "yours" half even though that half
is labelled for setup. Renaming the group is an information-architecture change nobody asked for.

## Verification

- `components/more/__tests__/rv121-collection-is-reachable.test.ts` — 4 tests. **The rule it pins is
  "more than one door, and one of them is unconditional", not the row itself**: a test asserting the
  literal row would pass if someone moved it back inside another preference-gated branch. It also
  guards the other half of the owner's decision — that `DEFAULT_CARD_WIDGETS` is still empty — since
  that is what a later "improvement" would undo.
- **Control-run against `origin/main`: 2 of the 4 red**, the two that matter. The other two are the
  guard-on-the-guard and the Home-unchanged assertion, both correctly true either way.
- `e2e/rv121-collection-reachable.spec.ts` — a real browser at 412 px: the row renders on the seeded
  account with no preference set, and tapping it lands on the collection screen. **This is why there
  are two tests rather than one** — the E2E job is advisory in CI, so the vitest file is the half
  that actually gates.
- `pnpm check:rules` · `tsc --noEmit` clean · lint clean.

**Not exercised:** the APK. WebView-only change (no `android/**`, no plugin), so it arrives by
Railway deploy, but Samsung WebView rendering and safe-area are untested here.

## Also

`DV-7`'s falsifiable claim cited RV-121's two instances as live examples; both have now shipped, so
that citation is amended rather than left to send the device agent looking for fixed bugs.

## Next

Lane B's queue head is BF-191, then RV-171 — the latter is worth reading first: a failed request
while the meal-plan setup opens silently deletes every saved dietary restriction.
