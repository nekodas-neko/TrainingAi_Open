import { test, expect, type Page, type Locator } from '@playwright/test'
import { Client } from 'pg'
import { SEED_EMAIL, settleRouteBoundary, swipeRowLeft } from './fixtures'

/**
 * A logged food swipes left to a Delete that lands on the confirmation (BF-45 ⑤).
 *
 * The owner asked for the gesture the meal library already has: *"for logging food; we could
 * possibly add the option to swipe and delete it (with confirmation) like we do in the other
 * screen."* The tray is `SwipeActions`, shared with `saved-meal-card.tsx`, so the drag maths is
 * already unit-tested — what is new is the wiring, and the wiring is where a swipe turns into a
 * delete with nothing in between.
 *
 * **The assertion that matters is the row still being in the database while the dialog is up.** A
 * tray wired straight to `handleConfirmDelete` would look identical on screen: this app removes the
 * row optimistically, before the request resolves, either way.
 *
 * **The row is dragged on YESTERDAY, not today, and that is the point of the second test.** The
 * nutrition scroll container carries its own horizontal `useDrag` that steps the day, so one touch
 * fed both gestures — measured 2026-08-30, before the `[data-swipe-actions]` bail. On *today* the
 * next-day step is a no-op and the conflict is invisible, which is exactly how this would have
 * shipped.
 *
 * **And the bin stays.** A swipe is an accelerator for a thumb that knows it is there; a row whose
 * only route to delete is a horizontal drag is not shippable on a touch-only product — which is
 * what `SwipeActions` says in its own doc comment, and what the last test pins.
 */

const ITEM_ID = '77777777-7777-4777-8777-777777777771'
const FOOD = 'Spec Swipe Yoghurt'

async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const connectionString = process.env.DATABASE_URL
  expect(connectionString, 'DATABASE_URL must be set — see e2e/README.md').toBeTruthy()
  const db = new Client({ connectionString })
  await db.connect()
  try { return await fn(db) } finally { await db.end() }
}

async function cleanup(db: Client) {
  await db.query('DELETE FROM food_logs WHERE food_item_id = $1', [ITEM_ID])
  await db.query('DELETE FROM food_items WHERE id = $1', [ITEM_ID])
}

/**
 * One log, `daysAgo` days back **in the user's own timezone**, read off their row — never
 * `current_date`, which is the server's UTC day and is the previous one for ten hours out of every
 * twenty-four in Brisbane.
 */
async function seedLog(db: Client, daysAgo: number): Promise<void> {
  const { rows } = await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [SEED_EMAIL])
  const userId = rows[0]?.id
  expect(userId, `${SEED_EMAIL} is not seeded — run pnpm db:local`).toBeTruthy()
  await cleanup(db)
  await db.query(
    `INSERT INTO food_items (id, user_id, name, calories, protein_g, carbs_g, fat_g, serving_size_g, source)
     VALUES ($1, $2, $3, 120, 11, 9, 4, 170, 'manual')`,
    [ITEM_ID, userId, FOOD],
  )
  await db.query(
    `INSERT INTO food_logs (user_id, date, meal_type_id, food_item_id, quantity_multiplier, logged_at)
     SELECT $1,
            to_char((now() AT TIME ZONE u.timezone) - ($3 || ' days')::interval, 'YYYY-MM-DD'),
            (SELECT id FROM meal_types WHERE user_id = $1 ORDER BY sort_order LIMIT 1),
            $2, 1.0, now() - ($3 || ' days')::interval
       FROM users u WHERE u.id = $1`,
    [userId, ITEM_ID, daysAgo],
  )
}

/**
 * Live rows only. `deleteFoodLog` writes a `deleted_at` tombstone rather than removing the row —
 * cross-device deletes travel through `getSyncDelta` and a hard DELETE is invisible to a device
 * that has not synced — so a count that ignores it reports 1 forever and calls a working delete a
 * failure.
 */
const logCount = () => withDb(async db =>
  (await db.query('SELECT 1 FROM food_logs WHERE food_item_id = $1 AND deleted_at IS NULL', [ITEM_ID])).rowCount)

test.describe.configure({ mode: 'serial' })
test.afterAll(async () => { await withDb(cleanup) })

/**
 * Hide the Next.js dev overlay. It mounts a `<nextjs-portal>` over the bottom-left corner — where
 * the diary's own rows sit — and a coordinate tap that clips it opens its Route/Turbopack menu,
 * which then covers the screen. `fixtures.ts` already works around the same portal intercepting
 * `locator.tap()`; this removes it instead. Dev-only chrome, so nothing under test is hidden.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const paint = () => {
      const style = document.createElement('style')
      style.textContent = 'nextjs-portal{display:none!important}'
      document.head.appendChild(style)
    }
    if (document.head) paint()
    else document.addEventListener('DOMContentLoaded', paint)
  })
})

const diaryRow = (page: Page) => page.getByRole('button', { name: new RegExp(`^${FOOD}`) }).first()


/**
 * A coordinate tap, not `locator.tap()`. The dev-only Next.js error overlay mounts a
 * `<nextjs-portal>` over the bottom-left corner and Playwright's actionability check refuses to
 * tap "through" it, which is where the edit sheet's bin sits — a harness block that reads as an
 * unreachable control (see `fixtures.ts`, which reaches for the same escape hatch).
 */
async function tapAt(page: Page, target: Locator) {
  await expect(target).toBeVisible({ timeout: 10_000 })
  // Centre it first. A diary row's natural position here is under the bottom tab bar, so the
  // coordinate tap lands on a nav icon and switches tab — which looks exactly like a dead control.
  await target.evaluate(el => el.scrollIntoView({ block: 'center' }))
  await page.waitForTimeout(250)
  const box = (await target.boundingBox())!
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
}

/**
 * Tap, re-measuring until `expected` shows up. `SheetContent` slides in over `duration-500`, so a
 * control inside one is *visible* half a second before it is where `boundingBox()` last said it
 * was — a single measured tap lands on the void it is travelling through, silently.
 */
async function tapUntil(page: Page, target: Locator, expected: Locator) {
  await expect(async () => {
    if (await expected.count() === 0) await tapAt(page, target)
    await expect(expected).toBeVisible({ timeout: 3_000 })
  }).toPass({ timeout: 30_000 })
}

/** Yesterday's diary, reached by the header chevron rather than by a drag. */
async function openYesterday(page: Page) {
  await page.goto('/nutrition')
  await settleRouteBoundary(page)
  await page.getByRole('button', { name: 'Previous day' }).click()
  await expect(page.getByText('Yesterday', { exact: true })).toBeVisible({ timeout: 20_000 })
}

test('a swipe reveals Delete, and Delete asks before it deletes', async ({ page }) => {
  await withDb(db => seedLog(db, 1))
  await openYesterday(page)

  const row = diaryRow(page)
  await expect(row).toBeVisible({ timeout: 30_000 })
  await swipeRowLeft(page, row, { centreFirst: true, releaseWithPoint: true })

  await tapAt(page, page.getByRole('button', { name: `Delete ${FOOD}` }))

  await expect(page.getByRole('heading', { name: 'Delete food log?' })).toBeVisible()
  expect(await logCount(), 'the drag deleted the entry with no confirmation').toBe(1)

  await tapAt(page, page.getByRole('button', { name: 'Delete', exact: true }))
  await expect.poll(logCount, { timeout: 15_000 }).toBe(0)
})

/**
 * BF-61 — the first tap on Delete must work.
 *
 * The owner reported needing two presses and confirmed the cause by waiting: *"if I wait a second
 * it works."* The row carries `transition: transform 0.22s`, and hit-testing follows the **animated**
 * transform, so while the row is sliding out it is still physically over part of the tray. A tap in
 * that window lands on the row, which swallows it; the second tap, after the settle, reaches the
 * button.
 *
 * **The transition is lengthened to make a timing bug deterministic.** Left at 220 ms the window is
 * narrower than one protocol round-trip on a loaded runner, so the tap would sometimes land after
 * the settle and the test would pass whether or not the bug was fixed — a false green, which is
 * worse than no test. Only the DURATION is changed; the fix under test (stacking the tray above the
 * row while open) is duration-independent, and removing it fails this in both directions.
 *
 * The tap point is computed from the row's own box rather than measured off the button, because a
 * measurement is a round-trip and the point of this test is not to spend one.
 */
test('the first tap on Delete opens the confirmation, even mid-animation', async ({ page }) => {
  await withDb(db => seedLog(db, 1))
  await openYesterday(page)
  await page.addStyleTag({ content: '[data-swipe-actions] > div:last-child { transition-duration: 6s !important }' })

  const row = diaryRow(page)
  await expect(row).toBeVisible({ timeout: 30_000 })
  const box = (await row.boundingBox())!
  // 36 px rests the row open on DISTANCE (past half the 64 px tray) rather than on velocity, which
  // is what leaves it SHORT of its resting offset and sweeping across the tray on the way. A fast
  // flick would be the same gesture in life, but `@use-gesture`'s velocity over a CDP-paced drag
  // lands under `FLICK_VELOCITY` and the row snaps closed instead — measured, and it made the first
  // version of this test fail for the wrong reason.
  await swipeRowLeft(page, row, { distance: 36, centreFirst: true, releaseWithPoint: true })

  // Deep inside the tray, not at its centre: the row uncovers the tray right-edge first, so a point
  // 52 px in stays under the row for most of the slide while a point 32 px in is clear almost at
  // once. One action, `ACTION_WIDTH` = 64, pinned right — see `swipe-actions-math.ts`.
  const after = (await row.boundingBox())!
  await page.touchscreen.tap(box.x + box.width - 52, after.y + after.height / 2)

  await expect(
    page.getByRole('heading', { name: 'Delete food log?' }),
    'the tap landed on the row instead of the tray — the row is still over it while it slides',
  ).toBeVisible({ timeout: 5_000 })
  expect(await logCount(), 'the tap deleted the entry with no confirmation').toBe(1)
})

test('the drag opens the tray without also stepping the diary to the next day', async ({ page }) => {
  await withDb(db => seedLog(db, 1))
  await openYesterday(page)

  const row = diaryRow(page)
  await expect(row).toBeVisible({ timeout: 30_000 })
  await swipeRowLeft(page, row, { centreFirst: true, releaseWithPoint: true })

  await expect(page.getByRole('button', { name: `Delete ${FOOD}` })).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('Yesterday', { exact: true })).toBeVisible()
})

test('the bin inside the edit sheet is still the visible route to the same delete', async ({ page }) => {
  await withDb(db => seedLog(db, 1))
  await openYesterday(page)

  const row = diaryRow(page)
  await expect(row).toBeVisible({ timeout: 30_000 })
  const bin = page.getByRole('button', { name: `Remove ${FOOD}` })
  await tapUntil(page, row, bin)

  const confirm = page.getByRole('heading', { name: 'Delete food log?' })
  await tapUntil(page, bin, confirm)
  expect(await logCount(), 'the bin deleted the entry with no confirmation').toBe(1)
})
