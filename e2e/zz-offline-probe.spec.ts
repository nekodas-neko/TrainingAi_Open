import { test, expect } from '@playwright/test'
import { STORAGE_STATE } from './fixtures'

// Sweep 38 final: does a client-side navigation offline actually navigate, and does it paint cached
// data? The previous run could not tell "38% of /health retained" from "the home page, unchanged" --
// the offline byte count was within 3% of the home page's own online size.
test('offline client-side navigation: which page, and is it cached data?', async ({ browser }) => {
  test.setTimeout(300_000)
  const ctx = await browser.newContext({ storageState: STORAGE_STATE })
  const p = await ctx.newPage()
  const norm = async () => (await p.locator('body').innerText()).replace(/\s+/g, ' ').trim()

  await p.goto('/health', { waitUntil: 'networkidle', timeout: 150_000 })
  await p.goto('/health', { waitUntil: 'networkidle', timeout: 150_000 })
  await p.waitForTimeout(3000)
  const healthOnline = await norm()
  const ctrl = await p.evaluate(() => !!navigator.serviceWorker.controller)
  console.log(`BASE /health url=${p.url()} chars=${healthOnline.length} controller=${ctrl}`)

  await p.goto('/', { waitUntil: 'networkidle', timeout: 150_000 })
  await p.waitForTimeout(2500)
  const homeOnline = await norm()
  console.log(`BASE /       url=${p.url()} chars=${homeOnline.length}`)

  await ctx.setOffline(true)
  const urlBefore = p.url()
  await p.locator('a[href="/health"], a[href^="/health"]').first().click({ timeout: 15_000 }).catch(() => {})
  await p.waitForTimeout(6000)
  const after = await norm()
  const urlAfter = p.url()

  // Distinguishing evidence: did the URL change, and does the text match health or home?
  const healthMarker = /Estimated 1RM|Sleep|Readiness/i.test(after)
  console.log(`OFFLINE urlBefore=${urlBefore}`)
  console.log(`OFFLINE urlAfter =${urlAfter}  navigated=${urlBefore !== urlAfter}`)
  console.log(`OFFLINE chars=${after.length}  vsHealthOnline=${Math.round(100*after.length/healthOnline.length)}%  vsHomeOnline=${Math.round(100*after.length/homeOnline.length)}%`)
  console.log(`OFFLINE identicalToHomeOnline=${after === homeOnline}  offlinePage=${/You'?re offline/i.test(after)}  healthMarkers=${healthMarker}`)
  console.log(`  text: ${JSON.stringify(after.slice(0,120))}`)
  await ctx.close()
  expect(true).toBe(true)
})
