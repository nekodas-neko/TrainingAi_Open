import { test, expect } from '@playwright/test'
import { settleRouteBoundary } from './fixtures'

/**
 * LB-117 — the explain page distinguishes a sore tick the app suggested from one the lifter chose.
 *
 * After BF-173 an accepted suggestion is listed as sore and does NOT lower the score, so a single
 * "Sore muscles" line could show a muscle beside a recovery figure that ignored it. Q-105's rule is
 * that this page shows the numbers the recommendation was actually computed from.
 *
 * The recommendation is injected: whether the seeded user has an ai_dynamic program with a scored
 * session AND a sore tick today is a fact about fixtures, and `buildSessionExplainData` returns null
 * without one — so every assertion would pass vacuously against a page that renders its empty state.
 *
 * The signals area is collapsed by default (it is the demoted "the numbers" section), so each test
 * opens it first. **Which muscle sits under which chip is asserted in the unit tests** — the job
 * here is to prove the split rows reach the screen at all, rather than to re-check the pairing
 * through the DOM, where the value and its chip share one span.
 */
test.setTimeout(180_000)

const REC = {
  scoredSessions: [
    { session: { id: 's1', name: 'Upper' }, overallScore: 72, recoveryScore: 70, balanceScore: 74, freshnessScore: 71 },
    { session: { id: 's2', name: 'Lower' }, overallScore: 61, recoveryScore: 55, balanceScore: 66, freshnessScore: 63 },
  ],
  weightedComponents: {
    recovery: { score: 70, weight: 0.5 },
    balance: { score: 74, weight: 0.3 },
    freshness: { score: 71, weight: 0.2 },
  },
  signals: {
    muscleRecovery: [{ muscle: 'chest', pct: 80, hoursAgo: 40 }],
    ouraReadiness: 74,
    sleepTrend: 1.0,
    hrvTrend: 1.0,
    energyLevel: 'ok',
    soreMuscles: ['chest', 'quads'],
    suggestedSoreMuscles: ['quads'],
  },
  consecutiveTrainingDays: 1,
}

test('a suggested tick reads as already counted, a chosen one as having lowered the score', async ({ page }) => {
  await page.route(u => new URL(u).pathname === '/api/next-session', async r => {
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(REC) })
  })
  await page.goto('/session-explain?sessionId=s1')
  await settleRouteBoundary(page)

  await page.getByText('The signals behind this').click()

  await expect(page.getByText('Sore muscles')).toBeVisible()
  await expect(page.getByText('lowered the score')).toBeVisible()
  // "Also sore" exists only when the two populations were actually separated.
  await expect(page.getByText('Also sore')).toBeVisible()
  await expect(page.getByText('already counted')).toBeVisible()
})

test('a check-in with no recorded provenance keeps the single unchipped line', async ({ page }) => {
  await page.route(u => new URL(u).pathname === '/api/next-session', async r => {
    const body = { ...REC, signals: { ...REC.signals, suggestedSoreMuscles: null } }
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
  await page.goto('/session-explain?sessionId=s1')
  await settleRouteBoundary(page)

  await page.getByText('The signals behind this').click()

  await expect(page.getByText('chest, quads')).toBeVisible()
  await expect(page.getByText('Also sore')).toHaveCount(0)
  // Reading null as "none were suggestions" would claim both ticks cost the score.
  await expect(page.getByText('lowered the score')).toHaveCount(0)
  await expect(page.getByText('already counted')).toHaveCount(0)
})
