import { test, expect } from '@playwright/test'
import { STORAGE_STATE } from './fixtures'

// Sweep 38 diagnostic: distinguish "the SW never controlled the page" (harness artifact) from
// "the SW controlled it and the offline fallback still failed" (a real finding).
test('is the service worker controlling, and is /offline precached?', async ({ browser }) => {
  test.setTimeout(300_000)

  const ctx = await browser.newContext({ storageState: STORAGE_STATE })
  const p = await ctx.newPage()
  await p.goto('/health', { waitUntil: 'networkidle', timeout: 150_000 })
  await p.waitForTimeout(3000)

  const before = await p.evaluate(async () => {
    const regs = await navigator.serviceWorker.getRegistrations()
    const names = await caches.keys()
    let offlineCached = false
    for (const n of names) {
      const c = await caches.open(n)
      if (await c.match('/offline')) { offlineCached = true; break }
    }
    return {
      controller: !!navigator.serviceWorker.controller,
      registrations: regs.length,
      active: regs.map(r => !!r.active),
      cacheNames: names,
      offlineCached,
    }
  })
  console.log('LOAD1 ' + JSON.stringify(before))

  // A second navigation gives an uncontrolled first load a chance to become controlled.
  await p.goto('/health', { waitUntil: 'networkidle', timeout: 150_000 })
  await p.waitForTimeout(2000)
  const after = await p.evaluate(async () => ({
    controller: !!navigator.serviceWorker.controller,
    scriptURL: navigator.serviceWorker.controller?.scriptURL ?? null,
  }))
  console.log('LOAD2 ' + JSON.stringify(after))

  await ctx.setOffline(true)
  let threw = false, text = ''
  try {
    await p.reload({ waitUntil: 'domcontentloaded', timeout: 45_000 })
    text = (await p.locator('body').innerText()).replace(/\s+/g, ' ').trim()
  } catch (e) { threw = true }
  console.log(`OFFLINE threw=${threw} chars=${text.length} offlineWording=${/offline/i.test(text)}`)
  if (text) console.log(`  text: ${JSON.stringify(text.slice(0, 140))}`)

  await ctx.close()
  expect(true).toBe(true)
})
