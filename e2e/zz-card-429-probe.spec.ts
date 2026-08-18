import { test, expect } from '@playwright/test'
import { STORAGE_STATE } from './fixtures'

// Sweep 34: force each card's endpoint to 429 via route interception -- independent of whether the
// route has a rate limiter -- and compare the card's presence against a clean baseline.
const CARDS = [
  { label: 'Estimated 1RM', ep: '/api/weights-summary' },
  { label: 'Ring Status',   ep: '/api/oura/stats' },
]

test('do cards render an error state when their endpoint 429s?', async ({ browser }) => {
  test.setTimeout(300_000)

  const run = async (tag: string, blockEp: string | null) => {
    const ctx = await browser.newContext({ storageState: STORAGE_STATE })
    const p = await ctx.newPage()
    let blocked = 0
    if (blockEp) {
      await p.route(u => new URL(u).pathname === blockEp, async route => {
        blocked++
        await route.fulfill({ status: 429, contentType: 'application/json', body: '{"error":"Too many requests"}' })
      })
    }
    await p.goto('/health', { waitUntil: 'networkidle', timeout: 150_000 })
    await p.waitForTimeout(5000)
    const counts: Record<string, number> = {}
    for (const c of CARDS) counts[c.label] = await p.getByText(c.label, { exact: true }).count()
    const body = await p.locator('body').innerText()
    const err = /too many|try again|unavailable|couldn'?t load|failed to load/i.test(body)
    console.log(`RUN ${tag} blocked=${blocked} counts=${JSON.stringify(counts)} errWording=${err}`)
    await ctx.close()
    return counts
  }

  const base = await run('BASELINE', null)
  for (const c of CARDS) {
    const got = await run(`429:${c.ep}`, c.ep)
    console.log(`CARD "${c.label}"  baseline=${base[c.label]}  under429=${got[c.label]}  -> ${base[c.label] > 0 && got[c.label] === 0 ? 'VANISHED' : base[c.label] === 0 ? 'absent-at-baseline (inconclusive)' : 'SURVIVED'}`)
  }
  expect(true).toBe(true)
})
