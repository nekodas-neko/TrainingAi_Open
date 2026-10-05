import { test, expect } from '@playwright/test'
import { formatDayShort } from '@trainingai/shared/date-utils'
import { tolerateTestEnd } from './fixtures'

/**
 * RV-202 ③ — the pre-workout list must say when its numbers are not today's.
 *
 * The screen has three paint sources (its own cache, Home's card prefetch, the on-device program
 * mirror) and only one of them is today's answer. Offline, or while a seed paints ahead of
 * revalidation, it presented a previous day's numbers under a heading reading "Recommended
 * workout" with nothing distinguishing them. The global offline pill is a different fact: it says
 * the connection is down, not which day is on screen, and this also happens online.
 *
 * **Why the payload is aged through the route rather than through the cache.** Three earlier
 * attempts seeded `sessionStorage` and could not hold the state: `readCacheSync` prefers
 * sessionStorage but `cachedFetch` reads its own `localStorage` copy and calls `onData` with it,
 * so ageing one left the other to clear the label with today's date — and a `route.abort()` on
 * `/api/workout-data` did not prevent a fresh payload arriving either. Serving an aged payload
 * puts the component in exactly the same state (`numbersSource` = a cached day) by the one route
 * the harness can hold steady.
 *
 * `serviceWorkers: 'block'` is required: the SW's `/api/` branch answers before Playwright's
 * router sees the request.
 *
 * The aged date is DERIVED from the seeded user's zone, not written down: the app compares
 * `dataDate` against its own `todayInTz`, so a literal would stop being yesterday and start being
 * an arbitrary past day — and then a whole month later, still pass for the wrong reason
 * (`check-e2e-stub-dates`, LA-107). The expected label comes from the app's own `formatDayShort`
 * for the same reason: a hand-written `26 Sept` would pin this spec to one month's abbreviation.
 */
test.use({ viewport: { width: 412, height: 915 }, colorScheme: 'dark', serviceWorkers: 'block' })
test.setTimeout(240_000)

const brisbane = (d: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Brisbane' }).format(d)
const YESTERDAY = brisbane(new Date(Date.now() - 24 * 60 * 60 * 1000))

test('a payload from an earlier day is labelled with that day', async ({ page }) => {
  let body: string | null = null
  await page.route('**/api/workout-data**', tolerateTestEnd(async route => {
    const res = await route.fetch()
    const json = await res.json()
    if (json?.exercises?.length) {
      if (body === null) body = JSON.stringify(json)
      const aged = JSON.parse(body)
      aged.dataDate = YESTERDAY
      return route.fulfill({ json: aged })
    }
    return route.fulfill({ response: res })
  }))

  // The card's Start Workout only navigates; the pre-workout screen's own button begins a
  // workout, so this stops one step short of that.
  await page.goto('/workout')
  const card = page.getByRole('button', { name: 'Start Workout' })
  await card.waitFor({ timeout: 120_000 })
  await card.click()
  await page.waitForURL(/[?&]session=/, { timeout: 60_000 })

  await expect(page.getByText('Recommended workout')).toBeVisible({ timeout: 60_000 })
  const label = page.getByText(`From ${formatDayShort(YESTERDAY)}`, { exact: true })
  await expect(label).toBeVisible({ timeout: 30_000 })

  // It must read as an aside to the heading, not wrap onto its own line at the S25 width —
  // the whole value is that the two dates are comparable at a glance.
  const heading = page.getByText('Recommended workout')
  const [h, l] = [await heading.boundingBox(), await label.boundingBox()]
  expect(h, 'heading has no box').not.toBeNull()
  expect(l, 'label has no box').not.toBeNull()
  expect(Math.abs((h!.y + h!.height / 2) - (l!.y + l!.height / 2)),
    'the label wrapped below the heading').toBeLessThan(h!.height)
})
