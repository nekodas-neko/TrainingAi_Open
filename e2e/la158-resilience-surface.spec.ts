import { test, expect, type Page } from '@playwright/test'
import { shiftDateStr, todayInTz } from '@trainingai/shared/date-utils'
import { STORAGE_STATE, settleRouteBoundary, tolerateTestEnd } from './fixtures'

/**
 * LA-158 in a browser — the entry is about what the screen SAYS, so a source test cannot close it.
 *
 * The engine half shipped `ownResilienceAsOf` and `ownResilienceUnavailable`; the surface rendered
 * neither, and gated the whole tile on `ownResilienceLevel != null`. Two live defects behind that:
 * on 2026-09-27 the tile showed **09-22's level as if it were today's**, with no date, and it would
 * have gone silently blank once 09-22 left the payload's 7-day window.
 *
 * **The overlay PATCHES the real response rather than replacing it.** `ReadinessScoreResponse` is a
 * large payload and `readiness-content.tsx` hands most of it to `breakdown`/`contributors`
 * callbacks, so a hand-built body would break the page for reasons that have nothing to do with
 * this entry. Fetching the real one and overriding five fields keeps every other number authentic.
 *
 * `tolerateTestEnd` because the handler does a real `route.fetch()` — a request still in flight
 * when the test ends rejects OUTSIDE any test, which takes a shard red with zero failed tests.
 * `scripts/check-e2e-route-tolerance.js` refuses the unwrapped form.
 */
test.use({
  storageState: STORAGE_STATE,
  serviceWorkers: 'block',
  viewport: { width: 412, height: 915 },
  colorScheme: 'dark',
  contextOptions: { reducedMotion: 'reduce' },
})
test.setTimeout(180_000)

const TZ = 'Australia/Brisbane'

async function withResilience(page: Page, over: Record<string, unknown>) {
  await page.route('**/api/readiness-score', tolerateTestEnd(async route => {
    const res = await route.fetch()
    const body = await res.json().catch(() => ({}))
    return route.fulfill({
      response: res,
      contentType: 'application/json',
      body: JSON.stringify({ ...body, ...over }),
    })
  }))
  await page.goto('/health/readiness')
  await settleRouteBoundary(page)
}

const LEVEL = { ownResilienceLevel: 3.2, ownResilienceBand: 'adequate', ownResilienceConfidence: 1 }
const COVERAGE = {
  daysSeen: 7, daysMeetingCoverageGate: 2,
  coverageGateMinutes: 240, minValidDays: 5, modelWindowDays: 14,
}

test('a level from today shows the band and no date line', async ({ page }) => {
  await withResilience(page, {
    ...LEVEL, ownResilienceAsOf: todayInTz(TZ), ownResilienceUnavailable: null,
  })

  const tile = page.getByText('Resilience').first()
  await expect(tile).toBeVisible({ timeout: 120_000 })
  await expect(page.getByText(/Adequate \(3\.2\)/)).toBeVisible()
  // The absence that matters: a permanent date beside a current number is furniture, and it is
  // what would make the stale case below unreadable.
  await expect(page.getByText(/not today/)).toHaveCount(0)
})

test('⭐ a level from five days ago names its day — the defect this entry was filed on', async ({ page }) => {
  const asOf = shiftDateStr(todayInTz(TZ), -5)
  await withResilience(page, { ...LEVEL, ownResilienceAsOf: asOf, ownResilienceUnavailable: null })

  await expect(page.getByText('Resilience').first()).toBeVisible({ timeout: 120_000 })
  await expect(page.getByText(/Adequate \(3\.2\)/)).toBeVisible()
  // Derived from the clock, so the assertion is on the SHAPE rather than a date that would rot.
  await expect(page.getByText(/^From \d{1,2} \w+, not today\.$/)).toBeVisible()
})

test('⭐ no level states what was observed instead of rendering nothing', async ({ page }) => {
  await withResilience(page, {
    ownResilienceLevel: null, ownResilienceBand: null, ownResilienceConfidence: null,
    ownResilienceAsOf: null, ownResilienceUnavailable: COVERAGE,
  })

  await expect(page.getByText('Resilience').first()).toBeVisible({ timeout: 120_000 })
  await expect(page.getByText(/Not published yet/)).toBeVisible()
  const sentence = page.getByText(
    '2 of the last 7 days had enough daytime coverage; the model needs 5 of 14.',
  )
  await expect(sentence).toBeVisible()

  // It is the longest line this tile can carry and it WRAPS by design — a `block` span at
  // `leading-snug`. What would be a defect is overflowing the card it sits in, so that is what is
  // measured: the text stays inside the tile's own box at 412 px, and the tile inside the viewport.
  const tile = page.locator('div.rounded-xl').filter({ hasText: 'Not published yet' }).last()
  const t = (await tile.boundingBox())!
  const s = (await sentence.boundingBox())!
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ tile: t, sentence: s }))
  expect(s.x).toBeGreaterThanOrEqual(t.x)
  expect(s.x + s.width).toBeLessThanOrEqual(t.x + t.width + 1)
  expect(t.x + t.width).toBeLessThanOrEqual(412)
  // Wrapped rather than clipped: three short lines at 12 px is taller than one.
  expect(s.height).toBeGreaterThan(20)
})

test('⛔ and a payload from before these fields existed still renders no tile', async ({ page }) => {
  // Absent data is not a state worth a sentence. This is the case that must NOT grow a tile, or
  // every reader on an old cached payload gets a line about nothing.
  await withResilience(page, {
    ownResilienceLevel: null, ownResilienceBand: null, ownResilienceConfidence: null,
    ownResilienceAsOf: null, ownResilienceUnavailable: null,
  })

  // The page itself is up — so a missing tile is a missing TILE, not a failed load.
  await expect(page.getByRole('heading', { name: /Readiness/i }).first())
    .toBeVisible({ timeout: 120_000 })
  await expect(page.getByText('Resilience')).toHaveCount(0)
})
