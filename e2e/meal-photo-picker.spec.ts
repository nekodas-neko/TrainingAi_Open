import { test, expect, type Page } from '@playwright/test'
import { Client } from 'pg'
import { SEED_EMAIL, openSavedMeal, settleRouteBoundary, tapCentre } from './fixtures'

/**
 * The meal photo can be picked, and what gets stored is inside the cap (Q-327).
 *
 * `saved_meals.image_data_uri` has round-tripped through both routes, the outbox replay and the
 * local mirror since Q-396, and until now nothing on any screen could put a picture in it.
 *
 * **The assertion is on the STORED bytes, not on the preview.** The tile would show a picture just
 * as happily without the downscale — and the save would then be a 400 every time, because the server
 * rejects anything over `SAVED_MEAL_IMAGE_MAX_BYTES`. Feeding it a photo-sized JPEG and asserting the
 * row holds a WebP under 16 KB is what pins the part that can silently not happen.
 *
 * The picture is built in the page rather than committed as a fixture: it has to be big enough that
 * the downscale is doing real work, and a 1,200 × 900 gradient with noise is that without adding a
 * binary to the tree.
 *
 * Not exercised: the native path. `Capacitor.isNativePlatform()` is false in a browser, so this runs
 * the `<input type=file>` branch; the camera/gallery prompt is owed an on-device check.
 */

const MEAL_ID = 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1'
const FOOD_ID = 'c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2'
const MEAL_NAME = 'Spec Photo Meal'
const CAP_BYTES = 16 * 1024

async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const connectionString = process.env.DATABASE_URL
  expect(connectionString, 'DATABASE_URL must be set — see e2e/README.md').toBeTruthy()
  const db = new Client({ connectionString })
  await db.connect()
  try { return await fn(db) } finally { await db.end() }
}

async function cleanup(db: Client) {
  await db.query('DELETE FROM saved_meals WHERE id = $1', [MEAL_ID])
  await db.query('DELETE FROM food_items WHERE id = $1', [FOOD_ID])
}

// Serial because each test builds on the last one's stored photo. The raised timeout is for the
// first test only: it is the run's first visit to /nutrition, so it pays that route's cold compile
// on top of opening two sheets, and the default 45 s is spent before the sheet is even up.
test.describe.configure({ mode: 'serial', timeout: 120_000 })

test.beforeAll(async () => {
  await withDb(async db => {
    const { rows } = await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [SEED_EMAIL])
    const userId = rows[0]?.id
    expect(userId, `${SEED_EMAIL} is not seeded — run pnpm db:local`).toBeTruthy()
    await cleanup(db)
    await db.query(
      `INSERT INTO food_items (id, user_id, name, serving_size_g, calories, protein_g, carbs_g, fat_g, source)
       VALUES ($1, $2, 'Spec Photo Oats', 100, 120, 4.5, 20, 2, 'manual')`,
      [FOOD_ID, userId],
    )
    await db.query('INSERT INTO saved_meals (id, user_id, name, servings) VALUES ($1, $2, $3, 1)', [MEAL_ID, userId, MEAL_NAME])
    await db.query(
      'INSERT INTO saved_meal_items (saved_meal_id, food_item_id, quantity_multiplier) VALUES ($1, $2, 1)',
      [MEAL_ID, FOOD_ID],
    )
  })
})

test.afterAll(async () => { await withDb(cleanup) })

/**
 * A real CDP touch sequence, aimed at the middle of the viewport — `.click()` dispatches a
 * mouse-only sequence that never produces a `click` event on these screens (Q-354), and a control
 * merely scrolled into view can still sit under the fixed bottom nav.
 */
async function tap(page: Page, name: RegExp | string) {
  const target = page.getByRole('button', { name }).first()
  await expect(target).toBeVisible({ timeout: 30_000 })
  await target.evaluate(el => el.scrollIntoView({ block: 'center' }))
  await tapCentre(page, target)
}

/** Photo-sized JPEG straight into the sheet's file input, the way a gallery pick arrives. */
async function pickPhoto(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 1200
    canvas.height = 900
    const ctx = canvas.getContext('2d')!
    const grad = ctx.createLinearGradient(0, 0, 1200, 900)
    grad.addColorStop(0, '#c0392b')
    grad.addColorStop(1, '#27ae60')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, 1200, 900)
    // Noise, so the JPEG encoder cannot collapse a flat gradient into a few kilobytes and make the
    // downscale look unnecessary. Deterministic, because a spec that varies its own input by run is
    // a spec that fails by luck.
    for (let i = 0; i < 4000; i++) {
      ctx.fillStyle = `hsl(${(i * 37) % 360} 80% 50%)`
      ctx.fillRect((i * 61) % 1200, (i * 97) % 900, 6, 6)
    }
    const blob: Blob = await new Promise(r => canvas.toBlob(b => r(b!), 'image/jpeg', 0.95))
    const file = new File([blob], 'meal.jpg', { type: 'image/jpeg' })
    const dt = new DataTransfer()
    dt.items.add(file)
    // **By name, and still counted.** Since Q-395c the builder is reached through Log Food, whose
    // capture step carries TWO `image/*` inputs of its own — and they come first in DOM order, so
    // the naive first-match silently fed the photo to the food scanner and this spec failed 15 s
    // later looking for a size line that was never going to appear. BF-46 ①a added a second photo
    // picker (the meal's own screen), so `name` is what separates them now; the aria-hidden filter
    // is what separates the live layer from the ones underneath it, which Radix hides.
    const live = [...document.querySelectorAll('input[name="meal-photo"]')]
      .filter(el => !el.closest('[aria-hidden="true"]')) as HTMLInputElement[]
    // Loudly, not by picking one: filling the wrong box is exactly the failure LA-30 spent a
    // session on, and it reports as a broken assertion three steps further down.
    if (live.length !== 1) throw new Error(`expected one live photo input, found ${live.length}`)
    const input = live[0]
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return blob.size
  })
}

const storedImage = () => withDb(async db => {
  const { rows } = await db.query<{ image_data_uri: string | null }>(
    'SELECT image_data_uri FROM saved_meals WHERE id = $1', [MEAL_ID],
  )
  return rows[0]?.image_data_uri ?? null
})

async function openEditMeal(page: Page) {
  await page.goto('/nutrition')
  await settleRouteBoundary(page)
  // Re-tap only while the sheet is still closed. Retrying the tap unconditionally deadlocks: the
  // first one opens the dialog, the dialog then covers the "My Foods" button, and every later
  // attempt fails on a button that is no longer visible — which is what a slow list under a full
  // suite run turned into a hard failure, while the file passed alone every time.
  await expect(async () => {
    if (await page.getByRole('dialog').count() === 0) await tap(page, /^My Meals$/)
    await expect(page.getByText(MEAL_NAME)).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 90_000 })
  // BF-30 moved the row's actions onto the meal's own screen; open it first.
  await openSavedMeal(page, MEAL_NAME)
  await tap(page, `Edit ${MEAL_NAME}`)
  // **Wait for a BUILDER-only marker, not the picker.** Since BF-46 ①(a) the meal's own screen has a
  // real picker too, with the same accessible name, and it is still in the DOM while it closes — so
  // waiting for "Add a photo to <meal>" was satisfied by the screen this is leaving, and the pick
  // below went to it. Measured: `onChange` fired on the detail sheet's tile and never on the
  // builder's. `Update Meal` exists only in the builder.
  await expect(page.getByRole('button', { name: /^Update Meal$/ })).toBeVisible({ timeout: 20_000 })
  await expect(
    page.getByRole('button', { name: new RegExp(`^(Add a photo to|Change the photo on) ${MEAL_NAME}$`) }),
  ).toBeVisible({ timeout: 10_000 })
}

test('a picked photo is downscaled below the cap and stored with the meal', async ({ page }) => {
  await openEditMeal(page)
  expect(await storedImage(), 'the fixture meal starts with no photo').toBeNull()

  const sourceBytes = await pickPhoto(page)
  // Without this the downscale could be a no-op and the spec would still pass.
  expect(sourceBytes, 'the source photo must be far past the cap').toBeGreaterThan(CAP_BYTES * 4)

  // The tile prints the stored size — the cheapest tripwire for the cap slipping, and the reason it
  // is on screen at all.
  await expect(page.getByText(/^\d+\.\d KB$/)).toBeVisible({ timeout: 15_000 })

  await tap(page, /^Update Meal$/)

  await expect.poll(storedImage, { timeout: 20_000 }).not.toBeNull()
  const stored = (await storedImage())!
  expect(stored.startsWith('data:image/webp;base64,'), `stored as ${stored.slice(0, 30)}`).toBeTruthy()
  expect(Math.ceil(stored.slice(stored.indexOf(',') + 1).length * 0.75)).toBeLessThanOrEqual(CAP_BYTES)
})

test('the photo can be removed, and a rename on its own leaves it alone', async ({ page }) => {
  await openEditMeal(page)
  expect(await storedImage(), 'the previous test left a photo').not.toBeNull()

  // Saving without touching the tile must not clear the picture — the failure this guards is the
  // one where an edit screen sends `null` for anything the user did not re-enter.
  await tap(page, /^Update Meal$/)
  await expect(page.getByText(MEAL_NAME)).toBeVisible({ timeout: 15_000 })
  expect(await storedImage(), 'a save that never touched the tile must keep the photo').not.toBeNull()

  await openEditMeal(page)
  await tap(page, /^Remove meal photo$/)
  await tap(page, /^Update Meal$/)
  await expect.poll(storedImage, { timeout: 20_000 }).toBeNull()
})

test('the meal\'s own screen picks a photo too — it used to say "Add a photo" and open the builder', async ({ page }) => {
  // BF-46 ①(a). The hero on a meal's own screen called `onEdit`: it said `Add a photo` and dropped
  // you into the builder to find a 64 px tile at the bottom of a scroll. The owner reached for it
  // three times — *"the photo still doesnt get added from this screen at the top"* — and it was
  // never a picker at all. It is one now, writing through the same `saveMealToLibrary` the builder
  // calls, so there is still exactly one write path to `image_data_uri`.
  expect(await storedImage(), 'the previous test cleared the photo').toBeNull()

  await page.goto('/nutrition')
  await settleRouteBoundary(page)
  await expect(async () => {
    if (await page.getByRole('dialog').count() === 0) await tap(page, /^My Meals$/)
    await expect(page.getByText(MEAL_NAME)).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 90_000 })
  await openSavedMeal(page, MEAL_NAME)

  // `Log this meal` is on the meal's own screen and nowhere else, so it says which screen this is
  // without relying on the picker — the mistake the first test's gate made.
  await expect(page.getByRole('button', { name: /Log this meal/i })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('button', { name: `Add a photo to ${MEAL_NAME}` })).toBeVisible()

  await pickPhoto(page)

  // The assertion is the stored row, not the hero: this screen paints optimistically, so the band
  // would show a picture just as happily with nothing behind it.
  await expect.poll(storedImage, { timeout: 20_000 }).not.toBeNull()
  const stored = (await storedImage())!
  expect(stored.startsWith('data:image/webp;base64,'), `stored as ${stored.slice(0, 30)}`).toBeTruthy()
  expect(Math.ceil(stored.slice(stored.indexOf(',') + 1).length * 0.75)).toBeLessThanOrEqual(CAP_BYTES)
})
