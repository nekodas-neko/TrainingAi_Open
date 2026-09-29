import { test, expect } from '@playwright/test'
import { settleRouteBoundary } from './fixtures'

/**
 * RV-166 — the cardio hub states what today's prescription needs, and offers both ways to meet it.
 *
 * The prescription is injected rather than seeded. Whether the seed user has a running plan today
 * is a fact about fixtures, and every assertion below would pass vacuously against a hub with no
 * card on it — which is exactly the state this change is fixing, so it must not be the state the
 * test accepts. The card itself is the real component reading the real payload shape.
 *
 * **Not checked here: the completion.** Satisfying the prescription writes through the local store
 * and the outbox, neither of which exists in a browser — `getLocalStore` returns null in the web
 * sandbox. The payload contract is unit-tested instead (`rv166-link-prescribed-run.test.ts`), and
 * the device half is owed.
 */
test.setTimeout(180_000)

const PRESCRIPTION = {
  plan: { id: 'plan-1', frameworkKey: 'base' },
  prescription: { type: 'easy', durationMin: 25 },
  run: {
    id: 'run-1',
    status: 'pending',
    runType: 'easy',
    durationMin: 25,
    targetHrLow: 107,
    targetHrHigh: 134,
    targetZoneIds: [2],
    activityLogId: null,
    completedAs: null,
  },
}

test.beforeEach(async ({ page }) => {
  await page.route(u => new URL(u).pathname === '/api/running-plan', async r => {
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PRESCRIPTION) })
  })
})

test('the card states the criterion in zone terms and both ways to meet it', async ({ page }) => {
  await page.goto('/cardio')
  await settleRouteBoundary(page)

  // Scoped to the card's own landmark: the hub already carries a "Guided walk" button and a
  // "What do you want to do?" heading, both of which match these names loosely.
  const card = page.getByRole('region', { name: "Today's cardio" })
  await expect(card).toBeVisible()

  // The whole point of the change: an opaque done/not-done becomes a stated criterion.
  await expect(card.getByText('25 min in Zone 2')).toBeVisible()
  await expect(card.getByText(/107–134 bpm · a run or a walk both count/)).toBeVisible()
  await expect(card.getByText('To do', { exact: true })).toBeVisible()

  await expect(card.getByRole('button', { name: 'Run it' })).toBeVisible()
  await expect(card.getByRole('button', { name: 'Walk it' })).toBeVisible()
})

test('Walk it offers the guided walk and treadmill presets without leaving the hub', async ({ page }) => {
  await page.goto('/cardio')
  await settleRouteBoundary(page)

  const card = page.getByRole('region', { name: "Today's cardio" })
  await card.getByRole('button', { name: 'Walk it' }).click()

  await expect(card.getByText('How are you walking?')).toBeVisible()
  await expect(card.getByRole('button', { name: /Guided walk/ })).toBeVisible()
  // Two taps for the common case — the presets are the second tap.
  for (const m of ['20 min', '30 min', '45 min']) {
    await expect(card.getByRole('button', { name: m })).toBeVisible()
  }
  // The modality picker is NOT replaced by the card; losing it was the first mockup's mistake.
  await expect(page.getByText('What do you want to do?')).toBeVisible()
})

test('the prescription reads Done, as a walk, once it is satisfied', async ({ page }) => {
  await page.route(u => new URL(u).pathname === '/api/running-plan', async r => {
    await r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...PRESCRIPTION,
        run: { ...PRESCRIPTION.run, status: 'completed', completedAs: 'walk', activityLogId: 'log-1' },
      }),
    })
  })
  await page.goto('/cardio')
  await settleRouteBoundary(page)

  const card = page.getByRole('region', { name: "Today's cardio" })
  await expect(card.getByText('Done', { exact: true })).toBeVisible()
  await expect(card.getByText(/Completed as a walk/)).toBeVisible()
  // Nothing left to start once the day is satisfied.
  await expect(card.getByRole('button', { name: 'Walk it' })).toHaveCount(0)
})
