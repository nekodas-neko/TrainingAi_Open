import { test, expect, type Page } from '@playwright/test'
import { STORAGE_STATE, settleRouteBoundary, tolerateTestEnd } from './fixtures'

/**
 * TN-45's pass test, verbatim: *"a `watch` day produces something the owner can see on Home, and a
 * normal day does not."*
 *
 * That is a browser question by construction. `watch` is the only illness band that has ever fired
 * and it carries **no readiness penalty**, so nothing on Home moved — the two real firings
 * (2026-09-16 score 41, 2026-08-27 score 57) reached the owner as silence. A source test can show
 * the branch exists; only a render shows the line is on the screen he opens.
 *
 * The overlay PATCHES the real readiness payload rather than replacing it — Home hands most of it
 * to the chip row and the Body Battery card — which means a real `route.fetch()`, and therefore
 * `tolerateTestEnd`: a request still in flight at teardown rejects outside any test and takes a
 * shard red with zero failed tests.
 */
test.use({
  storageState: STORAGE_STATE,
  serviceWorkers: 'block',
  viewport: { width: 412, height: 915 },
  colorScheme: 'dark',
  contextOptions: { reducedMotion: 'reduce' },
})
test.setTimeout(180_000)

const WATCH_LINE = 'Resting HR and HRV are drifting from your baseline — worth keeping an eye on.'

async function openHome(page: Page, over: Record<string, unknown>) {
  await page.route('**/api/readiness-score', tolerateTestEnd(async route => {
    const res = await route.fetch()
    const body = await res.json().catch(() => ({}))
    return route.fulfill({
      response: res,
      contentType: 'application/json',
      body: JSON.stringify({ ...body, ...over }),
    })
  }))
  await page.goto('/')
  await settleRouteBoundary(page)
}

test('⭐ a watch day puts the line on Home, under the score chips', async ({ page }) => {
  await openHome(page, {
    illnessFlag: 'watch', illnessAdvisory: WATCH_LINE, illnessSuppression: 0,
  })

  const line = page.getByText(WATCH_LINE)
  await expect(line).toBeVisible({ timeout: 120_000 })

  // Under the CHIPS, which is where the owner chose to have it rather than in a card of its own.
  // The readiness chip is the anchor: a line that rendered at the bottom of Home would pass a bare
  // visibility check and fail the entry.
  const chip = page.getByText(/Readiness/i).first()
  await expect(chip).toBeVisible()
  const c = (await chip.boundingBox())!
  const l = (await line.boundingBox())!
  expect(l.y).toBeGreaterThan(c.y)
  expect(l.y - (c.y + c.height)).toBeLessThan(200)

  // Quiet, not the bordered advisory: the line is not inside a card with a border.
  const boxed = await line.evaluate((el: HTMLElement) => {
    const p = el.closest('div');
    return p ? getComputedStyle(p).borderTopWidth : '0px'
  })
  expect(boxed).toBe('0px')
})

test('⛔ a normal day says nothing — the other half of the pass test', async ({ page }) => {
  await openHome(page, {
    illnessFlag: 'none', illnessAdvisory: null, illnessSuppression: 0,
  })

  // Home is up, so an absent line is an absent LINE rather than a failed load.
  await expect(page.getByText(/Readiness/i).first()).toBeVisible({ timeout: 120_000 })
  await expect(page.getByText(/drifting from your baseline/)).toHaveCount(0)
})

test('an elevated day still gets the bordered advisory, with its label and penalty', async ({ page }) => {
  // The tier that already worked. Asserted so the quiet branch cannot have swallowed it — the two
  // read differently on purpose, and `elevated` is the one that carries an instruction.
  await openHome(page, {
    illnessFlag: 'elevated', illnessSuppression: 6,
    illnessAdvisory: 'Signs your body may be fighting something (temperature, resting HR, HRV, breathing rate moving together) — readiness lowered.',
  })

  const advisory = page.getByRole('status').filter({ hasText: /readiness lowered/ }).first()
  await expect(advisory).toBeVisible({ timeout: 120_000 })
  await expect(advisory).toContainText('elevated')
  await expect(advisory).toContainText('readiness −6')
})
