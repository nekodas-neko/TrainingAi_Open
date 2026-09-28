import { test, expect, type Locator, type Page } from '@playwright/test'
import { suppressMorningCheckin, settleRouteBoundary, stableBox } from './fixtures'

test.use({ serviceWorkers: 'block' })

/**
 * BF-205 — the "Reorder sections" button can reorder sections.
 *
 * The owner: *"when I click the grid button on the home screen I cannot move widgets and
 * re-arrange them."* Every part of the feature existed — the button, the `aria-pressed` state, the
 * order in state, a loader, a saver, and a ref kept in sync *"so drag/sync handlers can read it
 * synchronously"* — except a code path that changed the order in response to a gesture.
 *
 * **What this can and cannot prove.** It drives `PointerSensor` with synthesised pointer events in
 * Chromium, which is the same path a real pointer takes, so it settles whether the wiring works
 * and whether the order survives a reload. It says nothing about the Samsung WebView, where a
 * drag inside a vertically scrolling container is where the direction-lock bug lives — that is
 * `BF-205`'s device pass, and the handle plus `touch-none` is the design that is supposed to make
 * it pass.
 */
const order = (page: Page) =>
  page.$$eval('[data-section-key]', els => els.map(e => e.getAttribute('data-section-key')))

/**
 * An attribute selector, NOT `getByRole('button', { name: 'Drag to reorder section' })`.
 *
 * The role engine matched **twelve** elements against six handles here — Home's cards are
 * `role="button"` wrappers and the grip sits inside one, so the name resolved onto both. `.all()[0]`
 * then handed back a 412×266 box and the drag began on a card instead of a handle, which looked
 * exactly like the defect under test.
 */
const handles = (page: Page) => page.locator('[aria-label="Drag to reorder section"]')

async function homeInEditMode(page: Page) {
  await page.addInitScript(() =>
    localStorage.setItem('ta_ss_cards', JSON.stringify(['sleepWidget', 'stepsWidget'])))
  await suppressMorningCheckin(page)
  await page.goto('/')
  await settleRouteBoundary(page)
  await expect.poll(async () => (await order(page)).length, { timeout: 60_000 }).toBeGreaterThan(2)
  await page.getByRole('button', { name: 'Reorder sections' }).click()
  await expect(page.getByRole('button', { name: 'Reorder sections' })).toHaveAttribute('aria-pressed', 'true')
}

/**
 * Press the handle until the sortable actually picks the section up.
 *
 * **`PointerSensor` activates immediately only when the `pointerdown` lands on the handle
 * itself** — read from `@dnd-kit/dom`'s defaults: a mouse press whose target is the handle (or
 * inside it) gets no activation constraint, and anything else falls through to a 200 ms delay,
 * a 5 px distance, and `preventActivation` for interactive elements. Home's sections ARE
 * interactive (`role="button"` cards), so a press that misses the grip by a pixel is blocked
 * outright rather than merely slow.
 *
 * Cards here resolve asynchronously, so the layout can shift between measuring and pressing. This
 * re-measures, checks the point really is over the grip with `elementFromPoint`, and retries. It
 * hides no defect: the retry only concerns landing on the handle, and it throws with a message
 * that says so rather than letting a missed press read as "the app did not reorder".
 */
async function pressHandle(page: Page, handle: Locator): Promise<{ x: number; y: number }> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const box = await stableBox(handle)
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    const onGrip = await page.evaluate(
      ([px, py]) => !!document.elementFromPoint(px, py)?.closest('[aria-label="Drag to reorder section"]'),
      [x, y],
    )
    if (!onGrip) { await page.waitForTimeout(300); continue }

    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x, y + 12)
    await page.waitForTimeout(150)
    if (await page.locator('.opacity-40').count() > 0) return { x, y }
    await page.mouse.up()
    await page.waitForTimeout(300)
  }
  throw new Error('the pointer never picked a section up — that is the harness, not the app')
}

/** Drag the handle of `fromIndex` onto the section at `toIndex`. */
async function dragSection(page: Page, fromIndex: number, toIndex: number) {
  const handle = handles(page).nth(fromIndex)
  await handle.scrollIntoViewIfNeeded()
  const to = await stableBox(page.locator('[data-section-key]').nth(toIndex))
  const { x, y: startY } = await pressHandle(page, handle)
  // Aim PAST the target's far edge rather than at its middle. The thing being dragged is the whole
  // section, not the handle, so a pointer that stops at the target's centre can leave two tall
  // cards barely overlapping and `dragover` never fires. Overshooting costs nothing.
  const endY = toIndex > fromIndex ? to.y + to.height + 24 : to.y - 24

  for (let i = 1; i <= 16; i += 1) {
    await page.mouse.move(x, startY + ((endY - startY) * i) / 16)
    await page.waitForTimeout(40)
  }
  await page.mouse.up()
  await page.waitForTimeout(600)
}

/** Adjacent moves are the reliable gesture here; a long drag past several tall cards is not. */
const MOVE_FROM = 1
const MOVE_TO = 0

test('a section can be dragged to a new position, and it stays there', async ({ page }) => {
  test.setTimeout(240_000)
  await homeInEditMode(page)

  const before = await order(page)
  expect(before.length, 'need at least three sections to move one past another').toBeGreaterThan(2)

  await dragSection(page, MOVE_FROM, MOVE_TO)

  const after = await order(page)
  expect(after, 'the drag changed nothing — this is the BF-205 defect').not.toEqual(before)
  expect([...after].sort(), 'a section was lost or duplicated by the move').toEqual([...before].sort())
  expect(after.indexOf(before[MOVE_FROM]), 'the dragged section did not move up')
    .toBeLessThan(after.indexOf(before[MOVE_TO]))

  // The order is only worth anything if it survives leaving Home, which is what the owner would
  // notice next. `savePreference` fires on drag END, so this also pins that it fires at all.
  await page.reload()
  await settleRouteBoundary(page)
  await expect.poll(async () => (await order(page)).length, { timeout: 60_000 }).toBe(after.length)
  expect(await order(page), 'the new order did not survive a reload').toEqual(after)
})

test('the drag handles exist only in edit mode', async ({ page }) => {
  test.setTimeout(240_000)
  await page.addInitScript(() =>
    localStorage.setItem('ta_ss_cards', JSON.stringify(['sleepWidget', 'stepsWidget'])))
  await suppressMorningCheckin(page)
  await page.goto('/')
  await settleRouteBoundary(page)
  await expect.poll(async () => (await order(page)).length, { timeout: 60_000 }).toBeGreaterThan(2)

  await expect(handles(page)).toHaveCount(0)
  await page.getByRole('button', { name: 'Reorder sections' }).click()
  await expect(handles(page).first()).toBeVisible()
})
