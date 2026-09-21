import { test, expect } from '@playwright/test'
import { settleRouteBoundary, suppressMorningCheckin } from './fixtures'

/**
 * `motion-polish`, the two members that were startable — RV-71 and RV-75.
 *
 * Both are one-line changes to shared primitives, which is exactly why they need a browser: the
 * diff is a class string, and whether that string produces the intended computed style is the part
 * a reviewer cannot see. A typo'd Tailwind class silently does nothing. **`duration-250` was one:**
 * it is not in the default scale and compiled to no rule at all, leaving the stock 300 ms in place.
 * That was caught before push and is the reason this asserts computed values rather than classes.
 *
 * **RV-71** — `components/ui/button.tsx` had **no `active:` anywhere** across 129 importers, on a
 * touch-only product, while 45 files hand-rolled `active:scale`. It also carried `transition-all`,
 * which animates `width`/`height`/`padding` too, so a Button that changes size got an unasked-for
 * layout animation.
 *
 * **RV-75** — the sheet ran on shadcn's stock 500 ms open. 47 files render one, against a tab
 * transition the repo deliberately cut to 180 ms.
 *
 * **Not checked here: how any of it feels.** No sandbox drives a Samsung WebView. The sticking
 * `hover:` this guards against is a documented Android trait, not something reproduced. These are
 * property assertions, and the entries say the same.
 */

/** The curve `globals.css` already uses for tabs and routes; the sheet now shares it. */
const EMPHASIZED = 'cubic-bezier(0.05, 0.7, 0.1, 1)'

test.describe('motion-polish — the shared primitives carry a press state and a tuned sheet', () => {
  test.setTimeout(180_000)

  test('RV-71: the Button transitions transform, not layout', async ({ page }) => {
    await suppressMorningCheckin(page)
    await page.goto('/more')
    await settleRouteBoundary(page)

    // `[data-slot="button"]`, not `button` — the first plain <button> on the page is some other
    // control carrying `transition-colors`, and asserting against it would have tested nothing
    // about this primitive while looking like a real check.
    const button = page.locator('[data-slot="button"]').first()
    await expect(button, 'no shared Button rendered on this screen').toBeVisible({ timeout: 60_000 })

    const style = await button.evaluate(el => {
      const cs = getComputedStyle(el)
      return { property: cs.transitionProperty, duration: cs.transitionDuration }
    })

    // The defect: `transition-all` animates width/height/padding/margin as well, so a Button that
    // changes size gets a layout animation. `all` must be gone.
    expect(style.property, 'the Button still transitions every property')
      .not.toBe('all')
    expect(style.property, 'transform is not transitioned, so the press state cannot animate')
      .toContain('transform')
    // Layout properties must NOT be in the list — that is the whole point of narrowing it.
    for (const layout of ['width', 'height', 'padding', 'margin']) {
      expect(style.property, `the Button still animates ${layout}`).not.toContain(layout)
    }
    // Press feedback should be quick enough to read as a press rather than an animation.
    const ms = parseFloat(style.duration) * 1000
    expect(ms, `press transition is ${ms}ms — too slow to read as a press`).toBeLessThanOrEqual(120)
  })

  test('RV-75: the sheet opens on the app\'s own curve, not shadcn\'s 500ms default', async ({ page }) => {
    await suppressMorningCheckin(page)
    // The program editor opens a Sheet straight from the URL — no navigation through the tab shell.
    await page.goto('/program?new=program')
    await settleRouteBoundary(page)

    const dialog = page.getByRole('dialog').first()
    await expect(dialog, 'no sheet opened').toBeVisible({ timeout: 60_000 })

    const style = await dialog.evaluate(el => {
      const cs = getComputedStyle(el)
      return { duration: cs.animationDuration, timing: cs.transitionTimingFunction }
    })

    // `animate-in` drives the open, so the OPEN duration lands on animation-duration.
    const ms = parseFloat(style.duration) * 1000
    expect(ms, `sheet opens in ${ms}ms — the stock 500ms default is still in place`)
      .toBeLessThanOrEqual(300)
    expect(ms, 'the sheet open is instant, which is not what was asked for').toBeGreaterThan(0)
    // The same curve as tabs and routes, rather than a second easing invented for sheets.
    expect(style.timing, 'the sheet is not on the app\'s emphasized-decelerate curve')
      .toBe(EMPHASIZED)
  })
})
