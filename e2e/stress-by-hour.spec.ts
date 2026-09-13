import { test, expect } from '@playwright/test'
import { settleRouteBoundary, suppressMorningCheckin } from './fixtures'

/**
 * TN-3b — the stress series gets a clock, so "when was I stressed" is answerable.
 *
 * Owner, approving the entry: *"Can we have this displayed on a widget or chart so we can see when
 * the stress occurs. I will be able to match it up based on time to what I was doing around then."*
 * The existing `stress-strip.tsx` sparkline shows the shape and **cannot answer "when"**, which is
 * the whole request.
 *
 * **The fixture is the measured day, not a convenient one.** It reproduces 2026-09-08's real shape:
 * a morning run, then the **06:45 → 13:15 hole** the review found, then an afternoon run. That hole
 * is the reason segments exist at all — a joined path across it would draw six and a half hours of
 * stress nobody recorded, which is the single way this chart could lie.
 *
 * The response is stubbed because the series is computed from ring dHRV that no harness can produce.
 * The layout arithmetic — bucketing, the gap threshold, the coverage figure, the timezone — is
 * covered in node by `components/body-battery/__tests__/stress-day.test.ts`; what only a browser can
 * show is that the thing draws, with the axis and the gap in it.
 */

// The card fetches `/api/body-battery`, and the service worker re-issues every `/api/` request where
// `page.route` cannot see it.
test.use({ serviceWorkers: 'block' })

test.setTimeout(120_000)

/** Brisbane wall-clock (UTC+10) on a fixed past day, as the instant it is. */
const at = (hh: number, mm: number) => Date.UTC(2026, 8, 8, hh, mm) - 10 * 3600_000

const STRESS_SERIES = [
  // The morning run, ending where the ring stopped.
  ...[[6, 15, -0.20], [6, 45, -0.31]],
  // …the hole…
  // …then the afternoon, running hard negative — the window the owner wants to place.
  ...[[13, 15, -0.52], [13, 45, -0.62], [14, 15, -0.69], [14, 45, -0.80], [15, 15, -0.74]],
].map(([hh, mm, level]) => ({ t: at(hh, mm), level }))

const BATTERY = {
  current: 62, label: 'Good', trend: 'draining', anchor: 78, anchorSource: 'readiness',
  anchorProvisional: false, charged: 4, drained: 20, wakeTime: at(6, 0),
  series: Array.from({ length: 12 }, (_, i) => ({ t: at(6, 0) + i * 1800_000, v: 78 - i * 1.5 })),
  hasData: true,
  confidence: { level: 'high', sampleCount: 420, samplesPerHour: 70, wakingMinutes: 360 },
  hrMax: { value: 190, source: 'estimated', observedPeak: null, peakDays: 0 },
  stress: {
    current: -0.74, draining: true, extraDrained: 6,
    series: STRESS_SERIES,
    highMinutes: 150,
  },
}

/**
 * The card is COLLAPSED on arrival and the chart lives in its expanded half.
 *
 * Worth stating because the first version of the negative test below passed without this — it
 * asserted the chart was absent from a card that was never opened, which is a test that cannot fail.
 * Both tests expand.
 */
async function openBatteryCard(page: import('@playwright/test').Page) {
  await suppressMorningCheckin(page)
  await page.goto('/')
  await settleRouteBoundary(page)
  const card = page.getByRole('button', { expanded: false }).filter({ hasText: 'Energy left right now' })
  await expect(card, 'the Body Battery card never rendered').toBeVisible({ timeout: 60_000 })
  await card.evaluate((el: HTMLElement) => el.click())
  await expect(page.getByRole('button', { expanded: true }).filter({ hasText: 'Energy left right now' }))
    .toBeVisible({ timeout: 15_000 })
}

test('the day’s stress is drawn against a clock, with the unmeasured hours left blank', async ({ page }) => {
  await page.route('**/api/body-battery**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BATTERY) }))

  await openBatteryCard(page)

  const chart = page.getByRole('img', { name: /Stress by time of day/ })
  await expect(chart, 'the chart never rendered').toBeVisible({ timeout: 60_000 })

  // **The axis is the feature.** Without labelled hours the reader cannot place a window against
  // their own memory of the day, which is the entire request.
  for (const label of ['00:00', '06:00', '12:00', '18:00']) {
    await expect(page.getByText(label, { exact: true }).first()).toBeVisible()
  }

  // **Two runs, not one line.** The 06:45 → 13:15 hole must break the path: seven buckets across a
  // six-and-a-half-hour gap draw as 2 polylines, and a single one would mean the gap was joined.
  await expect(chart.locator('polyline')).toHaveCount(2)

  // Coverage stated, and it excludes the hole: 30 + 30 minutes of morning span, plus 120 + 30 of
  // afternoon, is 3.5 h out of a nine-hour wall-clock reach.
  await expect(page.getByText('3.5 h measured')).toBeVisible()
})

test('no stress series draws no chart, rather than an empty frame', async ({ page }) => {
  await page.route('**/api/body-battery**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...BATTERY, stress: null }) }))

  await openBatteryCard(page)

  // Opened, and the expanded content is really there — so the absence below is the chart's, not the
  // card's. Asserting a missing element inside a section nobody opened proves nothing.
  await expect(page.getByText(/charged/).first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('img', { name: /Stress by time of day/ })).toHaveCount(0)
})
