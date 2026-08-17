import { test, expect } from '@playwright/test'
import { settleRouteBoundary } from './fixtures'

/**
 * Q-350 — the app's eight `role="radiogroup"`s had no arrow-key navigation and no roving tabindex,
 * so `Tab` walked every option individually and the arrows did nothing.
 *
 * **Mutation-checked**: removing `onKeyDown` from `useRovingRadioGroup`'s `groupProps` fails the
 * arrow assertions; removing its `tabIndex` line fails the single-tab-stop one.
 *
 * Asserts `aria-checked` and `tabIndex` rather than visual state — those are the properties the
 * keyboard contract is about, and what a screen reader reads.
 *
 * Two groups are driven, and the second one is the interesting case. The three goal groups PATCH on
 * every change; they used to carry `disabled={saving}`, and a browser drops focus from an element
 * that becomes disabled — so an arrow keypress moved the selection and then ejected the user from
 * the group. That was Q-355, found by this spec failing, and fixed by moving the in-flight guard
 * into the handler behind `aria-disabled`. Fitness Goal therefore now asserts focus too: it is the
 * group where losing it was the actual bug.
 */
test.setTimeout(180_000)

test('arrow keys move and select within a radiogroup, and it is one tab stop', async ({ page }) => {
  await page.goto('/more')
  await settleRouteBoundary(page)
  await page.getByRole('button', { name: 'Edit Profile' }).click()

  const group = page.getByRole('radiogroup', { name: 'Food Region' })
  await expect(group).toBeVisible({ timeout: 60_000 })
  const options = group.getByRole('radio')
  const count = await options.count()
  expect(count).toBe(4)

  // Roving tabindex: exactly one option is reachable by Tab, whatever the selection state.
  expect(
    await group.locator('[role="radio"][tabindex="0"]').count(),
    'a radiogroup must be a single tab stop',
  ).toBe(1)

  // Focus the first option directly rather than tabbing in, which would depend on everything above
  // it in the sheet.
  await options.first().focus()
  await options.first().press('ArrowRight')

  // Arrow selects as it moves — the ARIA behaviour for a radiogroup, achieved by routing the
  // keypress through the option's own onClick rather than reimplementing each site's semantics.
  await expect(options.nth(1), 'ArrowRight should select the next option').toHaveAttribute('aria-checked', 'true')
  await expect(options.nth(1), 'and focus should follow it').toBeFocused()
  await expect(options.first()).toHaveAttribute('aria-checked', 'false')

  await options.nth(1).press('ArrowLeft')
  await expect(options.first(), 'ArrowLeft should move it back').toHaveAttribute('aria-checked', 'true')
  await expect(options.first()).toBeFocused()

  // Wrap-around, so the group has no dead ends.
  await options.first().press('ArrowLeft')
  await expect(options.nth(count - 1), 'ArrowLeft from the first option should wrap to the last').toBeFocused()
  await expect(options.nth(count - 1)).toHaveAttribute('aria-checked', 'true')
})

test('a radiogroup that saves on change keeps focus while the PATCH is in flight', async ({ page }) => {
  // Q-355. This asserted only selection movement until the in-flight guard moved out of `disabled`;
  // the focus assertion below is the regression guard for that fix, and it fails if `disabled` comes
  // back — which is the whole reason the group is driven separately from Food Region.
  await page.goto('/more')
  await settleRouteBoundary(page)
  await page.getByText('Activity level, targets & AI recommendations').click()

  const group = page.getByRole('radiogroup', { name: 'Fitness Goal' })
  await expect(group).toBeVisible({ timeout: 60_000 })
  const options = group.getByRole('radio')

  await options.first().focus()
  await options.first().press('ArrowDown')
  await expect(options.nth(1)).toHaveAttribute('aria-checked', 'true')
  await expect(options.nth(1), 'the in-flight save must not eject keyboard focus').toBeFocused()

  // And again immediately, while the first PATCH is plausibly still in flight — one keypress
  // surviving could be luck, two in a row is the guard actually holding.
  await options.nth(1).press('ArrowDown')
  await expect(options.nth(2)).toHaveAttribute('aria-checked', 'true')
  await expect(options.nth(2)).toBeFocused()
})
