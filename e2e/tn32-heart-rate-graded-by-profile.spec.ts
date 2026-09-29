import { test, expect } from '@playwright/test'
import { settleRouteBoundary } from './fixtures'

/**
 * TN-32 — the Heart Rate page grades against the user's own zones.
 *
 * It used to grade with fixed cuts (`<60` Resting, `<100` Normal, else Elevated) and paint the
 * 60–100 band `#f87171` — a red the zone palette uses for nothing in that range. With a resting HR
 * of 52 and a max of 185, Zone 1 runs to about 132 bpm, so a sitting-still reading was alarmed.
 *
 * Both the profile and the reading are injected: the seeded user's live HR is a fact about
 * fixtures, and the hero renders an em-dash with no grade when there is none — against which every
 * assertion here would pass vacuously.
 */
test.setTimeout(180_000)

const PROFILE = { maxHr: 185, restingHr: 52 }

// Built from the REAL response so only `hrCurrent` is guaranteed — the shape
// `rv72-progress-bars-composite` uses. A thin `{ hrCurrent }` body was tried first and crashed the
// page: its cards dereference fields the readiness payload normally carries, and the hero rendered
// nothing at all while `/api/client-error` fired.
async function stubReadiness(page: import('@playwright/test').Page, bpm: number | null) {
  await page.route(u => new URL(u).pathname === '/api/readiness-score', async r => {
    const real = await r.fetch()
    const body = await real.json().catch(() => ({}))
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...body, hrCurrent: bpm }) })
  })
}

// Overlaid for the same reason as the readiness stub, and it bit harder here: `/api/hr-profile`
// carries an `observed` profile that `ObservedHrCard` — already on this page — dereferences, so a
// thin `{ maxHr, restingHr }` body took the whole screen to "Something went wrong". Only the two
// anchors the grading reads are pinned.
async function stub(page: import('@playwright/test').Page, bpm: number | null) {
  await page.route(u => new URL(u).pathname === '/api/hr-profile', async r => {
    const real = await r.fetch()
    const body = await real.json().catch(() => ({}))
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...body, ...PROFILE }) })
  })
  await stubReadiness(page, bpm)
}

/** The hero's grade badge. "Recovery" also appears in the HRV copy further down the page. */
const grade = (page: import('@playwright/test').Page, label: string) =>
  page.getByText(label, { exact: true })

test('a rate inside the user’s own Zone 1 reads as Recovery, not an alarm', async ({ page }) => {
  await stub(page, 78)
  await page.goto('/health/heart-rate')
  await settleRouteBoundary(page)

  // The grade is what this entry is about; the number itself renders twice (hero and the Current
  // stat) and races a cached readiness seed, so asserting it adds nothing and flakes.
  await expect(grade(page, 'Recovery')).toBeVisible()
  // The old cuts called this "Normal" and painted it red.
  await expect(grade(page, 'Normal')).toHaveCount(0)

  const colour = await grade(page, 'Recovery').evaluate(el => getComputedStyle(el).color)
  expect(colour, 'the alarm red the zone palette uses for nothing in this range')
    .not.toBe('rgb(248, 113, 113)')
})

test('a genuinely high rate is still graded from the user’s own bands', async ({ page }) => {
  await stub(page, 175)
  await page.goto('/health/heart-rate')
  await settleRouteBoundary(page)
  await expect(grade(page, 'Peak')).toBeVisible()
})

test('with no profile there is no grade, rather than an invented one', async ({ page }) => {
  await page.route(u => new URL(u).pathname === '/api/hr-profile', async r => {
    await r.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
  })
  await stubReadiness(page, 78)
  await page.goto('/health/heart-rate')
  await settleRouteBoundary(page)

  // A positive anchor first: absence assertions alone would pass against a page that failed to
  // render at all, which is the vacuous shape this file's docstring warns about.
  await expect(page.getByRole('heading', { name: 'Heart Rate' }).first()).toBeVisible()
  for (const label of ['Recovery', 'Resting', 'Normal', 'Elevated']) {
    await expect(grade(page, label)).toHaveCount(0)
  }
})
