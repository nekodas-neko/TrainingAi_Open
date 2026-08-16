import { test, expect } from '@playwright/test'
import { visitTwice, expectNoSkeleton } from './fixtures'

/**
 * Q-297, closing Q-249's largest measured blind spot.
 *
 * `tabs-instant-paint.spec.ts` opens `/health` and checks the viewport. Health mounts **all three**
 * of its tabs at once inside a `SwipeCarousel`, so only the default (Training) panel is ever in
 * view — the Body and Progress panels are in the DOM, off-screen, and deliberately not asserted on
 * (their data is fetched when you swipe to them, by design). The cost was measured, not guessed:
 * forcing Health's Body-tile skeletons to never clear did **not** fail that spec.
 *
 * `health-content.tsx` reads `?tab=` on mount and in an effect, so driving the tab by URL puts the
 * panel under test in the viewport and makes the same assertion mean something for it.
 *
 * Each tab is visited twice for the same reason as spec 1: the first visit fills the caches, the
 * second is the one the instant-paint rule is about.
 */
const HEALTH_TABS = [
  { name: 'Training', href: '/health?tab=training' },
  { name: 'Body', href: '/health?tab=body' },
  { name: 'Progress', href: '/health?tab=progress' },
]

test.describe("Health's three panels each paint without a skeleton", () => {
  for (const tab of HEALTH_TABS) {
    test(`${tab.name} panel`, async ({ page }) => {
      const failures: string[] = []
      page.on('pageerror', e => failures.push(`pageerror: ${e.message}`))
      page.on('response', r => {
        if (r.url().includes('/api/') && r.status() >= 500) failures.push(`${r.status()} ${r.url()}`)
      })

      await visitTwice(page, tab.href)

      // Confirms the requested panel is the one on screen — without this the spec would happily
      // re-assert the default tab three times and report full coverage.
      await expect(page.getByRole('tab', { name: tab.name, selected: true })).toBeVisible()
      await expectNoSkeleton(page)
      expect(failures, `errors while loading ${tab.href}`).toEqual([])
    })
  }
})
