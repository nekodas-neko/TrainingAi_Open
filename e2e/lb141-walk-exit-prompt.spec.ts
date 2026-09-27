import { test, expect, type Page } from '@playwright/test'

/**
 * How you can leave a guided walk, measured rather than read off the source (LB-141).
 *
 * The entry was filed from a source read of the three `LeaveWalkDialog` callers, and one of the
 * three cannot fire: **`/activity/guided-walk` renders no tab bar at all.** `BottomNav` is mounted
 * by `tab-shell.tsx` (and the admin/error pages); the walk is its own route outside that shell, so
 * its `pathname.startsWith('/activity/guided-walk')` guard is never true while the component is on
 * screen. The tab-bar exit therefore discards nothing today, and its prompt is wiring for the day
 * the walk moves into the shell.
 *
 * That leaves the hardware back gesture as the only silent exit — a Capacitor `backButton`
 * listener, which has no web equivalent, so the prompt itself is NOT exercised here and the device
 * check is owed. This spec pins the reachability fact the entry got wrong, because it is the thing
 * that makes the rest of LB-141 either necessary or dead.
 */

async function seedActiveWalk(page: Page, elapsedSec: number) {
  await page.addInitScript((elapsed) => {
    window.localStorage.setItem('ta_guided_walk_v1', JSON.stringify({
      version: 0,
      state: {
        mode: 'active',
        // Segments are slow-then-fast per set (`buildIntervalPlan`), 5 sets of 3 + 3 minutes, so a
        // fixture younger than 30 minutes is never discarded as stale on rehydration.
        config: { sets: 5, fastSec: 180, slowSec: 180, warmupSec: 0, cooldownSec: 0, treadmill: false },
        customConfig: null,
        startedAtMs: Date.now() - elapsed * 1000,
        rawPoints: [],
        distanceKm: 0,
        currentPaceSecPerKm: null,
        recentSpeedKmh: null,
        finishRequested: false,
      },
    }))
  }, elapsedSec)
}

test('a walk in progress has no tab bar, so the tab-bar exit cannot discard it', async ({ page }) => {
  await seedActiveWalk(page, 5 * 60)
  await page.goto('/activity/guided-walk')
  await expect(page.getByRole('button', { name: 'End walk' })).toBeVisible({ timeout: 30_000 })

  // If this ever fails, the walk has been moved inside the tab shell and `bottom-nav.tsx`'s
  // LeaveWalkDialog has become live: assert its three options here instead of deleting this.
  expect(
    await page.locator('nav').count(),
    'the walk route renders no BottomNav — see this spec’s docblock',
  ).toBe(0)

  // The End button is the only way out that the screen itself offers. Everything else is the
  // hardware back gesture, which is where LB-141's prompt actually lands.
  const exits = await page.locator('main button, main a').allInnerTexts()
  expect(exits.filter(t => t.trim().length > 0)).toEqual(['End walk'])
})
