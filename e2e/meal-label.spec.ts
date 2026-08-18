import { test, expect } from '@playwright/test'
import { Client } from 'pg'
import { SEED_EMAIL, settleRouteBoundary } from './fixtures'
import { encodeMealLabelToken } from '@trainingai/shared/nutrition/label-payload'

/**
 * Q-389 — the printable saved-meal label.
 *
 * **What this guards, and what it deliberately does not.** The figures-agree-with-the-write-path
 * assertion — the one real bug this feature could ship — is a unit test
 * (`packages/shared/src/nutrition/__tests__/label-payload.test.ts`), because it is arithmetic and
 * belongs where it can be asserted precisely. This spec guards the half a unit test cannot reach:
 * that the sheet opens, that the canvas is actually *drawn on* rather than left blank, and that
 * every style renders. A canvas that silently fails to paint is the failure mode here — the label
 * is generated at print time, so a blank one is discovered on paper.
 *
 * **Mutation-checked**: replacing `renderMealLabel`'s body with a no-op leaves the canvas blank and
 * the "is it painted" assertion fails. Asserting only that the sheet opens would pass in that case,
 * which is why the pixel check exists.
 *
 * The seed has no saved meals (`saved_meals` is empty after `pnpm db:local`), so the spec creates
 * one directly and removes it afterwards — the same shape as `zero-data.setup.ts`, and for the same
 * reason: `setup.sh` will not re-seed a database that already has users.
 */

const escapeRe = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Decode a QR out of raw canvas pixels, in Node.
 *
 * `@zxing/browser` cannot be imported into the page (bare specifiers do not resolve there) and needs
 * a DOM anyway; its pure-JS core does neither, so the pixels come out and the decode happens here.
 */
function decodeQr({ w, h, data }: { w: number; h: number; data: number[] }): string | null {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const {
    RGBLuminanceSource, BinaryBitmap, HybridBinarizer, MultiFormatReader, BarcodeFormat, DecodeHintType,
  } = require('@zxing/library')
  // RGBLuminanceSource wants one packed int per pixel, not the RGBA byte quad the canvas hands over.
  const luminances = new Int32Array(w * h)
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    luminances[p] = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2]
  }
  const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(luminances, w, h)))
  const reader = new MultiFormatReader()
  reader.setHints(new Map<unknown, unknown>([[DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]]]))
  try {
    return reader.decode(bitmap).getText()
  } catch {
    return null
  }
}

test.setTimeout(180_000)

const DB = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5433/trainingai_dev'
const MEAL_NAME = 'E2E Label Meal'
/** Filled by beforeAll; the token the label's QR must decode to. */
let expectedToken = ''
const FOOD_PREFIX = 'E2E Label Ingredient'

async function withDb<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: DB })
  await c.connect()
  try { return await fn(c) } finally { await c.end() }
}

test.beforeAll(async () => {
  await withDb(async c => {
    const { rows } = await c.query('SELECT id FROM users WHERE email = $1', [SEED_EMAIL])
    const userId = rows[0]?.id
    if (!userId) throw new Error(`seed user ${SEED_EMAIL} missing — run pnpm db:local`)

    await c.query('DELETE FROM saved_meals WHERE user_id = $1 AND name = $2', [userId, MEAL_NAME])

    // servings = 2 on purpose: it is the case where printing `totals` directly would show double
    // what scanning the label logs, so the rendered label is drawn from the interesting branch.
    const meal = await c.query(
      'INSERT INTO saved_meals (user_id, name, servings) VALUES ($1, $2, 2) RETURNING id',
      [userId, MEAL_NAME],
    )
    // EIGHT ingredients, not one. The centred layout derives how many lines fit between the macros
    // and the bottom-anchored code, and a one-ingredient meal can never overflow that gap — so a
    // thin fixture cannot tell a derived line count from a hardcoded one. Proven: with a single
    // ingredient the whole suite still passed after the derivation was reverted to a hardcoded five,
    // which is exactly the collision it exists to prevent.
    for (let i = 0; i < 8; i++) {
      const food = await c.query(
        `INSERT INTO food_items (user_id, name, serving_size_g, calories, protein_g, carbs_g, fat_g, source)
         VALUES ($1, $2, 30, 120, 25, 2, 1, 'manual') RETURNING id`,
        [userId, `${FOOD_PREFIX} ${i}`],
      )
      await c.query(
        'INSERT INTO saved_meal_items (saved_meal_id, food_item_id, quantity_multiplier) VALUES ($1, $2, 2)',
        [meal.rows[0].id, food.rows[0].id],
      )
    }
    expectedToken = encodeMealLabelToken(meal.rows[0].id)
  })
})

test.afterAll(async () => {
  await withDb(async c => {
    await c.query('DELETE FROM saved_meals WHERE name = $1', [MEAL_NAME])
    await c.query(`DELETE FROM food_items WHERE name LIKE $1`, [`${FOOD_PREFIX}%`])
  })
})

test('a saved meal renders a printable label in every style', async ({ page }) => {
  const errors: string[] = []
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', e => errors.push(String(e)))
  await page.goto('/nutrition')
  await settleRouteBoundary(page)

  // The nutrition screen opens the saved-meals sheet directly; going via the food logger would
  // test that route rather than this one.
  //
  // `touchscreen.tap()`, not `.click()`, and this spec found out the hard way: `.click()` on this
  // screen's action row silently does nothing. That is Q-354 — the date-swipe `useDrag` binding
  // swallows MOUSE clicks here while touch is unaffected — and `water-log-write-path.spec.ts`
  // carries the full measurement. Touch is the only input the supported runtime produces anyway, so
  // tapping is both the fix and the more faithful test.
  const savedMeals = page.getByRole('button', { name: 'Saved Meals', exact: true })
  await expect(savedMeals).toBeVisible({ timeout: 60_000 })

  // Retried: a tap fired before React has attached the handler does nothing, silently. Opening the
  // sheet is idempotent, so a retry cannot toggle it shut.
  const labelButton = page.getByRole('button', { name: `Print a label for ${MEAL_NAME}` })
  await expect(async () => {
    const box = (await savedMeals.boundingBox())!
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
    await expect(labelButton).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 90_000 })

  await labelButton.tap()

  const canvas = page.getByRole('img', { name: `Printable label for ${MEAL_NAME}` })
  await expect(canvas).toBeVisible({ timeout: 30_000 })

  // The sheet reports the code's physical size, which is the number the whole print risk is about.
  await expect(page.getByText(/mm at 25×25 modules/), `console: ${errors.join(' | ')}`).toBeVisible()

  /** Is the canvas actually painted? A blank one is white everywhere; a drawn label has ink. */
  const inkFraction = async () => canvas.evaluate((el: HTMLCanvasElement) => {
    const ctx = el.getContext('2d')!
    const { data } = ctx.getImageData(0, 0, el.width, el.height)
    let dark = 0
    for (let i = 0; i < data.length; i += 4) if (data[i] < 128) dark++
    return dark / (data.length / 4)
  })

  // Every style must paint. Black band is the default and is checked first because it is also the
  // one whose code is tightest, so a regression there matters most. "Square" is Q-393's ingredient
  // layout, which takes a different draw path entirely — it would be the easiest one to break
  // silently, since it is the only style that renders from a second data source.
  for (const style of ['Black band', 'Editorial', 'Deli ticket', 'Plaque', 'Square · centred', 'Square · big code']) {
    await page.getByRole('radio', { name: new RegExp(escapeRe(style), 'i') }).click()
    await expect
      .poll(inkFraction, { message: `${style} should paint ink onto the canvas`, timeout: 20_000 })
      .toBeGreaterThan(0.01)
  }

  // **Does the code actually survive the layout?** The canvas pixels are pulled into Node and
  // decoded with zxing's pure-JS core — the same decoder family the in-app scanner uses. This is the
  // closest the sandbox gets to the print test that is still owed: it says nothing about ink spread
  // on paper, but it proves the symbol is complete, unobstructed and resolves to THIS meal at every
  // layout. It matters most for the two square styles, whose ingredient list is drawn directly above
  // the code — an earlier version of the centred layout ran the list into it, and a covered code
  // still looks like a code.
  for (const style of ['Black band', 'Plaque', 'Square · centred', 'Square · big code']) {
    await page.getByRole('radio', { name: new RegExp(escapeRe(style), 'i') }).click()
    await expect.poll(inkFraction, { timeout: 20_000 }).toBeGreaterThan(0.01)

    const shot = await canvas.evaluate((el: HTMLCanvasElement) => {
      const ctx = el.getContext('2d')!
      const d = ctx.getImageData(0, 0, el.width, el.height)
      return { w: el.width, h: el.height, data: Array.from(d.data) }
    })

    const text = decodeQr(shot)
    expect(text, `${style}'s code must decode off the rendered label`).toBeTruthy()
    expect(text, `${style}'s code must resolve to this meal`).toBe(expectedToken)
  }

  // Q-393. The square style is the only one that prints the ingredient breakdown, and it is the
  // only one that renders from a second data source — so it is the easiest to break silently. This
  // asserts the list actually reached the paper: an earlier version checked only that the canvas had
  // ink and that the square-only warning showed, and BOTH still passed with the ingredient path
  // switched off, because the style then fell through to the round painter. Mutation-checked.
  // Eight ingredients against a layout that fits fewer, so this also asserts the overflow is
  // SUMMARISED rather than dropped — and that the count reported matches what was drawn.
  await expect(
    page.getByText(/Printing \d+ ingredients — \d+ more (is|are) summarised/),
    'the square style must report what it drew and what it could not fit',
  ).toBeVisible({ timeout: 20_000 })

  // The square style spends the corners, so a round die crops the list. The app has to say so
  // rather than let that happen silently, and this is the assertion that keeps it saying so.
  await expect(
    page.getByRole('status').filter({ hasText: /Square dies only/i }),
    'a square-only layout must warn that a round die crops it',
  ).toBeVisible()
})
