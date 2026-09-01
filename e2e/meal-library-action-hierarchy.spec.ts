import { test, expect, type Page } from '@playwright/test'
import { Client } from 'pg'
import { SEED_EMAIL, settleRouteBoundary, stableBox } from './fixtures'

/**
 * BF-73 ② — `New` outranks `Delete meals`, and the tap floor is what decides both their heights.
 *
 * The owner asked for *"a big 'New' button + a small delete bin"* after two equal-weight pills
 * overstated the destructive one. BF-73 shipped that and recorded the measurements in its own
 * entry — `New` filling the row, the bin square beside it — and **nothing asserted them anywhere**,
 * so the claim lived only in prose while the layout was free to drift back.
 *
 * ## Why this is not a screenshot test
 *
 * BF-91 proposed `toHaveScreenshot` baselines for exactly these flows. Two things rule it out here.
 *
 * **A session cannot generate a baseline CI would accept.** `playwright.config.ts` uses the sandbox
 * Chromium at a fixed path because the managed download is proxy-blocked; measured 2026-09-01 that
 * binary is **141.0.7390.37** while `@playwright/test` 1.62.1 pins revision 1234 — **151.0.7922.34**
 * — which CI installs. Ten major versions of font rasterisation and compositing apart, so a
 * committed baseline would fail on its first CI run and every one after.
 *
 * **And a baseline proves CHANGE, not CORRECTNESS.** Someone has to approve the first image, which
 * converts a recurring check into a one-time one rather than removing it. The assertions below are
 * claims that can be *wrong on the first run* — the hierarchy the owner asked for, in numbers.
 *
 * ## The mechanism these numbers actually come from (LB-32)
 *
 * Both controls are written `h-11` — **44 px** — and both render **48**, because `globals.css` sets
 * a bare `button, [role="button"] { min-height: 48px }` that beats the utility. BF-73 found the same
 * rule the other way round: a `min-h-[84px]` on a `<button>` computes 48, so BF-50's `min-h-[62px]`
 * tile never applied and measured its content's 60 px instead.
 *
 * That makes the global floor load-bearing here rather than incidental: delete it, or add
 * `tap-dense` to these buttons, and they silently drop to 44 — under this repo's own tap-target
 * floor, with no class in the diff having changed. The height assertions below are what notice.
 */

/**
 * TWO meals, and that is a requirement rather than tidiness: `saved-meals-sheet.tsx` passes
 * `canSelect={meals.length > 1}`, so with one meal the bin does not render at all and every
 * assertion below would fail for a reason that has nothing to do with the layout.
 */
const MEAL_A = 'bf73bf73-bf73-4bf7-8bf7-aaaaaaaaaaaa'
const MEAL_B = 'bf73bf73-bf73-4bf7-8bf7-bbbbbbbbbbbb'

async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const db = new Client({ connectionString: process.env.DATABASE_URL })
  await db.connect()
  try { return await fn(db) } finally { await db.end() }
}

const clean = (db: Client) => db.query('DELETE FROM saved_meals WHERE id = ANY($1)', [[MEAL_A, MEAL_B]])

test.beforeAll(async () => {
  await withDb(async db => {
    const { rows } = await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [SEED_EMAIL])
    const userId = rows[0]?.id
    expect(userId, `${SEED_EMAIL} is not seeded — run pnpm db:local`).toBeTruthy()
    await clean(db)
    await db.query(
      `INSERT INTO saved_meals (id, user_id, name, servings)
       VALUES ($1, $3, 'BF73 Action Row A', 1), ($2, $3, 'BF73 Action Row B', 1)`,
      [MEAL_A, MEAL_B, userId],
    )
  })
})

test.afterAll(async () => { await withDb(clean) })

/** `.click()` never lands on this screen — see water-log-write-path.spec.ts (Q-354). */
async function openLibrary(page: Page): Promise<void> {
  await page.goto('/nutrition')
  await settleRouteBoundary(page)
  const button = page.getByRole('button', { name: 'My Foods', exact: true })
  await expect(button).toBeVisible({ timeout: 60_000 })
  await expect(async () => {
    if (await page.getByRole('dialog').count() === 0) {
      const box = (await button.boundingBox())!
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
    }
    await expect(page.getByRole('button', { name: 'New', exact: true })).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 90_000 })
}

test('`New` fills the row and the bin stays square beside it', async ({ page }) => {
  await openLibrary(page)

  const New = page.getByRole('button', { name: 'New', exact: true })
  const bin = page.getByRole('button', { name: 'Delete meals' })
  await expect(New).toBeVisible()
  await expect(bin).toBeVisible()

  const newBox = await stableBox(New)
  const binBox = await stableBox(bin)

  // The hierarchy the owner asked for, as a ratio rather than a pixel count — a viewport change
  // must not fail this, only a layout that stops distinguishing the two controls.
  expect(newBox.width, `New (${newBox.width}) should dwarf the bin (${binBox.width})`)
    .toBeGreaterThan(binBox.width * 4)

  // The bin is square: shrinking the label to an icon was the request; shrinking the target is a
  // tap-floor regression, and this repo has a floor for exactly that reason.
  expect(Math.abs(binBox.width - binBox.height), 'the bin is no longer square').toBeLessThan(1)

  // Both sit on one row, so the bin cannot have wrapped under a full-width New.
  expect(Math.abs(newBox.y - binBox.y), 'New and the bin are on different rows').toBeLessThan(2)

  // And together they fill the row: 412 viewport, px-4 either side, gap-2 between.
  const viewport = page.viewportSize()!
  expect(newBox.width + binBox.width, 'the action row no longer fills its width')
    .toBeGreaterThan(viewport.width - 48)
})

/**
 * The floor, asserted on the rendered height rather than on the class.
 *
 * `h-11` is 44 px. Both controls compute 48 because of the global rule, and that is the only reason
 * they clear this repo's tap-target floor. A source-level check on the class would read 44 and call
 * it a violation; a check on the class list alone would read `h-11` and call it fine. Only the
 * rendered box tells the truth, which is the whole of LB-32's finding.
 */
test('the global tap floor is what lifts these controls to 48, not their own classes', async ({ page }) => {
  await openLibrary(page)

  for (const name of ['New', 'Delete meals']) {
    const control = page.getByRole('button', { name, exact: true })
    const box = await stableBox(control)
    expect(box.height, `${name} is ${box.height}px — under the 48dp tap floor`).toBeGreaterThanOrEqual(48)

    // The class says 44, so a 48 that came from the class rather than the floor would be a
    // different (and fine) implementation — this records which one is actually load-bearing today.
    const cls = await control.getAttribute('class')
    expect(cls, `${name} no longer carries h-11; re-read LB-32 before trusting the floor`).toContain('h-11')
  }
})

/**
 * The words BF-50 ④ shipped, which only the accessible name still carries.
 *
 * The owner could not tell what selection mode was for — *"you cant do anything with it except
 * delete"* — so `Delete meals` is the fix, and an icon-only control is defensible only while the
 * name survives. `aria-label="Delete"` would quietly undo it and look identical.
 */
test('the bin still announces itself as `Delete meals`, and deletes nothing on tap', async ({ page }) => {
  await openLibrary(page)

  const bin = page.getByRole('button', { name: 'Delete meals' })
  await expect(bin).toBeVisible()
  // Not merely "a button whose name contains Delete" — the exact wording is the fix.
  await expect(page.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0)

  const box = await stableBox(bin)
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)

  // It opens selection mode; the destructive confirm is still two steps away.
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible({ timeout: 10_000 })
  // Asserted on the data rather than on a dialog's absence: the library sheet is itself a `dialog`
  // and its accessible name contains the bin's own label, so a "no delete dialog" check matched the
  // sheet and failed for a reason that had nothing to do with deleting anything.
  await expect(page.getByText('BF73 Action Row A')).toBeVisible()
  await expect(page.getByText('BF73 Action Row B')).toBeVisible()
})
