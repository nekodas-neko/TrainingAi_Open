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
 * **Driven against Food Region, not Fitness Goal, and the reason is a finding rather than a
 * preference.** The three goal groups pass `disabled={saving}` and their handlers PATCH on every
 * change, so selecting an option disables the focused button for the duration of the request — and
 * a browser drops focus from a disabled element. Arrow keys still *move the selection* there, but
 * focus is ejected from the group on each press. That is pre-existing save behaviour rather than
 * anything this hook does, it affects three of the eight groups, and it is filed as Q-355. Food
 * Region writes `localStorage` and never disables, so it can assert the full contract.
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

test('a radiogroup that disables itself while saving still moves selection on arrow', async ({ page }) => {
  // The Fitness Goal case (Q-355): focus is ejected by `disabled={saving}` mid-PATCH, but the
  // selection itself must still move — that is the half of the contract this group can keep.
  await page.goto('/more')
  await settleRouteBoundary(page)
  await page.getByText('Activity level, targets & AI recommendations').click()

  const group = page.getByRole('radiogroup', { name: 'Fitness Goal' })
  await expect(group).toBeVisible({ timeout: 60_000 })
  const options = group.getByRole('radio')

  await options.first().focus()
  await options.first().press('ArrowDown')
  await expect(options.nth(1)).toHaveAttribute('aria-checked', 'true')
})
