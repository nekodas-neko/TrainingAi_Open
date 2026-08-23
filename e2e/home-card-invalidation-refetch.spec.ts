import { test, expect } from '@playwright/test'
import { enableHomeCards, ensureEnergyBalanceProfile, settleRouteBoundary } from './fixtures'

/**
 * Q-402's fix, driven end to end for the first time.
 *
 * The owner's report was *"requires a restart of the app"*: Home's energy-balance card kept its
 * first payload forever. The eviction was never broken — six write groups clear `energy-balance:`
 * correctly — but nothing asked the card to go and get a new value, and the card lives in the
 * persistent tab shell, so its `useEffect(…, [])` never re-ran. `useCachedValue` +
 * `subscribeToInvalidation` are the missing half.
 *
 * **That fix shipped unguarded, and this is the guard.** Q-402's PR tried three times to drive it
 * and measured *zero* `/api/nutrition/energy-balance` requests, because the harness could not get
 * the card on screen at all: the seeded user has no `date_of_birth`, so the route answers
 * `balance: null` and the card renders "Add your date of birth in Profile"; and
 * `DEFAULT_CARD_WIDGETS` is empty, so Home renders no card widgets whatsoever. Both are fixtures
 * now (`ensureEnergyBalanceProfile`, `enableHomeCards`) and every future Home-card guard can use
 * them.
 *
 * **What this asserts is the request, not the rendered number.** The mechanism under test is
 * "something asks for a new value when a write clears the old one" — a second GET is present only
 * if that works, whereas a changed figure could come from a remount, and an unchanged one proves
 * nothing. Asserting the absence of staleness would pass either way, which the Q-452 lesson says is
 * not a guard.
 */
test.describe('Home cards refetch when a write invalidates their key (Q-402 / Q-359)', () => {
  test.beforeAll(async () => {
    await ensureEnergyBalanceProfile()
  })

  test('the energy-balance card refetches after a body-metric write, with no navigation', async ({ page }) => {
    await enableHomeCards(page, ['energyBalanceWidget'])

    const energyCalls: string[] = []
    page.on('request', r => {
      if (r.url().includes('/api/nutrition/energy-balance')) energyCalls.push(r.url())
    })

    await page.goto('/')
    await settleRouteBoundary(page)

    // The card is on screen with a real figure — not the "Add your … in Profile" empty state, which
    // is what every previous attempt at this test was actually looking at.
    const card = page.locator('div', { hasText: /^Energy Balance/ }).first()
    await expect(page.getByText('Energy Balance', { exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(card.getByText(/in Profile\.$/)).toHaveCount(0)
    await expect(page.getByText(/kcal (left today|over target)/)).toBeVisible({ timeout: 30_000 })

    // Let the first load — and dev-mode StrictMode's double-invoked effect — settle before taking
    // the baseline, so the increase asserted below is the write's and nothing else's.
    await expect.poll(() => energyCalls.length, { timeout: 30_000 }).toBeGreaterThan(0)
    await page.waitForLoadState('networkidle')
    const before = energyCalls.length

    // A body-metric write from Home itself. It matters that this is a sheet: Home stays mounted
    // throughout, so a refetch cannot come from a remount, which is the whole distinction Q-402 is
    // about.
    await page.getByRole('button', { name: 'Log Body Weight' }).click()
    await expect(page.getByRole('heading', { name: 'Log Body Weight' })).toBeVisible()

    const input = page.getByPlaceholder('Enter kg')
    await input.fill('81.4')

    const saved = page.waitForResponse(
      r => r.url().includes('/api/body-metadata') && r.request().method() === 'POST' && r.ok(),
    )
    await page.getByRole('button', { name: 'Save' }).click()
    await saved

    // `invalidateBodyMetricWrite()` clears `energy-balance:` (lib/cache-groups.ts:299). The card is
    // subscribed to that prefix, so it asks again. Revert `useEnergyBalanceToday` to a bare
    // `useEffect(() => { cachedFetch(…) }, [])` and this is the assertion that goes red.
    await expect
      .poll(() => energyCalls.length, {
        timeout: 20_000,
        message: 'the energy-balance card did not refetch after a write cleared its cache key',
      })
      .toBeGreaterThan(before)

    // Still on Home — no navigation happened, so nothing remounted.
    await expect(page).toHaveURL(/\/$/)
  })
})
