import { test, expect } from '@playwright/test'
import { visitTwice, expectNoSkeleton } from './fixtures'

/**
 * Q-249, spec 1 — the instant-paint rule, made executable.
 *
 * CLAUDE.md: "Every screen/widget that fetches data seeds synchronously from cache and revalidates
 * in the background. First paint shows last-known data, not a spinner." Four separate sessions
 * (147, 155, 165, 167) retrofitted cache-seeding onto screens that shipped with load skeletons,
 * because nothing could see the difference. This can.
 *
 * Each tab is visited twice: the first visit fills the caches, the second is the one the rule is
 * about. A skeleton on that second paint is the bug.
 */
const TABS = [
  { name: 'Home', href: '/' },
  { name: 'Health', href: '/health' },
  { name: 'Workout', href: '/workout' },
  { name: 'Nutrition', href: '/nutrition' },
  { name: 'More', href: '/more' },
]

/**
 * Routes that answer 5xx in CI for a configured reason rather than a broken one.
 *
 * **Empty since RV-201, and deliberately kept as a list.** It held `/api/weekly-digest`, which
 * returned 502 by design whenever its model call failed — which was always here, because the E2E
 * job sets no `GOOGLE_GENERATIVE_AI_API_KEY`. That surfaced as a coin flip rather than a hard
 * failure, the worst shape to leave it in: the assertion runs as soon as the tab bar is visible
 * and no skeleton is showing, so whether the request had come back yet was a race, and two runs
 * eleven minutes apart on identical code went one each way.
 *
 * The route no longer calls a model, so it answers 200 here like any other — meaning Home's recap
 * request is now actually covered by this assertion instead of excused from it. The list stays
 * because the next route to need an exemption should have to name itself: "ignore 502" would hide
 * a real one.
 */
const EXPECTED_5XX: string[] = []

test.describe('the five tabs paint without a skeleton on a repeat visit', () => {
  for (const tab of TABS) {
    test(`${tab.name} (${tab.href})`, async ({ page }) => {
      const failures: string[] = []
      // A screen that 500s or throws still "paints", so watch the console and the network too —
      // otherwise a broken tab passes an is-there-a-skeleton check by being broken quietly.
      page.on('pageerror', e => failures.push(`pageerror: ${e.message}`))
      page.on('response', r => {
        if (!r.url().includes('/api/') || r.status() < 500) return
        if (EXPECTED_5XX.some(path => r.url().includes(path))) return
        failures.push(`${r.status()} ${r.url()}`)
      })

      await visitTwice(page, tab.href)

      // The tab bar is the app shell — if it is not here, the route did not render at all.
      await expect(page.getByRole('link', { name: tab.name })).toBeVisible()
      await expectNoSkeleton(page)
      expect(failures, `errors while loading ${tab.href}`).toEqual([])
    })
  }
})
