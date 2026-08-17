import { test, expect } from '@playwright/test'
import { settleRouteBoundary, ZERO_DATA_STORAGE_STATE } from './fixtures'

/**
 * The first-run guards — Q-352, covering the two bugs the 2026-08-17 failure-cells sweep found and
 * that shipped unguarded because the harness could not reach a first-run state (Q-451, Q-452).
 *
 * Every other spec in this directory runs as the seeded user, who has a program, logs and metrics.
 * These run as the zero-data account created by `zero-data.setup.ts`.
 *
 * **Both directions are asserted.** An empty-state fix is only half-checked by proving it appears
 * when there is no data — the failure that costs you is hiding a card from someone who *has* data.
 * So each case here has a companion in `seeded-user-still-sees-content` below.
 *
 * **What that companion does and does not catch**, stated because the honest limit matters: it
 * fails if a gate hides the card from an account with data, which is the class of mistake worth
 * guarding. It does **not** distinguish between two gates that both work — putting the heart-rate
 * gate back to `data.hrMin != null || data.recentHrv != null` leaves it passing, because that gate
 * is also correct (`recentHrv` is 65 for the seeded user). An earlier note claimed that gate was
 * broken and that running it caught the difference; both claims were wrong, and the `card=0` reading
 * behind them was a cold-compile artifact of a 6-second wait.
 */

test.describe('zero-data account', () => {
  test.use({ storageState: ZERO_DATA_STORAGE_STATE })
  test.setTimeout(180_000)

  test('Q-451 — the Workout tab offers a way forward, not a dead Start button', async ({ page }) => {
    await page.goto('/workout-select')
    await settleRouteBoundary(page)

    await expect(page.getByText('No program yet')).toBeVisible({ timeout: 60_000 })
    // The bug in one assertion: the primary CTA used to be present, enabled, and inert.
    await expect(page.getByRole('button', { name: 'Start Workout' })).toHaveCount(0)

    const create = page.getByRole('button', { name: 'Create a program' })
    await expect(create).toBeVisible()
    await create.click()
    await expect(page).toHaveURL(/\/program/, { timeout: 30_000 })
  })

  test('Q-452 — no AI insight is even requested for a section with nothing in it', async ({ page }) => {
    // Asserts on the **request**, not on what renders, and that is the whole design of this test.
    // Measured: asserting "no AI Insight card is visible" passes with the gate deleted, because a
    // zero-data account produces no insight to render either way — a guard that cannot fail, which
    // is precisely the Q-259 trap. The gate's actual contract is "neither fetches nor renders", and
    // the fetch is the half that can be observed independently of the model's behaviour.
    const calls: string[] = []
    page.on('request', r => {
      if (r.method() === 'POST' && r.url().includes('/api/ai/health-insight')) calls.push(r.url())
    })

    for (const path of ['/health/readiness', '/health/sleep', '/health/activity', '/health/heart-rate']) {
      await page.goto(path)
      await settleRouteBoundary(page)
      await expect(page.getByText('AI Insight', { exact: true }), `${path} should show no insight`).toHaveCount(0)
    }
    // Give any late fetch a chance to fire before concluding none did.
    await page.waitForTimeout(3_000)
    expect(calls, 'a zero-data account must not reach the model at all').toEqual([])
  })
})

test('seeded user still sees content on every screen the first-run guards touch', async ({ page }) => {
  test.setTimeout(180_000)

  // Q-451's companion: an account WITH a program still gets the carousel and a live Start button.
  await page.goto('/workout-select')
  await settleRouteBoundary(page)
  await expect(page.getByText('No program yet')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Start (Workout|Again)/ })).toBeVisible({ timeout: 60_000 })

  // Q-452's companion: the gate must not hide the card from an account that HAS the data. The
  // `toPass` budget is load-bearing — a first visit to these routes pays a route and API compile on
  // the dev server, and a short fixed wait here reads a not-yet-loaded page as a hidden card. That
  // is not hypothetical: it is exactly the false reading that produced a wrong claim about the
  // heart-rate fields (see this file's header).
  for (const path of ['/health/readiness', '/health/sleep', '/health/activity', '/health/heart-rate']) {
    await page.goto(path)
    await settleRouteBoundary(page)
    // Either the insight rendered or the request failed — both prove the fetch was attempted, which
    // is what the gate controls. Asserting on the insight text alone would make this spec depend on
    // a live model call succeeding in CI.
    await expect(async () => {
      const shown = await page.getByText('AI Insight', { exact: true }).count()
      const failed = await page.getByText("Couldn't load the AI insight.").count()
      expect(shown + failed, `${path} should attempt an insight for an account with data`).toBeGreaterThan(0)
    }).toPass({ timeout: 30_000 })
  }
})
