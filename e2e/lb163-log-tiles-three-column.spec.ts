import { test, expect } from '@playwright/test'
import { settleRouteBoundary, suppressMorningCheckin } from './fixtures'

/**
 * LB-163 — Home's Log tiles fill the row, and `Log` is not on top of the icon.
 *
 * Approved 2026-09-27 from `docs/design/2026-09-27-four-screen-mockups.html`. The entry states the
 * acceptance in measurable terms, so this measures rather than screenshots:
 *
 *   - at 384 px the row fills the width;
 *   - `Log` does not overlap the icon at any tile count.
 *
 * **The overlap came from the POSITIONING, not the size.** The pill was
 * `absolute top-0.5 right-0.5` with `min-h-11`, so a correct 44 px tap target was painted over the
 * icon. Shrinking it would have traded a layout bug for an accessibility one, which is why the 44 px
 * floor is asserted here too — a future "fix" that shrinks the control must fail.
 *
 * 384 px, not the harness default of 412: that is the width the mockup was drawn and approved at, and
 * it is the narrower case.
 */

const TILES = '[aria-label*="tap to view"]'

test.use({ viewport: { width: 384, height: 854 } })

/**
 * The tiles are pinned on rather than taken from the account, and that is deliberate: a first run
 * against the seeded user found **zero** tiles and the spec skipped itself, so it measured nothing
 * while reporting green. `metricTiles` is a Home SECTION as well as a set of widgets, so both have to
 * be set — the section order must contain it, nothing may hide it, and the widget list decides the
 * count. Three widgets is the case the approved mockup was drawn at.
 */
async function pinThreeTiles(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('ta_ss_widgets', JSON.stringify(['weightKg', 'steps', 'calories']))
      localStorage.setItem('ta_home_section_order', JSON.stringify(['recommendation', 'metricTiles']))
      localStorage.setItem('ta_home_hidden_sections', JSON.stringify([]))
    } catch { /* storage blocked — the skip below reports it */ }
  })
}

test('the row fills the width, and Log clears the icon at every tile count', async ({ page }) => {
  test.setTimeout(180_000)
  await suppressMorningCheckin(page)
  await pinThreeTiles(page)
  await page.goto('/')
  await settleRouteBoundary(page)

  const tiles = page.locator(TILES)
  // WAIT, do not count straight away. `settleRouteBoundary` returns while Home is still painting its
  // skeleton — the first run measured zero tiles against a screen of grey placeholder blocks, which
  // the failure screenshot showed plainly.
  await expect(tiles.first(), 'the metric tiles never painted').toBeVisible({ timeout: 60_000 })
  const count = await tiles.count()
  // Not a vacuous pass: with no metric widgets enabled the component returns null and there is
  // nothing to measure, so say so rather than reporting green.
  // NOT a skip. The tiles are pinned on above, so zero of them is a failure of this spec's premise
  // and must be reported as one — a skip here is how the first run measured nothing and passed.
  expect(count, 'no metric tiles rendered despite being pinned on — the spec cannot measure anything')
    .toBeGreaterThan(0)

  const first = await tiles.first().boundingBox()
  expect(first, 'the first tile has no box').not.toBeNull()

  // ── The row fills the width ────────────────────────────────────────────────────────────────────
  // Measured as the union of the tiles in the first row against the container, rather than against
  // 384 directly: the card carries `px-4`, so the row is 352 px wide and comparing to the viewport
  // would fail on correct layout.
  const rowWidth = await tiles.first().evaluate(el => {
    const parent = el.parentElement!
    return { parent: parent.getBoundingClientRect().width, cols: getComputedStyle(parent).gridTemplateColumns }
  })
  // Three columns, which is what "fills the row" means here — a flex row of content-sized tiles is
  // what left the right third empty.
  expect(rowWidth.cols.split(' ').length, `expected a 3-column grid, got "${rowWidth.cols}"`).toBe(3)

  const firstRow = [] as { x: number; w: number }[]
  for (let i = 0; i < count; i++) {
    const box = await tiles.nth(i).boundingBox()
    if (!box) continue
    if (Math.abs(box.y - first!.y) < 4) firstRow.push({ x: box.x, w: box.width })
  }
  const spanned = firstRow.reduce((a, t) => a + t.w, 0)
  // Gaps are `gap-2` = 8 px between columns. With three columns the tiles plus two gaps should
  // account for essentially the whole container.
  expect(spanned + (firstRow.length - 1) * 8, 'the tiles do not fill their row')
    .toBeGreaterThan(rowWidth.parent - 2)

  // ── Log clears the icon, on every tile ────────────────────────────────────────────────────────
  for (let i = 0; i < count; i++) {
    const tile = tiles.nth(i)
    const log = tile.locator('button[aria-label^="Log "]')
    const icon = tile.locator('svg').first()
    const [lb, ib] = [await log.boundingBox(), await icon.boundingBox()]
    expect(lb, `tile ${i} has no Log control`).not.toBeNull()
    expect(ib, `tile ${i} has no icon`).not.toBeNull()
    const overlaps = lb!.x < ib!.x + ib!.width && ib!.x < lb!.x + lb!.width
      && lb!.y < ib!.y + ib!.height && ib!.y < lb!.y + lb!.height
    expect(overlaps, `tile ${i}: the Log control still overlaps the icon`).toBe(false)
    // The pill sits BELOW the value, which is where the approved mockup put it.
    expect(lb!.y, `tile ${i}: Log is not below the icon`).toBeGreaterThan(ib!.y + ib!.height)
    // And the 44 px floor survives — the original defect was the position, not the size, so a
    // regression that shrinks the control to avoid the overlap must fail here.
    expect(lb!.height, `tile ${i}: the Log tap target dropped below 44 px`).toBeGreaterThanOrEqual(44)
  }
})
