import { test, expect } from '@playwright/test'
import { settleRouteBoundary } from './fixtures'

/**
 * Q-410 — the guided walk's pacer, on the one rung a browser can actually reach.
 *
 * The ladder is cadence → speed → heart rate. **Cadence and heart rate are not testable here** and
 * are not tested here: both come from a Polar H10 over BLE, which does not exist in a browser or in
 * `pnpm dev`. What this spec proves is the middle rung and the two things around it:
 *
 *   1. the live readout leads with **km/h** (the unit the owner asked for by name) and the km/h and
 *      the min/km beside it are the same number in two units — the One Formula claim, checked
 *      rather than asserted in a comment;
 *   2. with no cadence source the pacer **falls to speed and says so**, rather than silently
 *      changing what the screen means;
 *   3. a history too thin to derive a speed target from drops the rung instead of inventing one.
 *
 * **Mutation-checked.** Making `speedTargetsFromHistory` ignore `MIN_SEGMENTS_FOR_SPEED_TARGET`
 * fails assertion 3; deleting the `fallbackNote` fails assertion 2; leading with min/km again fails
 * assertion 1.
 */

// The pacer's speed rung is stubbed through `/api/guided-walk/segment-stats`, and the service
// worker re-issues every /api request out of Playwright's reach — so without this the stub applies
// or not depending on whether the worker has claimed the page.
test.use({ serviceWorkers: 'block' })

test.setTimeout(180_000)

const USABLE_HISTORY = {
  fast: { avgHr: 150, avgPaceSecPerKm: 600, avgCadenceSpm: 125, totalDistanceKm: 3, avgDistanceKm: 0.3, count: 10 },
  slow: { avgHr: 110, avgPaceSecPerKm: 900, avgCadenceSpm: 90, totalDistanceKm: 2, avgDistanceKm: 0.2, count: 10 },
}

/** The same history, one walk's worth — below the floor for deriving a target. */
const THIN_HISTORY = {
  fast: { ...USABLE_HISTORY.fast, count: 1 },
  slow: { ...USABLE_HISTORY.slow, count: 1 },
}

async function startWalk(page: import('@playwright/test').Page, history: unknown) {
  await page.route('**/api/guided-walk/segment-stats', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(history) }))
  // A walk left mid-flight by a previous run would rehydrate straight into the active screen with
  // the wrong config, masking exactly the state under test.
  await page.addInitScript(() => window.localStorage.removeItem('ta_guided_walk_v1'))

  await page.context().grantPermissions(['geolocation'])
  await page.context().setGeolocation({ latitude: -27.4698, longitude: 153.0251 })

  await page.goto('/activity/guided-walk')
  await settleRouteBoundary(page)
  await expect(page.getByRole('heading', { name: 'Interval walk' })).toBeVisible()
  await page.getByRole('button', { name: 'Start walk' }).click()
}

/** Walks ~28 m north, which at these intervals lands the pace well inside a plausible walk. */
async function walkNorth(page: import('@playwright/test').Page, steps: number) {
  for (let i = 1; i <= steps; i++) {
    await page.context().setGeolocation({ latitude: -27.4698 + i * 0.00005, longitude: 153.0251 })
    await page.waitForTimeout(1_200)
  }
}

test('the live readout leads with km/h, and it is the pace beside it in another unit', async ({ page }) => {
  await startWalk(page, USABLE_HISTORY)
  await walkNorth(page, 5)

  const kmh = page.locator('text=/^km\\/h$/').first()
  await expect(kmh, 'the walk screen must lead its speed readout with km/h').toBeVisible()

  const row = page.locator('div').filter({ has: kmh }).last()
  const text = (await row.innerText()).replace(/\s+/g, ' ')
  // e.g. "5.2 km/h · 11:32 /km"
  const m = text.match(/([\d.]+) km\/h · (\d+):(\d{2}) \/km/)
  expect(m, `expected a "N km/h · M:SS /km" pair, got ${JSON.stringify(text)}`).not.toBeNull()

  const shown = Number(m![1])
  const paceSec = Number(m![2]) * 60 + Number(m![3])
  // Both come off the one pace series, so they must agree. The tolerance is the rounding the two
  // formats apply (1dp of km/h, whole seconds of pace), not slack for a second computation.
  expect(Math.abs(shown - 3600 / paceSec)).toBeLessThan(0.15)
})

test('with no cadence source the pacer falls to speed and says which signal is pacing', async ({ page }) => {
  await startWalk(page, USABLE_HISTORY)
  await walkNorth(page, 5)

  // A browser has no chest strap, so the top rung is genuinely absent — this is the real fallback,
  // not a simulated one.
  await expect(page.getByText(/No cadence source — pacing by speed/)).toBeVisible()
  const bar = page.getByRole('progressbar')
  await expect(bar).toBeVisible()
  // Colour is never the whole message: the bar's label is the sentence the reader acts on.
  expect(await bar.getAttribute('aria-label')).toMatch(/spm|km\/h|bpm|Stopped/)
})

test('a history too thin to derive a speed target from drops the rung rather than inventing one', async ({ page }) => {
  await startWalk(page, THIN_HISTORY)
  await walkNorth(page, 5)

  await expect(page.getByText(/pacing by speed/)).toHaveCount(0)
  // Nothing below it either: a browser has no heart-rate strap, so the ladder runs out and the
  // pacer renders nothing at all rather than a bar with no target behind it.
  await expect(page.getByRole('progressbar')).toHaveCount(0)
})
