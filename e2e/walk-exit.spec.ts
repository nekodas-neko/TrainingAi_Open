import { test, expect, type Page } from '@playwright/test'

/**
 * How you leave a guided walk (#2134, LB-141, LB-174).
 *
 * **The walk is immersive on purpose.** `/activity/guided-walk` is its own route outside the tab
 * shell, so it renders no tab bar — LB-141 found that the tab-bar exit it had wired could never
 * fire, and the owner's answer (2026-10-06) was to keep the walk immersive with ONE Exit and a
 * confirm, and to delete the dead exit. If the first test below ever fails, the walk has been moved
 * inside the shell: that is a product decision to make again, not a selector to loosen.
 *
 * **What this does not prove.** The hardware back gesture is a Capacitor `backButton` listener,
 * which has no web equivalent, so the last test drives it through a stub of the native bridge. That
 * exercises the whole of our code on that path (listener → registry → the walk screen's dialog) and
 * none of the Android side. Whether the real gesture reaches the listener first is a device check.
 */

const PLAN = { sets: 5, fastSec: 180, slowSec: 180, warmupSec: 0, cooldownSec: 0, treadmill: true }

// Cold `pnpm dev` compiles the walk route and its summary on first use.
test.setTimeout(120_000)

// The Save test stubs `/api/activity-logs`, and a service worker would re-issue that request where
// Playwright cannot intercept it (scripts/check-e2e-api-stub-sw.js).
test.use({ serviceWorkers: 'block' })

/**
 * A walk `elapsedSec` old. `treadmill` keeps the GPS watcher from ever starting, and the plan is
 * 30 minutes so a fixture younger than that is never discarded as stale on rehydration.
 */
async function seedActiveWalk(page: Page, elapsedSec: number) {
  await page.addInitScript(([plan, elapsed]) => {
    window.localStorage.setItem('ta_guided_walk_v1', JSON.stringify({
      version: 0,
      state: {
        mode: 'active', config: plan, customConfig: null,
        startedAtMs: Date.now() - (elapsed as number) * 1000,
        rawPoints: [], distanceKm: 0, currentPaceSecPerKm: null, recentSpeedKmh: null,
      },
    }))
  }, [PLAN, elapsedSec] as const)
}

const storedMode = (page: Page) => page.evaluate(
  () => JSON.parse(window.localStorage.getItem('ta_guided_walk_v1') ?? '{}').state?.mode as string,
)

async function openWalk(page: Page, elapsedSec: number) {
  await seedActiveWalk(page, elapsedSec)
  await page.goto('/activity/guided-walk')
  await expect(page.getByRole('button', { name: 'Exit walk' })).toBeVisible({ timeout: 60_000 })
}

test('a walk in progress has no tab bar and exactly one way out', async ({ page }) => {
  await openWalk(page, 5 * 60)

  expect(
    await page.locator('nav').count(),
    'the walk route renders no tab bar — see this spec’s docblock',
  ).toBe(0)

  const exits = await page.locator('main button, main a').allInnerTexts()
  expect(exits.filter(t => t.trim().length > 0)).toEqual(['Exit walk'])
})

test('Exit asks first, and Keep walking carries on', async ({ page }) => {
  await openWalk(page, 5 * 60)

  await page.getByRole('button', { name: 'Exit walk' }).click()
  const dialog = page.getByRole('dialog', { name: 'Exit this walk?' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Save walk' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Discard' })).toBeVisible()

  await dialog.getByRole('button', { name: 'Keep walking' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('button', { name: 'Exit walk' })).toBeVisible()
  expect(await storedMode(page), 'asking must not end the walk').toBe('active')
})

test('Discard abandons a long walk and writes nothing', async ({ page }) => {
  const posts: string[] = []
  await page.route('**/api/activity-logs', route => {
    if (route.request().method() === 'POST') posts.push(route.request().url())
    return route.continue()
  })
  await openWalk(page, 5 * 60)

  await page.getByRole('button', { name: 'Exit walk' }).click()
  await page.getByRole('dialog', { name: 'Exit this walk?' }).getByRole('button', { name: 'Discard' }).click()

  // Back on the setup screen, with no walk running.
  await expect(page.getByRole('button', { name: 'Start walk' })).toBeVisible({ timeout: 30_000 })
  // The store persists on a 2 s debounce, so the stored copy trails what is on screen.
  await expect.poll(() => storedMode(page), { timeout: 10_000 }).toBe('config')
  expect(posts, 'a discarded walk must not be recorded').toEqual([])
})

test('Save records what was walked, not the plan', async ({ page }) => {
  // Fulfilled, not continued: this asserts the request and must not add a row to the seeded user.
  const bodies: Array<{ durationMin?: number }> = []
  await page.route('**/api/activity-logs', route => {
    if (route.request().method() !== 'POST') return route.continue()
    bodies.push(route.request().postDataJSON())
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ activityLog: { id: 'e2e-walk-exit', caloriesBurned: 120 } }),
    })
  })
  await openWalk(page, 5 * 60)

  await page.getByRole('button', { name: 'Exit walk' }).click()
  await page.getByRole('dialog', { name: 'Exit this walk?' }).getByRole('button', { name: 'Save walk' }).click()

  await expect(page.getByRole('heading', { name: 'Walk complete' })).toBeVisible({ timeout: 30_000 })
  await expect.poll(() => bodies.length, { timeout: 30_000 }).toBe(1)
  // Five minutes in, against a 30-minute plan (BF-190).
  expect(bodies[0].durationMin).toBe(5)
})

test('under a minute the only choices are to discard or keep walking', async ({ page }) => {
  await openWalk(page, 20)

  await page.getByRole('button', { name: 'Exit walk' }).click()
  const dialog = page.getByRole('dialog', { name: 'Discard this walk?' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Discard' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Keep walking' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save walk' })).toHaveCount(0)
})

test('the back gesture opens the same Exit prompt, and does nothing else', async ({ page }) => {
  // A stub of Capacitor's native bridge: just enough for `App.addListener('backButton', …)` to
  // register, and a handle to fire it. The platform flips back to web as soon as that listener is in
  // so nothing else on the page believes it is on a device.
  await page.addInitScript(() => {
    type Cb = (e: { canGoBack: boolean }) => void
    const w = window as unknown as Record<string, unknown>
    const listeners: Record<string, Cb[]> = {}
    let native = true
    Object.defineProperty(window, 'androidBridge', {
      configurable: true,
      get: () => (native ? { postMessage() {} } : undefined),
    })
    w.Capacitor = {
      PluginHeaders: [{
        name: 'App',
        methods: [
          { name: 'addListener', rtype: 'callback' }, { name: 'removeListener', rtype: 'promise' },
          { name: 'getLaunchUrl', rtype: 'promise' }, { name: 'minimizeApp', rtype: 'promise' },
        ],
      }],
      nativeCallback(plugin: string, method: string, options: { eventName: string }, cb: Cb) {
        if (plugin === 'App' && method === 'addListener') {
          ;(listeners[options.eventName] ??= []).push(cb)
          // Other code registers listeners first (`resume`), so wait for the one under test.
          if (options.eventName === 'backButton') native = false
        }
        return Promise.resolve('stub')
      },
      nativePromise: () => Promise.resolve({}),
    }
    w.__pressBack = () => (listeners.backButton ?? []).forEach(cb => cb({ canGoBack: true }))
    w.__backListeners = () => (listeners.backButton ?? []).length
  })
  await openWalk(page, 5 * 60)
  await expect.poll(
    () => page.evaluate(() => (window as unknown as { __backListeners: () => number }).__backListeners()),
    { message: 'the back listener never registered, so nothing below proves anything', timeout: 30_000 },
  ).toBeGreaterThan(0)

  const pressBack = () => page.evaluate(() => (window as unknown as { __pressBack: () => void }).__pressBack())
  const url = page.url()
  await pressBack()

  const dialog = page.getByRole('dialog', { name: 'Exit this walk?' })
  await expect(dialog).toBeVisible()
  expect(page.url(), 'back raised the prompt; it must not have navigated').toBe(url)

  // A second press while the prompt is up leaves it as it is — one dialog, not two stacked.
  await pressBack()
  await expect(page.getByRole('dialog')).toHaveCount(1)

  await dialog.getByRole('button', { name: 'Keep walking' }).click()
  await expect(dialog).toBeHidden()
  expect(await storedMode(page), 'asking must not end the walk').toBe('active')
})
