import { test, expect } from '@playwright/test'
import { STORAGE_STATE } from './fixtures'

// Sweep 38 last question: offline, a tab tap did not navigate at all (URL unchanged, no offline
// page). Does that depend on whether the service worker is controlling? Force the controlled state
// by waiting for it, then repeat.
test('offline tab tap, with the service worker confirmed in control', async ({ browser }) => {
  test.setTimeout(300_000)
  const ctx = await browser.newContext({ storageState: STORAGE_STATE })
  const p = await ctx.newPage()

  await p.goto('/', { waitUntil: 'networkidle', timeout: 150_000 })
  // Wait for control rather than assuming two loads is enough -- it was true in one run and false
  // in the next from the identical sequence.
  for (let i = 0; i < 12; i++) {
    if (await p.evaluate(() => !!navigator.serviceWorker.controller)) break
    await p.goto('/', { waitUntil: 'networkidle', timeout: 60_000 })
    await p.waitForTimeout(1500)
  }
  const controller = await p.evaluate(() => !!navigator.serviceWorker.controller)
  await p.waitForTimeout(2000)
  const before = (await p.locator('body').innerText()).replace(/\s+/g, ' ').trim()
  console.log(`READY controller=${controller} url=${p.url()} chars=${before.length}`)

  await ctx.setOffline(true)
  const urlBefore = p.url()
  const link = p.locator('a[href="/health"], a[href^="/health"]').first()
  console.log(`LINK count=${await p.locator('a[href="/health"], a[href^="/health"]').count()} visible=${await link.isVisible().catch(() => false)}`)
  await link.click({ timeout: 15_000 }).catch((e) => console.log(`CLICK threw: ${String(e).slice(0,80)}`))
  await p.waitForTimeout(8000)

  const after = (await p.locator('body').innerText()).replace(/\s+/g, ' ').trim()
  // A marker that only /health has -- NOT "Sleep"/"Readiness", which the home page also shows.
  const onHealth = /Estimated 1RM|HR Recovery Profile|Health Trends/i.test(after)
  console.log(`AFTER url=${p.url()} navigated=${urlBefore !== p.url()} chars=${after.length}`)
  console.log(`AFTER offlinePage=${/You'?re offline/i.test(after)} healthOnlyMarker=${onHealth} unchanged=${after === before}`)
  await ctx.close()
  expect(true).toBe(true)
})
