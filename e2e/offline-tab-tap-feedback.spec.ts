import { test, expect } from '@playwright/test'
import { settleRouteBoundary } from './fixtures'

/**
 * Offline with no service worker in control, a tab tap says something (Q-555).
 *
 * `serviceWorkers: 'block'` reproduces the real uncontrolled window — the first-ever load, where
 * the worker registers *during* the navigation and claims only afterwards. Measured before the fix:
 * offline, `navigator.serviceWorker.controller` is null, the tap leaves the URL unchanged, no
 * offline page appears, and there is no feedback of any kind. That silence is what reads as a frozen
 * app.
 *
 * The assertion is on the MESSAGE, not the URL. Not navigating is correct here and stays correct:
 * offline the cached screen the user is already looking at is the one thing that still works, so
 * throwing them at the browser's error page would lose it. What was missing was any explanation.
 */
test.use({ serviceWorkers: 'block' })

test('offline with no controller, a tab tap explains itself', async ({ page, context }) => {
  // The defect lives on `tab-loading.tsx` — the `loading.tsx` fallback, which renders `<BottomNav />`
  // with NO `onTabChange`. Inside `TabShell` a tap is in-app state and never routes, which is why the
  // shell is not the failing surface. Holding a tab route's response open keeps that fallback on
  // screen long enough to tap it. (A first probe skipped this and tapped from a settled `/health`,
  // measuring the shell's in-app switch instead — the URL does not change there either, which is
  // exactly what makes the two look alike.)
  let release: () => void = () => {}
  const held = new Promise<void>(r => { release = r })
  await page.route('**/nutrition**', async route => { await held; await route.continue() })

  await page.goto('/health')
  await settleRouteBoundary(page)
  const nav = page.getByRole('navigation')
  await expect(nav).toBeVisible({ timeout: 30_000 })

  // The precondition, asserted rather than assumed — with a controller this path works and the
  // warning would be a false alarm, so a spec that silently lost the precondition would pass for
  // the wrong reason.
  expect(
    await page.evaluate(() => !!navigator.serviceWorker?.controller),
    'the uncontrolled window is the whole subject of this spec',
  ).toBe(false)

  try {
    // First tap: routes, and hangs on the held response — so the loading fallback's BottomNav, the
    // one with no `onTabChange`, is what is on screen.
    const tap = async (name: RegExp) => {
      const link = page.getByRole('navigation').getByRole('link', { name }).first()
      const box = (await link.boundingBox())!
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
    }
    await tap(/Nutrition/i)
    await expect(page.locator('[aria-busy="true"]')).toBeVisible({ timeout: 15_000 })

    await context.setOffline(true)
    // A tab never visited this session, so its route is not in the client cache — `router.push` has
    // to reach the network and cannot. Tapping an already-loaded tab succeeds straight from cache
    // and proves nothing, which is what a first pass at this measured.
    await tap(/More/i)
    await expect(page.getByText(/Can't open that tab offline yet/i)).toBeVisible({ timeout: 10_000 })
  } finally {
    release()
    await context.setOffline(false)
  }
})
