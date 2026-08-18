import { test, expect } from '@playwright/test'
import { STORAGE_STATE } from './fixtures'

// Sweep 38, the real question: the offline fallback for a NAVIGATION works (verified). But it
// replaces the whole screen, so does last-known cached data ever paint offline? The offline page
// itself claims "your saved data is still on the other tabs" -- test that claim.
test('offline: does cached data paint on a client-side tab change?', async ({ browser }) => {
  test.setTimeout(300_000)

  const ctx = await browser.newContext({ storageState: STORAGE_STATE })
  const p = await ctx.newPage()

  // Two loads so the SW activates and claims (LOAD1 is uncontrolled -- measured in the last run).
  await p.goto('/health', { waitUntil: 'networkidle', timeout: 150_000 })
  await p.goto('/health', { waitUntil: 'networkidle', timeout: 150_000 })
  await p.waitForTimeout(3000)
  const healthOnline = (await p.locator('body').innerText()).replace(/\s+/g, ' ').trim()
  console.log(`ONLINE /health chars=${healthOnline.length} controller=${await p.evaluate(() => !!navigator.serviceWorker.controller)}`)

  // Warm a second surface too, so its cache keys exist.
  await p.goto('/', { waitUntil: 'networkidle', timeout: 150_000 })
  await p.waitForTimeout(2500)
  const homeOnline = (await p.locator('body').innerText()).replace(/\s+/g, ' ').trim()
  console.log(`ONLINE /       chars=${homeOnline.length}`)

  await ctx.setOffline(true)

  // Client-side navigation: no document request, so the SW navigate-fallback should not fire and
  // readCacheSync/localStorage seeds should paint.
  const links = await p.locator('a[href="/health"], a[href^="/health"]').count()
  console.log(`OFFLINE tab links to /health found: ${links}`)
  if (links > 0) {
    await p.locator('a[href="/health"], a[href^="/health"]').first().click({ timeout: 15_000 }).catch(() => {})
    await p.waitForTimeout(5000)
    const t = (await p.locator('body').innerText()).replace(/\s+/g, ' ').trim()
    console.log(`OFFLINE client-nav -> chars=${t.length} retained=${Math.round(100*t.length/healthOnline.length)}% offlinePage=${/You'?re offline/i.test(t)}`)
    console.log(`  first 140: ${JSON.stringify(t.slice(0,140))}`)
  }
  await p.screenshot({ path: '/tmp/zz-offline-clientnav.png', fullPage: true })
  await ctx.close()
  expect(true).toBe(true)
})
