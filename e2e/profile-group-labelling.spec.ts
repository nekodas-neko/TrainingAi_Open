import { test, expect } from '@playwright/test'
import { settleRouteBoundary } from './fixtures'

/**
 * Q-261 — the six option groups on More that were fronted by a bare `<Label>`.
 *
 * Q-258 associated every `<Label>`/`<Input>` pair on these screens. These six were a different
 * shape and were left: they front **groups of buttons**, not form controls, so `htmlFor` had
 * nothing to point at and `@radix-ui/react-label` was the wrong element rather than a
 * half-configured one. The result was a group of buttons with no accessible name at all.
 *
 * **This spec exists because the failure is invisible by eye.** The label text renders identically
 * either way; only the accessibility tree differs. Every assertion here is a role query, which is
 * the tree — `getByRole('radiogroup', { name })` resolves the name through `aria-labelledby`, so it
 * fails if the association breaks *or* if the visible text and the accessible name drift apart.
 *
 * **Mutation-checked, per the Q-259 lesson that a guard which cannot fail is not a guard.**
 * Measured by reverting each site in turn: dropping `role="radiogroup"`/`aria-labelledby` from
 * `goal-targets-section.tsx` fails the Fitness Goal assertion and nothing else; the same on
 * `edit-profile-sheet.tsx`'s units row fails only the Weight Units assertion. The five group cases
 * are independent, and each one is covered by exactly one assertion that dies with it.
 *
 * **What it does not cover.** Playwright reads Chromium's accessibility tree, not TalkBack's. It
 * proves the name and the checked state are exposed; it cannot prove how Samsung's screen reader
 * announces them on the S25, which stays a device check. It also does not assert arrow-key
 * navigation, which these radiogroups do not implement — see Q-350.
 */

// Three routes plus a sheet, each compiling on first use under `pnpm dev`. Same reasoning as
// `goal-round-trip.spec.ts`: the default 45 s budget is a warm-server number and this is not.
test.setTimeout(180_000)

test('the goals option groups expose a name and their selection state', async ({ page }) => {
  await page.goto('/more')
  await settleRouteBoundary(page)

  // Goals sit behind a collapsible row on More, not inline on it.
  await page.getByText('Activity level, targets & AI recommendations').click()

  // Named by its visible label, via `aria-labelledby` — not by a duplicated `aria-label` string
  // that could drift from what is on screen.
  const fitnessGoal = page.getByRole('radiogroup', { name: 'Fitness Goal' })
  await expect(fitnessGoal).toBeVisible({ timeout: 60_000 })
  // Every option inside carries `role="radio"`, so the group is not merely named but populated.
  // `FITNESS_GOALS` drives the list, so assert non-empty rather than pinning its current length.
  expect(await fitnessGoal.getByRole('radio').count()).toBeGreaterThan(0)

  const sex = page.getByRole('radiogroup', { name: 'Biological Sex' })
  await expect(sex).toBeVisible()
  await expect(sex.getByRole('radio')).toHaveCount(3)

  const activityLevel = page.getByRole('radiogroup', { name: 'Activity Level' })
  await expect(activityLevel).toBeVisible()
  expect(await activityLevel.getByRole('radio').count()).toBeGreaterThan(0)

  // Deliberately no assertion that one of these is checked: all three clear on a second tap of the
  // active option, and the seed user may legitimately have none set. The claim under test is that
  // the state is *exposed*, which is `aria-checked` being present on every option either way.
  for (const radio of await sex.getByRole('radio').all()) {
    expect(await radio.getAttribute('aria-checked')).toMatch(/^(true|false)$/)
  }
})

test('the Edit Profile rows expose names for their groups and their lone action', async ({ page }) => {
  await page.goto('/more')
  await settleRouteBoundary(page)

  await page.getByRole('button', { name: 'Edit Profile' }).click()

  // Unlike the three above, Weight Units cannot be cleared — it is kg or lbs — so exactly one
  // option is checked at all times. That makes it the one site where the checked state itself is
  // deterministic enough to assert.
  const units = page.getByRole('radiogroup', { name: 'Weight Units' })
  await expect(units).toBeVisible({ timeout: 60_000 })
  await expect(units.getByRole('radio')).toHaveCount(2)
  await expect(units.getByRole('radio', { checked: true })).toHaveCount(1)

  const foodRegion = page.getByRole('radiogroup', { name: 'Food Region' })
  await expect(foodRegion).toBeVisible()
  await expect(foodRegion.getByRole('radio')).toHaveCount(4)

  // The Timezone row is the one case that is NOT a group: its label fronted a static value plus an
  // unrelated action, so `<Label>` was dropped rather than re-pointed. What was left behind was a
  // button named only "Auto-detect", which says nothing about what it detects once the surrounding
  // text is not visible — the same naming failure in a different shape.
  await expect(page.getByRole('button', { name: 'Auto-detect timezone' })).toBeVisible()
})
