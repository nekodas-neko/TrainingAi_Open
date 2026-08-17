# 2026-08-17 — Q-261: the six button groups on More that had no accessible name

**Branch:** `claude/implementation-lane-b-0o7kb9` · **Version:** v1.317.4 · **Lane:** Implementation B

## What this was

Q-258 associated every `<Label>`/`<Input>` pair in `components/profile/`. Six `<Label>`s were left
behind because they are a different shape — they front groups of buttons, or static text, so
`htmlFor` had nothing to point at. The backlog entry recorded them rather than letting the sweep
look complete, and left the design question open: `@radix-ui/react-label` pointed at a `<div>` of
buttons is the wrong element, not a half-configured one.

Verified the premise against `main` before building: exactly the six cited sites, at the cited
lines, unchanged.

## What shipped

Five of the six front mutually-exclusive option sets — Fitness Goal, Biological Sex, Activity Level,
Weight Units, Food Region. They now carry `role="radiogroup"` + `aria-labelledby`, with
`role="radio"` + `aria-checked` on each option.

**That choice is house precedent, not a new invention.** Three sites already do exactly this
(`workout/deload-toggle.tsx`, `workout/session-duration-picker.tsx`,
`more/home-widgets-section.tsx`). A fourth site — `nutrition/ingredient-row.tsx` — uses the
competing `role="group"` + `aria-pressed` shape. The backlog entry proposed `role="group"`, but
`radiogroup` is both the accurate semantic for pick-one and the majority precedent, so the five went
that way and the entry's suggestion was not followed literally.

**`aria-labelledby` rather than `aria-label`.** The three existing sites use `aria-label`, which is
right for them — they have no visible label. These five do, so pointing at the on-screen text means
the visible label and the accessible name cannot drift.

**Timezone was the one case that is not a group.** Its `<Label>` fronted a static value plus an
unrelated action button, so it became a plain styled `<p>` — nothing was being labelled. The button
left behind was named only "Auto-detect", which says nothing once the surrounding text is not
visible; it is now `aria-label="Auto-detect timezone"`.

Nothing moved visually. The replacements carry the computed classes `<Label>` resolved to
(`flex items-center gap-2 text-xs leading-none font-medium select-none` plus the call site's
`text-muted-foreground`), so this is an accessibility-tree change and nothing else.

## The guard, and why it was mutation-checked

`e2e/profile-group-labelling.spec.ts`, two tests. Every assertion is a role query —
`getByRole('radiogroup', { name })` resolves the name through `aria-labelledby`, so it reads the
accessibility tree rather than the DOM, which is what the backlog entry asked for ("verify with a
screen reader or an accessibility-tree dump, not by eye").

Q-259's lesson is that a guard which cannot fail is not a guard, so both were checked by mutation
rather than assumed:

| Mutation | Result |
|---|---|
| Drop `role`/`aria-labelledby` from `goal-targets-section.tsx` | Test 1 fails; test 2 passes |
| Drop them from `edit-profile-sheet.tsx`'s units row | Test 2 fails; test 1 passes |

So the assertions are independent and each dies with the fix it covers.

One assertion is deliberately weaker than it looks: Fitness Goal, Biological Sex and Activity Level
all clear on a second tap of the active option, and the seed user may have none set, so the spec
asserts `aria-checked` is *present and boolean* on every option rather than that one is checked.
Weight Units is the one group that cannot be cleared, so it is the one place the checked count is
asserted exactly.

## What was NOT exercised

- **TalkBack on the S25.** Playwright reads Chromium's accessibility tree. That proves the name and
  checked state are exposed — the mechanism that was broken — and it is not the same as hearing the
  announcement on the device. This is the outstanding item and the reason the Known-Issues row stays
  in `projectOverview.md` rather than moving to the resolved archive.
- **The APK generally.** Per `e2e/README.md`, the harness drives the web build; `getLocalStore`
  returns null there. Nothing in this change touches an offline-first path, so that limitation does
  not bite here, but it is stated rather than assumed.
- **Safe-area / layout.** Not exercised, and not at risk: no fixed header, bottom-anchored control
  or sheet inset was touched, and the computed classes are unchanged.

## Filed, not fixed

**Q-350** — none of the app's now-eight `role="radiogroup"`s implements arrow-key navigation with a
roving `tabindex`. Q-261 matched the three existing sites rather than fixing them: building that
inside a labelling fix would have been an unrequested refactor, and five sites with keyboard nav
next to three without is worse than eight consistent ones. It is genuinely low priority on a
touch-only APK where TalkBack navigates by swipe, and it wants a shared `components/ui/` primitive
across all eight rather than eight hand-rolled copies.

## Gates

`tsc --noEmit` clean · `pnpm lint` 0 errors (122 pre-existing warnings) · `pnpm test` 376 files /
3320 tests passed, 0 failed · `pnpm check:rules` **36 of 36** · `pnpm e2e` 14 passed including the
two new specs.
