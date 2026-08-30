import { test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { settleRouteBoundary, suppressMorningCheckin } from './fixtures'

const SCREENS = ['/', '/health', '/workout', '/nutrition', '/more']

test('PROBE axe counts per screen', async ({ page }) => {
  test.setTimeout(300_000)
  await suppressMorningCheckin(page)
  for (const path of SCREENS) {
    await page.goto(path)
    await settleRouteBoundary(page)
    await page.waitForTimeout(2500)
    const res = await new AxeBuilder({ page })
      .withRules(['color-contrast', 'target-size'])
      .analyze()
    const byRule: Record<string, number> = {}
    for (const v of res.violations) byRule[v.id] = v.nodes.length
    console.log(`PROBE ${path}: violations=${JSON.stringify(byRule)} passes=${res.passes.map(p => p.id + ':' + p.nodes.length).join(',')} `)
    for (const v of res.incomplete) {
      console.log(`PROBE   INCOMPLETE ${v.id} x${v.nodes.length} — ${v.nodes[0]?.any?.[0]?.message?.slice(0, 120) ?? ''} @ ${v.nodes[0]?.target?.join(' ')?.slice(0, 70)}`)
    }
  }
})
