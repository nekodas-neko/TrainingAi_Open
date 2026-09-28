import { test, expect, type Page } from '@playwright/test'

/**
 * A read that fails on a cold cache says so, rather than reading as an empty account (RV-150).
 *
 * The device sweep blocked each of 24 read endpoints in turn on a WARM app and found nothing
 * visible changed anywhere — every card kept its cached value as if current. Its own note says the
 * untested case is a failure with **no cache**, which is the one the standing rule is about: with
 * nothing to fall back on, `cachedFetch` swallows `!res.ok` and a card renders its `??` defaults or
 * returns null. Measured here at 412 px, that turned three surfaces into a brand-new-looking
 * account with nothing anywhere saying a request had failed.
 *
 * Cold is the point — a warm run passes whatever the code does, because the cache covers it.
 */

// The service worker re-issues every /api/ request and Playwright cannot intercept a
// service-worker fetch, so without this the stub applies or not depending on whether the worker has
// claimed the page — green locally, intermittently red on CI with the real route answering.
test.use({ serviceWorkers: 'block' })

/** No cache of any kind. The auth cookie is not storage, so the session survives. */
async function coldStart(page: Page) {
  await page.addInitScript(() => {
    try { localStorage.clear(); sessionStorage.clear() } catch { /* storage blocked */ }
  })
}

/** Every `/api` GET fails. Writes and `/api/sync/*` are never touched — read-only by construction. */
async function failReads(page: Page) {
  await page.route('**/api/**', async route => {
    const req = route.request()
    if (req.method() !== 'GET' || req.url().includes('/api/sync/') || req.url().includes('/api/auth/')) {
      return route.fallback()
    }
    await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"probe"}' })
  })
}

async function openCold(page: Page, route: string) {
  await coldStart(page)
  await failReads(page)
  await page.goto(route)
}

test('More says the profile did not load instead of rendering a blank one', async ({ page }) => {
  await openCold(page, '/more')
  // The identity block is all `??` defaults, so without this it reads "No name set" and an empty
  // email — indistinguishable from an account created a moment ago.
  await expect(page.getByText(/Couldn.t load your profile/)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('No name set')).toHaveCount(0)
})

test('Profile details names both sections that failed rather than dropping them', async ({ page }) => {
  await openCold(page, '/more/details')

  // Both sections end in `return null` when they have nothing, so a failed load used to remove
  // them from the page entirely — the heading included, which is what made it unreportable.
  for (const heading of ['What the app has measured', 'Tests and scans']) {
    await expect(page.getByRole('heading', { name: heading })).toBeVisible({ timeout: 30_000 })
  }
  await expect(page.getByText(/Couldn.t load your readings/)).toBeVisible()
  await expect(page.getByText(/Couldn.t load your tests and scans/)).toBeVisible()
})

test('a healthy cold start shows the real account, not the failure lines', async ({ page }) => {
  // The other half of the guarantee: these lines must be reachable ONLY by a failure. Without this
  // a component that always rendered them would pass both tests above.
  await coldStart(page)
  await page.goto('/more/details')
  await expect(page.getByRole('heading', { name: 'What the app has measured' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/Couldn.t load your readings/)).toHaveCount(0)
  await expect(page.getByText(/Couldn.t load your tests and scans/)).toHaveCount(0)
})

test('Home names the body battery it could not load, instead of dropping the card', async ({ page }) => {
  // LB-175. Every other read on Home already degrades honestly — an em dash for a number, its own
  // line for the timeline and the weekly recap. This card was the one section that just vanished.
  await openCold(page, '/')
  await expect(page.getByText(/Couldn.t load your body battery/)).toBeVisible({ timeout: 30_000 })
})

test('a healthy cold Home shows the card, not the line', async ({ page }) => {
  await coldStart(page)
  await page.goto('/')
  // Waits for the screen to settle rather than for the card, which a zero-data account may not show.
  await expect(page.getByText(/Couldn.t load today.s timeline/)).toHaveCount(0, { timeout: 30_000 })
  await expect(page.getByText(/Couldn.t load your body battery/)).toHaveCount(0)
})

test('Health never claims "No data" for a read that failed', async ({ page }) => {
  // LB-176. Cold at 412 px with every GET down, this screen printed BURNED / BMI / BALANCE / DIST /
  // RESTING HR / HRV / SPO₂ all as "No data" — seven statements about his account made from seven
  // failed requests. Asserted as a COUNT of the literal rather than per cell: the defect is the
  // sentence appearing at all under these conditions, and a count cannot be satisfied by fixing one
  // tile and leaving its neighbour.
  await openCold(page, '/health')
  await expect(page.getByText(/Couldn.t load/).first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('No data', { exact: true }),
    'a cell claimed the account has no data when the request had failed').toHaveCount(0)
})

test('Health does not tell him to re-enter profile details he already set', async ({ page }) => {
  // The worst one in the entry. `energyBalance` is null while loading, on a failed read, AND for an
  // account with nothing stored, and all three rendered EnergyBudgetPrompt — so a request that did
  // not land told him to add a height, age and sex he set months ago. A genuinely incomplete profile
  // never reaches that prompt: the service always returns `missingProfileFields`, and a non-empty one
  // routes to CalorieBalanceBar, which names the fields actually missing.
  await openCold(page, '/health')
  await expect(page.getByText(/Couldn.t load/).first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/Add your height, age and sex in Profile/),
    'a failed read asked him to redo his profile').toHaveCount(0)
  await expect(page.getByText(/Log body weight to see trend/),
    'a failed read asked him to log a weight he has already logged').toHaveCount(0)
})

test('a healthy cold Health shows the real account, not the failure lines', async ({ page }) => {
  // The other half, and the entry asked for it by name: without this, a component that ALWAYS
  // rendered "Couldn't load" would pass both tests above. "No data" is deliberately not asserted
  // here — on a sparse account it is the correct thing for a cell to say.
  await coldStart(page)
  await page.goto('/health')
  await expect(page.getByText(/Couldn.t load your energy budget/)).toHaveCount(0, { timeout: 30_000 })
  await expect(page.getByText(/Couldn.t load your training load/)).toHaveCount(0)
  await expect(page.getByText(/Couldn.t load your goals/)).toHaveCount(0)
})
