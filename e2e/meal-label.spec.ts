import { test, expect } from '@playwright/test'
import { Client } from 'pg'
import { SEED_EMAIL, openSavedMeal, settleRouteBoundary } from './fixtures'
import { encodeMealLabelToken } from '@trainingai/shared/nutrition/label-payload'
import { readPngDensity } from '@trainingai/shared/nutrition/png-density'
import { readFileSync } from 'node:fs'

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
  const savedMeals = page.getByRole('button', { name: 'My Foods', exact: true })
  await expect(savedMeals).toBeVisible({ timeout: 60_000 })

  // Retried: a tap fired before React has attached the handler does nothing, silently. Opening the
  // sheet is idempotent, so a retry cannot toggle it shut.
  const labelButton = page.getByRole('button', { name: `Print a label for ${MEAL_NAME}` })
  await expect(async () => {
    const box = (await savedMeals.boundingBox())!
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
    // BF-30 moved the row's actions onto the meal's own screen; open it first.
    await openSavedMeal(page, MEAL_NAME)
    await expect(labelButton).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 90_000 })

  await labelButton.tap()

  const canvas = page.getByRole('img', { name: `Printable label for ${MEAL_NAME}` })
  await expect(canvas).toBeVisible({ timeout: 30_000 })

  // Select the style explicitly rather than trusting what the sheet opens on: since Q-400 the pick
  // is remembered in `localStorage`, so "the default" is only what a browser that has never chosen
  // one shows. The 25×25 figure below belongs to this style, not to whatever was last used.
  await page.getByRole('radio', { name: /Ingredients · centred/i }).click()

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
  for (const style of ['Ingredients · centred', 'Black band', 'Editorial', 'Deli ticket', 'Plaque', 'Big code']) {
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
  for (const style of ['Ingredients · centred', 'Black band', 'Plaque', 'Big code']) {
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
  //
  // **The `[2-9]` lower bound is deliberate, and it earned its place.** It was `\d+` and passed only
  // because the sheet's copy is pluralised: Q-411 raised this style's `codeUnits` from 70 to 90,
  // which took the list from three of the eight to ONE, and the assertion failed on the singular
  // "1 ingredient" rather than on the count. That was luck. A style whose picker note promises the
  // breakdown printing one line of eight is the Q-399 failure this file exists to catch, so the
  // floor is now stated rather than left to English grammar.
  await expect(
    page.getByText(/Printing [2-9]\d* ingredients — \d+ more (is|are) summarised/),
    'the square style must print several ingredients and report what it could not fit',
  ).toBeVisible({ timeout: 20_000 })

  // Q-411 retired the round constraint: every style draws square now, so there is no longer a
  // layout a round die would crop differently from the others and no warning to assert. The check
  // that replaced it is the inverse — the warning must be GONE, or the app is telling the user
  // about a distinction that no longer exists.
  await expect(
    page.getByText(/Square dies only/i),
    'the square-only warning must not survive Q-411',
  ).toHaveCount(0)

  // Q-399. The DEFAULT style promises the breakdown and, for one release, drew zero lines of it at
  // every name length — the arithmetic left no room. Nothing failed: the renderer returned 0 and the
  // sheet's report was gated on `> 0`, so the line that would have said so simply vanished. The
  // owner found it by looking at a printed label.
  //
  // This is the guard that makes that impossible to ship again through the real renderer. The unit
  // test asserts the budget arithmetic; this asserts the pixels-and-copy path the owner actually
  // sees, which is where the gate lived.
  await page.getByRole('radio', { name: /Ingredients · centred/i }).click()
  await expect(
    page.getByText(/Printing [1-9]\d* ingredients?/),
    'the default style must print at least one ingredient and say how many',
  ).toBeVisible({ timeout: 20_000 })
  await expect(
    page.getByText(/No ingredients fit on this label/),
    'the default must not be in the no-room state',
  ).toHaveCount(0)
})

/**
 * Q-400 — the label has to be able to *leave*. The delivery half is device-only: the gallery write
 * goes through the `MediaSave` Capacitor bridge, which does not exist in a browser, so what this
 * spec can prove is the half that runs identically on both paths — that the button produces a PNG,
 * and that the PNG declares the physical size it was drawn at.
 *
 * **The density is the part no other check can see.** The pixels are right either way and the QR
 * decodes either way; a PNG with no `pHYs` chunk simply prints at the viewer's default of 96 dpi,
 * which turns a 50 mm label into ~312 mm on paper. That defect survived the 300 → 600 dpi change
 * made specifically for print quality, because nothing looks at the bytes.
 */
test('Save to gallery hands over a PNG that declares its print size', async ({ page }) => {
  await page.goto('/nutrition')
  await settleRouteBoundary(page)

  const savedMeals = page.getByRole('button', { name: 'My Foods', exact: true })
  await expect(savedMeals).toBeVisible({ timeout: 60_000 })
  const labelButton = page.getByRole('button', { name: `Print a label for ${MEAL_NAME}` })
  await expect(async () => {
    const box = (await savedMeals.boundingBox())!
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
    // BF-30 moved the row's actions onto the meal's own screen; open it first.
    await openSavedMeal(page, MEAL_NAME)
    await expect(labelButton).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 90_000 })
  await labelButton.tap()

  const canvas = page.getByRole('img', { name: `Printable label for ${MEAL_NAME}` })
  await expect(canvas).toBeVisible({ timeout: 30_000 })

  // In a browser `saveImageToGallery` takes its `<a download>` branch — which is the fallback, and
  // deliberately NOT the device path: inside the Samsung WebView it is a silent no-op, which is the
  // bug Q-400 fixes. It is still the same blob, produced by the same code.
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    page.getByRole('button', { name: 'Save to gallery' }).tap(),
  ])
  expect(download.suggestedFilename()).toMatch(/-label\.png$/)

  const path = await download.path()
  const bytes = new Uint8Array(readFileSync(path!))
  expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  // ~600 dpi, and therefore a label that measures what the sheet says it measures.
  const dpi = readPngDensity(bytes)
  expect(dpi, 'the PNG declares no physical size — it will print at ~312 mm').not.toBeNull()
  expect(dpi!).toBeGreaterThan(560)
  expect((bytes.length > 0 ? 1179 / dpi! : 0) * 25.4).toBeLessThan(60)

  // Every branch of this button ends in a toast. A silent path is what made the original defect
  // invisible for a release.
  await expect(page.getByText(/Label downloaded|Saved to your gallery/)).toBeVisible()
})

/** The pick is remembered now, so it survives closing and reopening the sheet (Q-400). */
test('the chosen label style is remembered', async ({ page }) => {
  await page.goto('/nutrition')
  await settleRouteBoundary(page)

  const savedMeals = page.getByRole('button', { name: 'My Foods', exact: true })
  await expect(savedMeals).toBeVisible({ timeout: 60_000 })
  const labelButton = page.getByRole('button', { name: `Print a label for ${MEAL_NAME}` })
  await expect(async () => {
    const box = (await savedMeals.boundingBox())!
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
    // BF-30 moved the row's actions onto the meal's own screen; open it first.
    await openSavedMeal(page, MEAL_NAME)
    await expect(labelButton).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 90_000 })
  await labelButton.tap()
  await expect(page.getByRole('img', { name: `Printable label for ${MEAL_NAME}` })).toBeVisible({ timeout: 30_000 })

  await page.getByRole('radio', { name: /Deli ticket/i }).click()
  await expect(page.getByRole('radio', { name: /Deli ticket/i })).toHaveAttribute('aria-checked', 'true')

  await page.reload()
  await settleRouteBoundary(page)
  await expect(async () => {
    const box = (await savedMeals.boundingBox())!
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
    await openSavedMeal(page, MEAL_NAME)
    await expect(labelButton).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 90_000 })
  await labelButton.tap()
  await expect(page.getByRole('img', { name: `Printable label for ${MEAL_NAME}` })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('radio', { name: /Deli ticket/i })).toHaveAttribute('aria-checked', 'true')
})
