import { test, expect } from '@playwright/test'
import { settleRouteBoundary } from './fixtures'
import { todayInTz, shiftDateStr } from '@trainingai/shared/date-utils'

/**
 * Issue 2093 (was RV-166's card spec) — the cardio hub's heart-health activity card, built to the
 * 10-05 mockup: the rule in moderate-effort minutes (floor moved from zone 2 by issue 2746), today's progress from what was actually done, and the
 * week's history naming each activity.
 *
 * The payload is injected rather than seeded. Whether the seed user has a running plan and heart
 * rate today is a fact about fixtures, and every assertion below would pass vacuously against a
 * hub with no card on it. The card itself is the real component reading the real payload shape.
 *
 * **Not checked here: the completion write.** It goes through the local store and the outbox,
 * neither of which exists in a browser; `completionsDue` and `linkPrescribedRun` are unit-tested.
 */
test.setTimeout(180_000)

const walk = { id: 'log-1', title: 'Treadmill walk', activityType: 'treadmill', durationMin: 34, effortMin: 22 }
const stroll = { id: 'log-0', title: 'Evening stroll', activityType: 'walk', durationMin: 41, effortMin: 6 }

function payload(today: string, earlier: string, over: { met?: boolean; status?: string } = {}) {
  const todayDay = {
    date: today, runId: 'run-1', status: over.status ?? 'pending', targetMin: 30,
    countedMin: over.met ? 31 : 22, met: over.met ?? false, outcome: over.met ? 'counted' : 'today',
    creditedId: 'log-1', activities: [{ ...walk, effortMin: over.met ? 31 : 22 }],
  }
  const days = [
    { date: earlier, runId: 'run-0', status: 'pending', targetMin: 30, countedMin: 6, met: false, outcome: 'not-counted', creditedId: 'log-0', activities: [stroll] },
    todayDay,
  ]
  return {
    plan: { id: 'plan-1', frameworkKey: 'base' },
    prescription: { type: 'easy', durationMin: 30 },
    run: {
      id: 'run-1', status: over.status ?? 'pending', runType: 'easy', durationMin: 30,
      targetHrLow: 138, targetHrHigh: 151, targetZoneIds: [2], activityLogId: null, completedAs: null,
    },
    heartHealth: { days },
  }
}

async function inject(page: import('@playwright/test').Page, over: { met?: boolean; status?: string } = {}) {
  // The seed user is on the default timezone, which is what the card picks today's row by.
  const today = todayInTz()
  await page.route(u => new URL(u).pathname === '/api/running-plan', async r => {
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload(today, shiftDateStr(today, -1), over)) })
  })
}

test('the card states the rule in moderate-effort minutes and today\'s progress from what was done', async ({ page }) => {
  await inject(page)
  await page.goto('/cardio')
  await settleRouteBoundary(page)

  const card = page.getByRole('region', { name: 'Heart-health activity' })
  await expect(card).toBeVisible()
  await expect(card.getByText('30 min at moderate effort or above')).toBeVisible()
  await expect(card.getByText('Moderate-effort minutes today')).toBeVisible()
  await expect(card.getByText('22 of 30')).toBeVisible()
  await expect(card.getByText('Treadmill walk')).toBeVisible()
  await expect(card.getByRole('button', { name: 'Start an activity' })).toBeVisible()

  // The history shows the activities, never the prescription's name.
  await expect(page.getByText('This week')).toBeVisible()
  await expect(page.getByText('Evening stroll · 41 min')).toBeVisible()
  await expect(page.getByText("Didn't count")).toBeVisible()
})

test('Start an activity offers every way to do it without leaving the hub', async ({ page }) => {
  await inject(page)
  await page.goto('/cardio')
  await settleRouteBoundary(page)

  const card = page.getByRole('region', { name: 'Heart-health activity' })
  await card.getByRole('button', { name: 'Start an activity' }).click()
  await expect(card.getByRole('button', { name: /Guided walk/ })).toBeVisible()
  for (const m of ['20 min', '30 min', '45 min']) await expect(card.getByRole('button', { name: m })).toBeVisible()
  await expect(card.getByRole('button', { name: /Something else/ })).toBeVisible()
  // The modality picker is NOT replaced by the card.
  await expect(page.getByText('What do you want to do?')).toBeVisible()
})

test('a day that met the rule reads Counted, with nothing left to start', async ({ page }) => {
  await inject(page, { met: true, status: 'completed' })
  await page.goto('/cardio')
  await settleRouteBoundary(page)

  const card = page.getByRole('region', { name: 'Heart-health activity' })
  await expect(card.getByText(/Counted ✓/)).toBeVisible()
  await expect(card.getByRole('button', { name: 'Start an activity' })).toHaveCount(0)
})
