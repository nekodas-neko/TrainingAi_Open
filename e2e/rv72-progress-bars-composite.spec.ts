import { test, expect } from '@playwright/test'
import { settleRouteBoundary } from './fixtures'

/**
 * RV-72 — progress fills composite instead of forcing layout.
 *
 * Five bars transitioned `width` directly. Animating width forces layout and paint every frame
 * **and reflows the bar's siblings** — the target tick sharing a track on `time-summary-card`, the
 * label and numbers beside each macro row. `transform: scaleX()` composites and touches nothing
 * else.
 *
 * **Asserted on computed style, not class strings.** On the previous PR `duration-250` compiled to
 * nothing and would have shipped as a convincing no-op: a typo'd Tailwind class fails no gate. So
 * this reads `transform`, `transformOrigin` and `transitionProperty` off the live element.
 *
 * The contributors are injected rather than waited for, the way `score-gap-reason.spec.ts` does it:
 * whether the seeded user has readiness contributors today is a fact about fixtures, and a bar that
 * never rendered would pass every assertion below vacuously.
 *
 * **Not checked here: how it moves.** No sandbox drives a Samsung WebView, and this is a
 * compositing change whose payoff is frame timing on that device. The entry keeps a device item.
 */
test.setTimeout(180_000)

test('the contributor bars composite, and their radius survives', async ({ page }) => {
  await page.route(u => new URL(u).pathname === '/api/readiness-score', async r => {
    // Built from the real response so everything else on the screen stays honest — only the
    // contributors are guaranteed.
    const real = await r.fetch()
    const body = await real.json().catch(() => ({}))
    await r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...body,
        readinessContributors: { hrv_balance: 42, resting_heart_rate: 71, sleep_balance: 88 },
      }),
    })
  })

  await page.goto('/health/readiness')
  await settleRouteBoundary(page)

  const fill = page.locator('[style*="scaleX"]').first()
  await expect(fill, 'no progress fill is using scaleX — the conversion did not reach this screen')
    .toBeVisible({ timeout: 60_000 })

  const shape = await fill.evaluate(el => {
    const cs = getComputedStyle(el)
    const track = el.parentElement ? getComputedStyle(el.parentElement) : null
    return {
      transform: cs.transform,
      origin: cs.transformOrigin,
      property: cs.transitionProperty,
      ownRadius: cs.borderTopLeftRadius,
      trackRadius: track?.borderTopLeftRadius ?? null,
      trackOverflow: track?.overflow ?? null,
    }
  })

  // A real matrix, not `none` — `none` would mean the inline transform never applied.
  expect(shape.transform, 'the fill has no transform').not.toBe('none')
  // Growing from the left edge. Without this the bar would scale about its centre.
  expect(shape.origin.startsWith('0px'), `transform-origin is ${shape.origin}, not the left edge`)
    .toBe(true)
  // The defect: transitioning a layout property.
  expect(shape.property, 'the fill still transitions width').not.toContain('width')
  expect(shape.property, 'the fill does not transition transform, so it will snap')
    .toContain('transform')

  // The radius must live on the TRACK. scaleX scales a fill's own radius horizontally, so a
  // rounded fill goes oval at low percentages — the track clips it to shape instead.
  expect(parseFloat(shape.trackRadius ?? '0'),
    'the track has no radius, so the square fill will show square ends')
    .toBeGreaterThan(0)
  expect(shape.trackOverflow, 'the track does not clip, so the fill is not shaped by it')
    .toContain('hidden')
  expect(parseFloat(shape.ownRadius), 'the fill kept its own radius — it will go oval under scaleX')
    .toBe(0)
})
