import { test, expect } from '@playwright/test'
import { Client } from 'pg'
import { SEED_EMAIL, settleRouteBoundary } from './fixtures'

/**
 * BF-27: the Android back gesture closes the surface on top, on sheets and dialogs that were never
 * individually wired for it.
 *
 * Before this, `useSheetBackDismiss` was imported by **5 of 45** sheet files and **0 of 6** dialog
 * files; everywhere else back was handled by the WebView, which navigated the page underneath away.
 * The hook now lives in `SheetContent`/`DialogContent` via `components/ui/back-dismiss.tsx`, so the
 * two surfaces here are covered by the primitive rather than by anything in their own source —
 * which is exactly why they are the ones worth asserting on. Neither file mentions back dismissal.
 *
 * `sheet-back-dismiss.spec.ts` still guards the harder case the hook was written for (a sheet that
 * MOUNTS already-open, under StrictMode) and the one-entry-per-open invariant. This file guards the
 * sweep's reach.
 */

const SESSION_ID = '7e7e7e7e-7e7e-4e7e-8e7e-7e7e7e7e7e7e'
const MEAL_ID = '7e7e7e7e-7e7e-4e7e-8e7e-1b1b1b1b1b1b'
const MEAL_FOOD_ID = '7e7e7e7e-7e7e-4e7e-8e7e-2b2b2b2b2b2b'
const MEAL_NAME = 'Back Sweep Nest Meal'
const EXERCISE = 'Spec Back Sweep Press'
// A fixed past day: nothing here is compared against the clock on either side.
const DAY = '2026-08-14'

async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const connectionString = process.env.DATABASE_URL
  expect(connectionString, 'DATABASE_URL must be set — see e2e/README.md').toBeTruthy()
  const db = new Client({ connectionString })
  await db.connect()
  try { return await fn(db) } finally { await db.end() }
}

async function cleanup(db: Client) {
  await db.query(
    `DELETE FROM set_logs WHERE exercise_log_id IN (SELECT id FROM exercise_logs WHERE workout_session_id = $1)`,
    [SESSION_ID],
  )
  await db.query('DELETE FROM exercise_logs WHERE workout_session_id = $1', [SESSION_ID])
  await db.query('DELETE FROM workout_sessions WHERE id = $1', [SESSION_ID])
  await db.query('DELETE FROM saved_meal_items WHERE saved_meal_id = $1', [MEAL_ID])
  await db.query('DELETE FROM saved_meals WHERE id = $1', [MEAL_ID])
  await db.query('DELETE FROM food_items WHERE id = $1', [MEAL_FOOD_ID])
}

/** Counts the row the delete dialog would remove — the dialog's own state would agree either way. */
async function liveLogs(): Promise<number> {
  return withDb(async db => {
    const { rows } = await db.query<{ n: string }>(
      `SELECT count(*) AS n FROM exercise_logs
        WHERE workout_session_id = $1 AND exercise_name = $2 AND deleted_at IS NULL`,
      [SESSION_ID, EXERCISE],
    )
    return Number(rows[0].n)
  })
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  await withDb(async db => {
    const { rows } = await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [SEED_EMAIL])
    const userId = rows[0]?.id
    expect(userId, `${SEED_EMAIL} is not seeded — run pnpm db:local`).toBeTruthy()
    await cleanup(db)

    await db.query(
      `INSERT INTO workout_sessions (id, session_name, started_at, completed_at, user_id)
       VALUES ($1, 'Spec Back Sweep Session', '2026-08-13 22:00:00+00', '2026-08-13 22:45:00+00', $2)`,
      [SESSION_ID, userId],
    )
    const { rows: [log] } = await db.query<{ id: string }>(
      `INSERT INTO exercise_logs (workout_session_id, exercise_name, logged_at, muscle_groups)
       VALUES ($1, $2, '2026-08-13 22:20:00+00', '{chest}') RETURNING id`,
      [SESSION_ID, EXERCISE],
    )
    await db.query(
      `INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps)
       SELECT $1, n, 50, 8 FROM generate_series(1, 3) n`,
      [log.id],
    )

    // A meal of this file's own, so the three-layer test does not depend on the seed happening to
    // carry one — an empty list would make it pass by never reaching layer three.
    await db.query(
      `INSERT INTO food_items (id, user_id, name, calories, protein_g, carbs_g, fat_g, serving_size_g, source)
       VALUES ($1, $2, 'Back Sweep Oats', 200, 8, 34, 4, 60, 'manual')`,
      [MEAL_FOOD_ID, userId],
    )
    await db.query(
      `INSERT INTO saved_meals (id, user_id, name, servings) VALUES ($1, $2, $3, 1)`,
      [MEAL_ID, userId, MEAL_NAME],
    )
    await db.query(
      `INSERT INTO saved_meal_items (id, saved_meal_id, food_item_id, quantity_multiplier)
       VALUES (gen_random_uuid(), $1, $2, 1)`,
      [MEAL_ID, MEAL_FOOD_ID],
    )
  })
})

test.afterAll(async () => { await withDb(cleanup) })

type Page = import('@playwright/test').Page

/**
 * A real CDP touch sequence, not `.click()` — the mouse path dispatches no `click` event on these
 * screens (Q-354, written up on `water-log-write-path.spec.ts`). Retried because a tap fired before
 * React has attached the handler does nothing, silently, and CI starts the dev server cold. Safe to
 * repeat: every control here opens a surface, so a second tap re-opens rather than toggling shut.
 */
async function tapUntilOpen(page: Page, selector: string): Promise<void> {
  const target = page.locator(selector)
  await expect(target).toBeVisible({ timeout: 30_000 })
  await expect(async () => {
    const box = (await target.boundingBox())!
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 3_000 })
  }).toPass({ timeout: 60_000 })
}

test('back closes a sheet that was never wired for it, and stays on the page', async ({ page }) => {
  await page.goto(`/health/day?date=${DAY}`)
  await settleRouteBoundary(page)

  const before = await page.evaluate(() => history.length)
  await tapUntilOpen(page, `button[aria-label="${EXERCISE} history"]`)
  // One entry per open, not two: the primitive owns this now, and a sheet that also kept its own
  // call would push twice and need two presses.
  expect(await page.evaluate(() => history.length)).toBe(before + 1)

  await page.goBack()
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 10_000 })
  expect(new URL(page.url()).pathname).toBe('/health/day')
})

test('back cancels a confirm dialog rather than confirming it', async ({ page }) => {
  expect(await liveLogs()).toBe(1)

  await page.goto(`/health/day?date=${DAY}`)
  await settleRouteBoundary(page)
  await tapUntilOpen(page, `button[aria-label="Delete ${EXERCISE}"]`)

  await page.goBack()
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 10_000 })
  expect(new URL(page.url()).pathname).toBe('/health/day')

  // The point of extending this to dialogs at all. Back reaches each dialog through Radix's
  // `onOpenChange(false)` — the same path as Cancel and the X — so it can only ever take the cancel
  // arm. Asserted on the DATABASE because a dialog that closed and a dialog that deleted look
  // identical on screen.
  expect(await liveLogs()).toBe(1)
})

/**
 * The nest, as LB-16 left it: Log Food IS the list, and a meal opens on top of it.
 *
 * **This used to be three layers and is now two**, which is the change rather than a loss of cover.
 * `Add food` opened a logger whose capture step was a grid of tiles, one of which opened the list as
 * a SECOND sheet; the list is the capture screen now, so that middle layer is gone. The three-deep
 * case `useSheetBackDismiss` was wrong at is asserted directly, without a browser, in
 * `lib/hooks/__tests__/sheet-back-stack.test.ts` — seven cases including the sibling swap and the
 * StrictMode double-mount, none of which a coordinate tap could reach reliably.
 *
 * Asserted press-by-press rather than by counting dialogs: Radix aria-hides every covered layer, so
 * `getByRole('dialog')` sees exactly one whatever the depth is, and a collapse looks identical to a
 * correct unwind until you ask what is on screen.
 */
test('back closes the meal on top of the list and leaves the list open', async ({ page }) => {
  await page.goto('/nutrition')
  await settleRouteBoundary(page)
  const before = await page.evaluate(() => history.length)

  // The tab shell mounts several panels at once, so DOM order is not screen order and
  // `getByRole(...).first()` resolves into an off-screen panel — where a tap lands on the carousel
  // and switches tabs instead. Pick the one whose box is actually within the viewport.
  //
  // The aria-hidden filter matters as much as the box does: Radix marks everything outside the open
  // dialog `aria-hidden`, and portals append to `<body>`, so the page's own controls come FIRST in
  // DOM order while being exactly the "not on screen" the box test cannot see.
  const clickInView = async (name: string) => {
    const handle = await page.evaluateHandle((n) => {
      const match = [...document.querySelectorAll('button')]
        .filter(b => (b.getAttribute('aria-label') || b.textContent || '').trim() === n)
        .filter(b => !b.closest('[aria-hidden="true"]'))
      return match.find(e => {
        const r = e.getBoundingClientRect()
        return r.width > 0 && r.x >= 0 && r.x < window.innerWidth
      }) ?? null
    }, name)
    await handle.evaluate(el => (el as HTMLElement | null)?.click())
  }

  await expect(async () => {
    await clickInView('Add food')
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 3_000 })
  }).toPass({ timeout: 60_000 })
  expect(await page.evaluate(() => history.length)).toBe(before + 1)

  // A tab switch is not a navigation. Worth asserting rather than assuming: if the tabs ever pushed
  // an entry, back would spend presses on them and the unwind below would silently stop matching
  // what the user sees.
  await expect(async () => {
    await clickInView('My Foods')
    await expect(page.getByPlaceholder('Filter your meals')).toBeVisible({ timeout: 3_000 })
  }).toPass({ timeout: 60_000 })
  expect(await page.evaluate(() => history.length)).toBe(before + 1)

  // Layer two: a meal opens its own screen. `.click()` never lands on this screen (Q-354), so the
  // row is tapped by coordinate — and its box is re-measured inside the retry, because the list
  // paints from cache first and re-sorts what is under the finger when the fetch lands.
  const opened = page.getByRole('button', { name: 'Log this meal' })
  await expect(async () => {
    const row = page.getByRole('button', { name: new RegExp(`^${MEAL_NAME}`) }).first()
    await expect(row).toBeVisible({ timeout: 3_000 })
    const box = (await row.boundingBox())!
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
    await expect(opened).toBeVisible({ timeout: 3_000 })
  }).toPass({ timeout: 60_000 })
  await expect(opened).toBeInViewport()
  expect(await page.evaluate(() => history.length)).toBe(before + 2)

  // One press: the meal goes, the list stays. Radix aria-hides the covered sheet, so the assertion
  // that the list SURVIVED is its content coming back, not a dialog count.
  await page.goBack()
  await expect(opened).toHaveCount(0, { timeout: 10_000 })
  await expect(page.getByPlaceholder('Filter your meals')).toBeVisible({ timeout: 10_000 })
  expect(new URL(page.url()).pathname).toBe('/nutrition')

  // Two: the screen goes, and only now does the page underneath give way to nothing.
  await page.goBack()
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 10_000 })
  expect(new URL(page.url()).pathname).toBe('/nutrition')
})
