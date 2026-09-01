import { test, expect } from '@playwright/test'
import { settleRouteBoundary } from './fixtures'

/**
 * Q-410 — the guided walk's pacer, on the one rung a browser can actually reach.
 *
 * The ladder is cadence → speed → heart rate. **Cadence and heart rate are not testable here** and
 * are not tested here: both come from a Polar H10 over BLE, which does not exist in a browser or in
 * `pnpm dev`. What this spec proves is the middle rung and the two things around it:
 *
 *   1. the live readout leads with **km/h** (the unit the owner asked for by name) and the min/km
 *      beside it is **labelled as the average**, because since LA-52 they are two different
 *      readings — a windowed speed and a cumulative pace;
 *   2. with no cadence source the pacer **falls to speed and says so**, rather than silently
 *      changing what the screen means;
 *   3. a history too thin to derive a speed target from drops the rung instead of inventing one.
 *
 * **Mutation-checked.** Making `speedTargetsFromHistory` ignore `MIN_SEGMENTS_FOR_SPEED_TARGET`
 * fails assertion 3; deleting the `fallbackNote` fails assertion 2; leading with min/km again fails
 * assertion 1, as does dropping the `avg` label.
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

test('the live readout leads with km/h, and the pace beside it is labelled as the average', async ({ page }) => {
  await startWalk(page, USABLE_HISTORY)
  await walkNorth(page, 5)

  const kmh = page.locator('text=/^km\\/h$/').first()
  await expect(kmh, 'the walk screen must lead its speed readout with km/h').toBeVisible()

  const row = page.locator('div').filter({ has: kmh }).last()
  const text = (await row.innerText()).replace(/\s+/g, ' ')
  // e.g. "5.2 km/h · avg 11:32 /km"
  const m = text.match(/([\d.]+) km\/h · avg (\d+):(\d{2}) \/km/)
  expect(m, `expected a "N km/h · avg M:SS /km" pair, got ${JSON.stringify(text)}`).not.toBeNull()

  // **This used to assert the two were the same number in two units, and that claim is now false on
  // purpose (LA-52).** The km/h is the last `SPEED_WINDOW_SEC`; the min/km is the average since the
  // walk started, which is what the summary's splits are in. They diverge the moment effort
  // changes — and they diverge here too, because the cumulative elapsed counts the seconds between
  // tapping Start and the first GPS fix, which the window does not.
  //
  // So the word `avg` is the assertion. Two numbers side by side, one live and one cumulative, with
  // nothing saying which is which, is how the cumulative one came to be read as "now" in the first
  // place. The agreement that IS still a property — that a windowed speed matches the speed it was
  // built from — is checked against known inputs in `lib/walk/__tests__/windowed-speed.test.ts`,
  // where a fixture can hold effort constant; a browser walking real geolocation cannot.
  expect(Number(m![1]), 'the km/h must be a plausible live walking speed').toBeGreaterThan(0)
  expect(Number(m![1])).toBeLessThan(25)
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
