import { test, expect } from '@playwright/test'
import { suppressMorningCheckin, settleRouteBoundary } from './fixtures'

/**
 * DV-12 — switching tabs must not make the Health charts re-measure their axes.
 *
 * The owner: *"speed/performance/efficiency when switching pages tabs is my highest priority."* A CPU
 * profile of single taps on the S25 put the canvas `font` setter at the top of **every** tap's
 * self-time, 7–48 ms, via chart.js `update → _tickSize → _computeLabelSizes`.
 *
 * **This counts that setter rather than timing the tap, and the difference is why the entry sat for
 * days.** `next dev` is unminified, in React dev mode and compiles on demand, so its tab-switch
 * timings are dominated by work the APK never does — an A/B of `resizeDelay` across all twenty charts
 * was unreadable against that noise. The setter count is not: **578 on every switch to Health before
 * the fix, 0 after, and 0 on a tab with no charts throughout.**
 *
 * The cause is not a resize. Instrumenting `ResizeObserver` gives 5 chart callbacks during load and
 * **zero** on a tab switch, so `content-visibility` never triggers one. It is `epoch`:
 * `TabVisibilityProvider` bumps it on every re-show, the screens refetch because of it — deliberately,
 * since all five tabs stay mounted — and the refetch hands `TrendSparkline` a new array with the same
 * contents, which defeats `memo`'s shallow compare.
 */

/** Five `TrendSparkline`s render on Health; the wait is generous because they arrive by dynamic import. */
const CHARTS_ON_HEALTH = 5

test('switching to the Health tab does not re-measure the charts', async ({ page }) => {
  test.setTimeout(240_000)
  await page.addInitScript(() => {
    const w = window as unknown as { __font: number }
    w.__font = 0
    const d = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'font')
    if (!d?.set || !d.get) return
    Object.defineProperty(CanvasRenderingContext2D.prototype, 'font', {
      configurable: true,
      get() { return d.get!.call(this) },
      set(v) { (window as unknown as { __font: number }).__font++; d.set!.call(this, v) },
    })
  })

  await suppressMorningCheckin(page)
  await page.goto('/health')
  await settleRouteBoundary(page)
  await page.waitForFunction(
    (n) => document.querySelectorAll('canvas').length >= n, CHARTS_ON_HEALTH, { timeout: 90_000 },
  )
  await page.waitForTimeout(6000)

  // The instrument has to be shown to work, or a zero below means nothing: drawing the charts at all
  // must move the counter. This is the control the first version of this probe lacked.
  const duringLoad = await page.evaluate(() => (window as unknown as { __font: number }).__font)
  expect(duringLoad, 'the font-setter patch never fired — the instrument is broken, not the app')
    .toBeGreaterThan(0)

  const seen: { to: string; font: number }[] = []
  for (const to of ['More', 'Health', 'More', 'Health']) {
    await page.evaluate(() => { (window as unknown as { __font: number }).__font = 0 })
    await page.getByRole('link', { name: to, exact: true }).first().click({ force: true })
    await page.waitForTimeout(2000)
    seen.push({ to, font: await page.evaluate(() => (window as unknown as { __font: number }).__font) })
  }

  expect(
    await page.evaluate(() => document.querySelectorAll('canvas').length),
    'the charts unmounted, so a zero below would be vacuous',
  ).toBeGreaterThanOrEqual(CHARTS_ON_HEALTH)
  expect(seen, 'a tab switch re-measured the chart axes').toEqual(
    seen.map(s => ({ to: s.to, font: 0 })),
  )
})
