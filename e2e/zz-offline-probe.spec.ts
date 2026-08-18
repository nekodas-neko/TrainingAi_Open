import { test, expect } from '@playwright/test'
import { STORAGE_STATE } from './fixtures'

// Sweep 38: what does a read surface do with no network? Three states:
//   A. online, cold cache      -- the reference
//   B. offline, WARM cache     -- same context after A: seeds should paint
//   C. offline, COLD cache     -- fresh context, nothing seeded
const PAGES = ['/health', '/']

test('offline behaviour of the read surfaces', async ({ browser }) => {
  test.setTimeout(300_000)

  const OFFLINE_WORDS = /offline|no connection|no internet|reconnect|you'?re offline|can'?t connect/i

  for (const path of PAGES) {
    // A + B share one context so the cache warms.
    const ctx = await browser.newContext({ storageState: STORAGE_STATE })
    const p = await ctx.newPage()
    await p.goto(path, { waitUntil: 'networkidle', timeout: 150_000 })
    await p.waitForTimeout(4000)
    const onlineText = await p.locator('body').innerText()
    const onlineLen = onlineText.replace(/\s+/g, ' ').trim().length

    await ctx.setOffline(true)
    let reloadFailed = false
    try {
      await p.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 })
    } catch { reloadFailed = true }
    await p.waitForTimeout(4000)
    const warmText = reloadFailed ? '' : await p.locator('body').innerText()
    const warmLen = warmText.replace(/\s+/g, ' ').trim().length

    console.log(`PAGE ${path}`)
    console.log(`  A online-cold    chars=${onlineLen}`)
    console.log(`  B offline-warm   chars=${warmLen}  reloadThrew=${reloadFailed}  offlineWording=${OFFLINE_WORDS.test(warmText)}  retained=${onlineLen ? Math.round(100*warmLen/onlineLen) : 0}%`)
    await p.screenshot({ path: `zz-offline-warm${path.replace(/\W/g,'_')}.png`, fullPage: true })
    await ctx.close()

    // C: fresh context, offline from the start.
    const cold = await browser.newContext({ storageState: STORAGE_STATE })
    const pc = await cold.newPage()
    await cold.setOffline(true)
    let coldFailed = false
    try {
      await pc.goto(path, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    } catch { coldFailed = true }
    await pc.waitForTimeout(3000)
    const coldText = coldFailed ? '' : await pc.locator('body').innerText()
    const coldLen = coldText.replace(/\s+/g, ' ').trim().length
    console.log(`  C offline-cold   chars=${coldLen}  gotoThrew=${coldFailed}  offlineWording=${OFFLINE_WORDS.test(coldText)}`)
    if (!coldFailed) console.log(`     first 160 chars: ${JSON.stringify(coldText.replace(/\s+/g,' ').trim().slice(0,160))}`)
    await cold.close()
  }
  expect(true).toBe(true)
})
