import { test, expect } from '@playwright/test'
import { settleRouteBoundary, suppressMorningCheckin } from './fixtures'

/**
 * OR-116 — the owner, comparing two screens: *"I dont see any other values that match that home
 * screen HR value — current = 73, min = 50, average = 89, max = 125, and the HR card says 60."*
 *
 * **Nothing was computing the wrong number.** Home's 60 is last night's **resting** rate; the
 * 73/50/89/125 are today's **intraday** series. Both screens called their figure "Heart Rate", so
 * one metric name covered two metrics and read as one metric disagreeing with itself.
 *
 * Two assertions, one per surface, plus a layout measurement — because the fix lengthens the
 * longest short label in a four-cell row, and a label that wraps or clips is a new defect traded
 * for the old one.
 */

test.describe('OR-116 — the two heart-rate surfaces say which metric they carry', () => {
  test.setTimeout(180_000)

  test("Home's chip names the resting rate, and the row still fits", async ({ page }) => {
    await suppressMorningCheckin(page)
    await page.goto('/')
    await settleRouteBoundary(page)

    // The accessible name always carries the full label, whichever ring style is active — the
    // visible `short` is only rendered by the band family, so asserting on the button is the one
    // check that holds for every style the owner might have set.
    const chip = page.getByRole('button', { name: /Resting HR: / }).first()
    await expect(chip, 'the Home chip must say which heart rate it is showing')
      .toBeVisible({ timeout: 60_000 })

    // Layout, measured rather than eyeballed (the repo's own rule). "Rest HR" is the longest short
    // label in the row; if it overflows its cell the fix has broken the thing it was clarifying.
    const overflow = await chip.evaluate(el => {
      const w = el.getBoundingClientRect().width
      let worst = 0
      el.querySelectorAll('*').forEach(c => {
        const r = (c as HTMLElement).getBoundingClientRect()
        if (r.width > worst) worst = r.width
      })
      return { cell: w, widest: worst, scrollW: document.documentElement.scrollWidth,
               clientW: document.documentElement.clientWidth }
    })
    expect(overflow.widest, 'a child is wider than the cell that holds it')
      .toBeLessThanOrEqual(overflow.cell + 1)
    expect(overflow.scrollW, 'the page must not scroll horizontally at phone width')
      .toBeLessThanOrEqual(overflow.clientW + 1)
  })

  test('the detail screen says its four numbers are today so far', async ({ page }) => {
    await suppressMorningCheckin(page)
    await page.goto('/health/heart-rate')
    await settleRouteBoundary(page)

    await expect(page.getByText('Today so far'), 'the intraday stats must name their window')
      .toBeVisible({ timeout: 60_000 })

    // The four it captions are still there and still named as they were — this is a labelling fix,
    // not a restructure, and a passing caption over a vanished grid would be worse than no caption.
    for (const label of ['Current', 'Min', 'Average', 'Max']) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible({ timeout: 15_000 })
    }
  })
})
