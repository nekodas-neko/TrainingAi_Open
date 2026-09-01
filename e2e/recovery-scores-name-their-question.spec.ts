import { test, expect } from '@playwright/test'
import { settleRouteBoundary } from './fixtures'

/**
 * Q-276 — Readiness and Body Battery are two different questions, and each now says which.
 *
 * Measured over 31 post-re-key days, the two correlate at **r = +0.12** by end of day while sitting
 * one directly above the other on Home. The owner settled what they mean rather than which is wrong:
 * *"Body battery should be more like 'how much energy I have left'. Readiness should just be a
 * starting number based on your previous day + sleep."* That makes it a presentation contract, and
 * the failure was that neither surface stated its question where anyone would read it — Body
 * Battery's explainer only renders in the **no-data** state, so on an ordinary day nobody ever sees
 * it.
 *
 * **Mutation-checked**: deleting either line fails its own assertion.
 */

// Both cases stub an /api route, and the service worker re-issues those out of Playwright's reach.
test.use({ serviceWorkers: 'block' })

test.setTimeout(180_000)

/** A battery with real data — the state whose framing was missing. */
const BATTERY = {
  current: 62, label: 'Good', trend: 'draining', anchor: 78, anchorSource: 'readiness',
  anchorProvisional: false, charged: 4, drained: 20, wakeTime: Date.now() - 6 * 3600_000,
  series: Array.from({ length: 12 }, (_, i) => ({ t: Date.now() - (11 - i) * 1800_000, v: 78 - i * 1.5 })),
  hasData: true,
  confidence: { level: 'high', sampleCount: 420, samplesPerHour: 70, wakingMinutes: 360 },
  hrMax: { value: 190, source: 'estimated', observedPeak: null, peakDays: 0 },
  stress: null,
}

test('Body Battery states its question on an ordinary day, not only when it has no data', async ({ page }) => {
  await page.route('**/api/body-battery**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BATTERY) }))

  // `/`, not `/session-select`: the score chips and the battery card render on the Home tab, and
  // the Workout tab shares the same component without them. Q-276 is about the two sitting one
  // above the other, which only happens here.
  await page.goto('/')
  await settleRouteBoundary(page)

  // The card is collapsed, and this must be readable without tapping it — the old explainer was one
  // tap away AND gated on there being no data, which is two reasons nobody read it.
  await expect(page.getByText(/Energy left right now/)).toBeVisible()
})

test('Readiness states the question it answers, and that it is not the other one', async ({ page }) => {
  await page.goto('/health/readiness')
  await settleRouteBoundary(page)

  const line = page.getByText(/How your day is likely to go/)
  await expect(line).toBeVisible()
  // The distinguishing half. "A morning number" alone would not stop a reader taking it for the
  // live one; saying what it is *not* is the part that does.
  await expect(page.getByText(/does not move as you use energy/)).toBeVisible()
})
