import { test, expect } from '@playwright/test'
import { suppressMorningCheckin } from './fixtures'

/**
 * #2930 — on a cold cache Home painted its sections (tiles included) for a few frames, then swapped
 * them for the skeleton, then painted them again. `showHomeSkeleton` hangs off `refreshing`, which
 * started false and was flipped by an effect after the first paint.
 *
 * Samples every animation frame from document start, so the flash cannot hide between two polls the
 * way it did in `lb163-log-tiles-three-column.spec.ts`. The property: once the metric tiles have been
 * on screen, there is no later frame without them.
 */
test.use({ viewport: { width: 384, height: 854 } })

test('Home never swaps painted sections for a skeleton', async ({ page }) => {
  test.setTimeout(120_000)
  await suppressMorningCheckin(page)
  await page.addInitScript(() => {
    try {
      localStorage.setItem('ta_ss_widgets', JSON.stringify(['weightKg', 'steps', 'calories']))
      localStorage.setItem('ta_home_section_order', JSON.stringify(['recommendation', 'metricTiles']))
      localStorage.setItem('ta_home_hidden_sections', JSON.stringify([]))
    } catch { /* storage blocked */ }
    const frames: number[] = []
    ;(window as unknown as { __tileFrames: number[] }).__tileFrames = frames
    const tick = () => {
      frames.push(document.querySelectorAll('[aria-label*="tap to view"]').length)
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })

  await page.goto('/') // first visit: cold cache
  await expect(page.locator('[aria-label*="tap to view"]').first()).toBeVisible({ timeout: 60_000 })
  await page.waitForTimeout(4_000) // long enough for the mount fetches to resolve and re-render

  const frames = await page.evaluate(() => (window as unknown as { __tileFrames: number[] }).__tileFrames)
  const firstShown = frames.findIndex(n => n > 0)
  expect(firstShown, 'the tiles never painted').toBeGreaterThanOrEqual(0)
  const lostAt = frames.findIndex((n, i) => i > firstShown && n === 0)
  expect(lostAt, `the tiles vanished at frame ${lostAt} after painting at frame ${firstShown} (skeleton swap)`)
    .toBe(-1)
})
