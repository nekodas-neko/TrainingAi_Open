import { test, expect } from '@playwright/test'
import { settleRouteBoundary } from './fixtures'

/**
 * BF-105 — a guided walk's phase change had no in-app cue at all.
 *
 * The owner, mid-walk: *"there isn't enough of a queue to indicate session phase changed."* The
 * scheduled notification fires correctly and on time; what did not exist was any response on the
 * screen the walker is holding. The whole of it was one word swapping colour.
 *
 * The two assertions fail independently and both are durable rather than racy: the flash is keyed
 * on the cued segment and stays mounted once a change has fired, so this never has to catch an
 * 800 ms animation mid-flight.
 *
 * What this does NOT prove: the haptic. `Haptics.impact` is a Capacitor call that no-ops off the
 * APK, so the pocket case — the half the report is actually about — is device-only. See the entry's
 * verification list.
 */

const CONFIG = { sets: 2, fastSec: 20, slowSec: 20, warmupSec: 0, cooldownSec: 0, treadmill: true }

// A cold `pnpm dev` compiles /activity/guided-walk and /api/guided-walk/segment-stats on first use,
// and the walk itself then runs for a real 20 seconds.
test.setTimeout(180_000)

const flash = 'div[aria-hidden="true"][style*="radial-gradient"]'

test('a phase change lands on the screen, not only in a notification', async ({ page }) => {
  // Anchored to the moment the page navigates, so the boundary is a known distance away however
  // long the route took to compile. `treadmill` keeps the GPS watcher from ever starting.
  const seed = (config: typeof CONFIG) => {
    window.localStorage.setItem('ta_guided_walk_v1', JSON.stringify({
      state: {
        mode: 'active', config, customConfig: null, startedAtMs: Date.now(),
        rawPoints: [], distanceKm: 0, currentPaceSecPerKm: null, recentSpeedKmh: null,
      },
      version: 0,
    }))
  }

  // Warm the route first: the seed re-anchors on every navigation, so the visit that matters
  // starts its 20-second clock against an already-compiled page.
  await page.addInitScript(seed, CONFIG)
  await page.goto('/activity/guided-walk')
  await page.waitForLoadState('networkidle')
  await page.goto('/activity/guided-walk')
  await settleRouteBoundary(page)

  // A set is slow-then-fast, so the walk opens on Slow.
  await expect(page.getByText('Slow', { exact: true })).toBeVisible({ timeout: 60_000 })

  // Nothing has changed yet, so nothing should have flashed. This is the assertion that fails if
  // the wash fires on mount — which would mean it fires when a walk in progress is merely resumed.
  await expect(page.locator(flash)).toHaveCount(0)

  // The boundary. Before the fix, this was the entire on-screen response to it.
  await expect(page.getByText('Fast', { exact: true })).toBeVisible({ timeout: (CONFIG.slowSec + 20) * 1000 })
  await expect(page.locator(flash)).toHaveCount(1)
})
