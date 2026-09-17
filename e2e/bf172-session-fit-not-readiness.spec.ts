import { test, expect } from '@playwright/test'
import { settleRouteBoundary, suppressMorningCheckin } from './fixtures'

/**
 * BF-172 — the explain screen called the session-FIT score "readiness".
 *
 * `overallScore` is `recovery·w + balance·w + freshness·w`: how well this session fits today, not a
 * measurement of the lifter. The ring printed it as *"Overall readiness for this session"* and ran it
 * through `scoreBand`, so the owner's screenshot reads **84 HIGH** in green directly above *Oura
 * readiness 37 · Low* and *strong deload advised*.
 *
 * The stub below is that screenshot: a high fit score over deliberately awful recovery signals. It
 * proves the CAPTION and the BAND WORD, which is the whole defect — the arithmetic is correct and
 * untouched.
 */
const REC = {
  isRestDay: false,
  reason: 'stub',
  session: { id: 'fit-a', name: 'Pull', position: 0, icon: null, exercises: [] },
  consecutiveTrainingDays: 2,
  deloadOrRestRecommended: true,
  deloadStrength: 'strong',
  hrvWarning: true,
  weightedComponents: {
    recovery: { score: 80, weight: 0.5 },
    balance: { score: 85, weight: 0.3 },
    freshness: { score: 90, weight: 0.2 },
  },
  scoredSessions: [
    { session: { id: 'fit-a', name: 'Pull', position: 0, icon: null, exercises: [] }, overallScore: 84, recoveryScore: 80, balanceScore: 85, freshnessScore: 90 },
    { session: { id: 'fit-b', name: 'Push', position: 1, icon: null, exercises: [] }, overallScore: 64, recoveryScore: 50, balanceScore: 55, freshnessScore: 88 },
  ],
  // The contradiction: the lifter is in poor shape while this session still fits best.
  signals: {
    muscleRecovery: [{ muscle: 'lats', pct: 0.9, hoursAgo: 60 }],
    ouraReadiness: 37, sleepTrend: 0.8, hrvTrend: 0.7,
    energyLevel: 'drained', soreMuscles: ['chest'],
  },
}

test('the ring calls 84 a fit, not readiness, while readiness reads 37', async ({ page }) => {
  await page.route(u => new URL(u).pathname === '/api/next-session', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(REC) }))
  await suppressMorningCheckin(page)

  await page.goto('/session-explain?sessionId=fit-a')
  await settleRouteBoundary(page)

  await expect(page.getByText('84', { exact: true })).toBeVisible({ timeout: 30_000 })

  // The caption names the quantity the number actually is.
  await expect(page.getByText('How well this session fits today')).toBeVisible()
  await expect(page.getByText(/Overall readiness for this session/)).toHaveCount(0)

  // The band word is fit vocabulary — and it is still PRESENT, because the ring and the number are
  // band-coloured and dropping it would leave the band carried by colour alone.
  await expect(page.getByText('Strong fit')).toBeVisible()
  await expect(page.getByText('HIGH', { exact: true })).toHaveCount(0)
})
