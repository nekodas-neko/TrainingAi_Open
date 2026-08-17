import { join } from 'node:path'
import { expect, type Page } from '@playwright/test'

/** Seeded by `scripts/local-db/seed.sql`. Idempotent — `pnpm db:local` will not re-seed. */
export const SEED_EMAIL = 'test@local.dev'
export const SEED_PASSWORD = 'testpass123'

export const STORAGE_STATE = join(__dirname, '.auth', 'seed-user.json')

/**
 * A second account with no program, no logs and no metrics (Q-352).
 *
 * Every other spec runs as the seeded user, who has all three — so before this existed **no
 * first-run or empty state was reachable from the harness at all**, which is exactly where the
 * 2026-08-17 failure-cells sweep found the app broken (Q-451's dead primary action on the primary
 * tab, Q-452's AI copy). Both shipped verified-by-hand and unguarded for want of it.
 *
 * **Created by `zero-data.setup.ts` rather than by `scripts/local-db/seed.sql`, deliberately.**
 * `setup.sh` skips the seed entirely when `users` is non-empty, so a developer's existing local
 * database would never gain the account while CI (fresh every run) always would — a spec that
 * assumed it would pass in CI and fail locally, which is the wrong way round for a regression
 * guard. Creating it from the setup project makes local and CI identical.
 *
 * Use it per-file: `test.use({ storageState: ZERO_DATA_STORAGE_STATE })`.
 */
export const ZERO_DATA_EMAIL = 'zero@local.dev'
export const ZERO_DATA_STORAGE_STATE = join(__dirname, '.auth', 'zero-data-user.json')

/**
 * Visit a route twice and return only after the second visit has painted.
 *
 * The first visit fills the caches; the second is the one the instant-paint rule is about — a
 * screen that shows a skeleton on a *repeat* visit is a bug (CLAUDE.md, "Instant paint"). Specs
 * assert on what is on screen right after this resolves, before any network settles.
 */
export async function visitTwice(page: Page, path: string): Promise<void> {
  await page.goto(path)
  await page.waitForLoadState('networkidle')
  await page.goto(path)
  await page.waitForLoadState('domcontentloaded')
  await settleRouteBoundary(page)
}

/**
 * Wait for the tab route's `loading.tsx` boundary (`components/shell/tab-loading.tsx`) to hand over
 * to the real screen. It marks itself `aria-busy`, which is the honest signal to wait on.
 *
 * This matters more here than in production: the harness drives `pnpm dev`, so the first navigation
 * to a route pays a compile and the boundary is visible for seconds rather than "one network round
 * trip at most". Asserting through it would make every spec a race against the dev compiler.
 */
export async function settleRouteBoundary(page: Page): Promise<void> {
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 60_000 })
}

/**
 * Assert a screen painted real content rather than a loading state.
 *
 * Deliberately not a screenshot comparison: a pixel baseline would have to be regenerated on every
 * unrelated style change and would rot into an ignored red. This checks the property the rule
 * actually states — that something other than a skeleton is on screen.
 */
export async function expectNoSkeleton(page: Page, timeout = SKELETON_TIMEOUT_MS): Promise<void> {
  // Counted in the viewport, not across the document. Health renders all three of its tabs at once
  // inside a SwipeCarousel, so the inactive panels are mounted and — to Playwright — "visible",
  // while the user cannot see them. A document-wide check reports those off-screen panels' loading
  // cards as instant-paint violations on whatever tab happens to be open. They are not: an inactive
  // tab's data is fetched when you swipe to it, by design (health-content.tsx's per-tab groups).
  await expect
    .poll(async () => page.evaluate(() => {
      const vw = window.innerWidth, vh = window.innerHeight
      return [...document.querySelectorAll('.animate-pulse')].filter(el => {
        const r = el.getBoundingClientRect()
        return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw
      }).length
    }), { timeout, message: 'skeletons still visible in the viewport on a repeat visit' })
    .toBe(0)
  await expect(page.getByText(/^Loading…?$/).first()).toBeHidden({ timeout })
}

/**
 * Deliberately generous, and the reason is a limitation worth knowing rather than a fudge.
 *
 * The harness drives `pnpm dev`, so a route's API handlers compile on their first call. A screen
 * like Health fires six fetches behind a concurrency cap, and the last one in that queue can take
 * many seconds on a cold compile — which is indistinguishable, from the outside, from a card that
 * genuinely failed to seed. A short budget turns that into a phantom instant-paint violation.
 *
 * The cost is real: this cannot catch a card that seeds *slowly but correctly*. It can still catch
 * a card that never seeds at all, which is the failure this rule is actually about.
 */
export const SKELETON_TIMEOUT_MS = 20_000
