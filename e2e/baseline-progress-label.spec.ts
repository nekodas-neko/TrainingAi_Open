import { test, expect } from '@playwright/test'
import { settleRouteBoundary } from './fixtures'

/**
 * LA-92 — the baseline card says how much of the baseline is done.
 *
 * It read *"Baseline needed"* identically after zero baseline sessions and after four of five
 * exercises, which is why BF-131 could not be reported: the owner could only say *"even though the
 * session was done it's saying baseline needed"*, because the screen had no other words.
 *
 * **Only the periodization state is stubbed, and the exercise list comes from the real program.**
 * An earlier draft also stubbed `workout-data?tab=meta` with a thin fixture and took the whole Health
 * screen down with `Cannot read properties of undefined (reading 'toLowerCase')` — that key is shared
 * with several other cards, so a partial payload breaks all of them. Reading the real one and
 * anchoring the fixture to real session-exercise ids keeps every other card honest.
 */
test.use({ serviceWorkers: 'block' })

test('a partly-done baseline says how far along it is', async ({ page }) => {
  const meta = await page.request.get('/api/workout-data?tab=meta').then(r => r.json())
  const session = (meta?.program?.sessions ?? []).find((s: { exercises?: unknown[] }) => (s.exercises?.length ?? 0) >= 2)
  test.skip(!session, 'the seeded program has no session with two or more exercises')

  const exerciseIds: string[] = session.exercises.map((e: { id: string }) => e.id)
  // Anchor all but the last, so the count is provably partial rather than complete.
  const anchored = exerciseIds.slice(0, -1)
  const baseline1rm: Record<string, unknown> = Object.fromEntries(anchored.map(id => [id, { kg: 100, source: 'amrap' }]))
  // Plus an anchor for an exercise no longer in the session, which must NOT be counted — without
  // that intersection a program edit can render "6 of 5".
  baseline1rm['00000000-0000-4000-8000-000000000000'] = { kg: 1, source: 'estimate' }

  await page.route('**/api/ai-periodization/program-overview', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      sessions: [{
        sessionId: session.id,
        sessionName: session.name ?? 'Session',
        icon: session.icon ?? null,
        lastTrainedDaysAgo: 1,
        state: { phase: 'baseline', baselineComplete: false, sessionsInPhase: 1, baseline1rm },
      }],
    }),
  }))

  await page.goto('/health')
  await settleRouteBoundary(page)

  // Synthetic input does not reach some of this app's controls (LB-68); the DOM click does.
  await page.getByRole('tab', { name: 'Training' }).evaluate((el: HTMLElement) => el.click())

  const expected = `${anchored.length} of ${exerciseIds.length} exercise${exerciseIds.length === 1 ? '' : 's'} logged`
  await expect(page.getByText(expected)).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText('Baseline needed')).toHaveCount(0)
})
