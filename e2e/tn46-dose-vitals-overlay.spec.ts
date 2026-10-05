import { test, expect } from '@playwright/test'
import { settleRouteBoundary } from './fixtures'

/**
 * TN-46 — the dose/vitals overlay on the Readiness screen.
 *
 * The payload is injected. Whether the seed user has a vial-dosed log in the last 60 days is a fact
 * about fixtures, and the card renders itself away when there is none — so every assertion here
 * would pass vacuously against the very absence this change is filling.
 *
 * **Not checked here: the correlation itself.** The card annotates and never corrects; nothing it
 * draws feeds a score, and the lag rule it depends on is unit-tested in
 * `components/health/__tests__/tn46-dose-vitals-series.test.ts`.
 */
test.setTimeout(180_000)

// Every date derives from the seeded user's today. A literal here is a time bomb: the route's
// window is 60 days back from the REAL clock, so a pinned fixture drops out of it and the card
// stops rendering on a date nobody picked.
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Brisbane' }).format(new Date())
const daysAgo = (n: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Brisbane' })
    .format(new Date(Date.parse(`${TODAY}T12:00:00Z`) - n * 86_400_000))

function nights(n: number) {
  const out = []
  for (let i = n; i >= 1; i--) {
    out.push({ date: daysAgo(i), restingHr: 52 + (i % 4), hrvMs: 40 - (i % 5), restingHrBaseline: 53, hrvBaseline: 40 })
  }
  return out
}

const PAYLOAD = {
  from: daysAgo(59), to: TODAY, effectLookbackDays: 5,
  doses: [
    { supplementName: 'Testosterone', date: daysAgo(9), amount: 0.4, unit: 'mL' },
    { supplementName: 'Testosterone', date: daysAgo(16), amount: 0.4, unit: 'mL' },
  ],
  nights: nights(30),
}

test.beforeEach(async ({ page }) => {
  await page.route(u => new URL(u).pathname === '/api/health/dose-vitals', async r => {
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PAYLOAD) })
  })
})

test('the overlay draws, names the lag, and switches metric', async ({ page }) => {
  await page.goto('/health/readiness')
  await settleRouteBoundary(page)

  // Scoped to the card's landmark: the Readiness screen carries its own "HRV" control.
  const card = page.getByRole('region', { name: 'Doses against vitals' })
  await expect(card).toBeVisible()
  // The lag rule is the point of the card — it must be stated, not implied by the drawing.
  await expect(card.getByText(/peak 2–4 days later/)).toBeVisible()
  await expect(card.getByText(/Testosterone · 0.4 mL/).first()).toBeVisible()

  const rhr = card.getByRole('button', { name: 'Resting HR' })
  const hrv = card.getByRole('button', { name: 'HRV' })
  await expect(rhr).toHaveAttribute('aria-pressed', 'true')
  await hrv.click()
  await expect(hrv).toHaveAttribute('aria-pressed', 'true')
  await expect(rhr).toHaveAttribute('aria-pressed', 'false')
})

test('the card is absent when no dose falls in the window', async ({ page }) => {
  await page.route(u => new URL(u).pathname === '/api/health/dose-vitals', async r => {
    await r.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ...PAYLOAD, doses: [] }),
    })
  })
  await page.goto('/health/readiness')
  await settleRouteBoundary(page)

  // Most days there is nothing to annotate, and a card saying so is noise on a daily screen.
  await expect(page.getByRole('region', { name: 'Doses against vitals' })).toHaveCount(0)
})
