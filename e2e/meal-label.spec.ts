import { test, expect } from '@playwright/test'
import { Client } from 'pg'
import { SEED_EMAIL, openSavedMeal, settleRouteBoundary } from './fixtures'
import { decodeQrRotating as decodeQr } from './qr-decode'
import { encodeMealLabelToken, decodeSharedMeal } from '@trainingai/shared/nutrition/label-payload'
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
/**
 * Keep the FAILING canvas, not just a measurement of it (LB-38).
 *
 * The entry eliminated capture as the cause — two captured failures read 0.1735 and 0.1775, inside
 * the normal band — which leaves ZXing being handed a correct image and returning null. The next
 * question is whether that same image decodes *offline*, and the only way to ask it is to still
 * have the image. A passing canvas was already tested that way and decoded under all four
 * binarizer/`TRY_HARDER` combinations, so a passing image is not the one to test.
 *
 * Raw RGBA rather than a PNG: no encoder is needed on either end, and `scripts/decode-share-code-dump.js`
 * is the other end.
 */
function dumpCanvas(shot: { w: number; h: number; lum: Buffer }, label: string): string {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const fs = require('node:fs') as typeof import('node:fs')
  const path = require('node:path') as typeof import('node:path')
  const dir = path.join(process.cwd(), 'test-results', 'share-code-dumps')
  fs.mkdirSync(dir, { recursive: true })
  const stem = path.join(dir, `${label}-${Date.now()}`)
  fs.writeFileSync(`${stem}.bin`, shot.lum)
  fs.writeFileSync(`${stem}.json`, JSON.stringify({ w: shot.w, h: shot.h, ink: darkFraction(shot) }))
  return `${stem}.bin`
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

/**
 * Open the label sheet for the fixture meal and hand back its canvas.
 *
 * **Extracted when this test was split** (BF-52's PR, repairing BF-57's). It was inline in one test
 * that grew past its own 180 s timeout; two tests need it twice, and the navigation is the part with
 * all the earned retries in it.
 */
async function openLabelSheet(page: import('@playwright/test').Page) {
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
    // Tap only while the sheet is still CLOSED. Since Q-395c this button opens Log Food, which
    // then covers the coordinate — so an unconditional re-tap lands on the sheet's own content and
    // the retry makes things worse rather than better. `meal-photo-picker.spec.ts` carries the same
    // guard for the same reason.
    if (await page.getByRole('dialog').count() === 0) {
      const box = (await savedMeals.boundingBox())!
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
    }
    // BF-30 moved the row's actions onto the meal's own screen; open it first.
    await openSavedMeal(page, MEAL_NAME)
    await expect(labelButton).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 90_000 })

  await labelButton.tap()
  const canvas = page.getByRole('img', { name: `Printable label for ${MEAL_NAME}` })
  await expect(canvas).toBeVisible({ timeout: 30_000 })
  return canvas
}

/** The canvas pixels, for `decodeQr`. */
async function shotOf(canvas: import('@playwright/test').Locator) {
  const { w, h, b64 } = await canvas.evaluate((el: HTMLCanvasElement) => {
    const ctx = el.getContext('2d')!
    const d = ctx.getImageData(0, 0, el.width, el.height).data
    // **One luminance byte per pixel, base64, computed in the page.** This used to return
    // `Array.from(d.data)` — 1179 × 1179 × 4 ≈ 5.56 MILLION numbers as JSON over CDP — and that
    // single line was 152 s of this test's 180 s budget: measured at 35.0, 40.1, 42.2 and 35.0
    // seconds for its four calls, against `selectStyle` at under 2 s and `decodeQr` at under 0.2 s.
    // The test was not flaky and not stuck; it was one step short of its clock, so any slowdown
    // tipped it over. The file's own note about `expect.poll` being pathological had already
    // identified this transfer as expensive without attributing the test's cost to it.
    //
    // Luminance is all either caller needs — ZXing packs RGB back down to it, and the ink fraction
    // is a threshold — so this drops a byte quad to a byte and then base64s it: one string instead
    // of millions of JSON numbers.
    const lum = new Uint8Array(d.length / 4)
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      lum[p] = (d[i] * 77 + d[i + 1] * 151 + d[i + 2] * 28) >> 8
    }
    let binary = ''
    const CHUNK = 0x8000  // `apply` on the whole array blows the argument limit
    for (let i = 0; i < lum.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, Array.from(lum.subarray(i, i + CHUNK)))
    }
    return { w: el.width, h: el.height, b64: btoa(binary) }
  })
  return { w, h, lum: Buffer.from(b64, 'base64') }
}

/**
 * Fraction of the canvas that is dark. 0 or 1 means the buffer came back degenerate rather than
 * merely blank (LB-38).
 *
 * **Ink is per-STYLE and reading it as one number costs a wrong conclusion.** Measured on a passing
 * run, 2026-09-02: `Ingredients · centred` **0.0800**, `Black band` **0.1341**, `Plaque` **0.0914**,
 * `Big code` **0.1732**. The "~0.17" this comment used to give is `Big code`'s, and the 0.172–0.179
 * band LB-38 records is the share-code test's own style — so the one failing buffer ever captured,
 * at **0.0807** on `Ingredients · centred`, reads as *half the normal ink* against either of those
 * and as *exactly normal* against its own. It is normal. A tornness theory was built on the wrong
 * comparison and dropped once these numbers existed; do not rebuild it from a single figure.
 */
function darkFraction({ lum }: { lum: Buffer }): number {
  let dark = 0
  for (let i = 0; i < lum.length; i++) if (lum[i] < 128) dark++
  return dark / lum.length
}

/**
 * The style picker's two settle signals, and the switch that uses both.
 *
 * **Lifted to module scope when this test was split.** The single test that owned them grew past its
 * own 180 s timeout — it paints seven styles and decodes five — so the share-code half became its
 * own test, and both halves need this.
 */
function makeStyleTools(page: import('@playwright/test').Page, canvas: import('@playwright/test').Locator) {
const inkFraction = async () => canvas.evaluate((el: HTMLCanvasElement) => {
  const ctx = el.getContext('2d')!
  const { data } = ctx.getImageData(0, 0, el.width, el.height)
  let dark = 0
  for (let i = 0; i < data.length; i += 4) if (data[i] < 128) dark++
  return dark / (data.length / 4)
})

/**
 * Switch to a style and wait until the canvas is actually showing IT (LB-19).
 *
 * **`inkFraction > 0.01` could not do this, and that is the whole bug.** The canvas already
 * carries the previous style's ink when the radio is clicked, so the condition is true before
 * anything repaints — a precondition satisfied by the state it is meant to replace cannot fail.
 * The read then lands mid-repaint and the decode below returns null, intermittently, more often
 * under file-level load.
 *
 * Two signals, because one is not enough:
 *
 * **The `mm` line changes with the style**, and it is derived from the style rather than from the
 * paint, so it says the sheet has switched. Measured 2026-08-30, all six distinct — centred 18.5,
 * black band 16.4, editorial 16.9, deli 17.7, plaque 20.9, big code 20.1.
 * **Then the ink settles**, which is the only thing that can say the CANVAS is finished: the
 * sheet's text can update a frame before the draw, and a repaint passes through a cleared canvas,
 * so "ink changed" on its own can fire on a blank one.
 *
 * **Canvas dimensions were the other candidate and they are not usable** — probed the same day,
 * every style renders 1179×1179. Recorded so nobody re-measures it.
 */
const styleFigure = () => page.getByText(/mm at \d+×\d+ modules/).first().textContent()

/** Two identical consecutive reads with ink on them. Settled, not merely non-zero: a repaint
 *  clears the canvas first, so a single sample can catch it empty. */
async function waitForSettledInk(style: string) {
  let previous = -1
  await expect
    .poll(async () => {
      const now = await inkFraction()
      const settled = now > 0.01 && Math.abs(now - previous) < 1e-9
      previous = now
      return settled
    }, { message: `${style}'s canvas should settle with ink on it`, timeout: 20_000, intervals: [150] })
    .toBe(true)
}

async function selectStyle(style: string) {
  const radio = page.getByRole('radio', { name: new RegExp(escapeRe(style), 'i') })
  // Already showing — the style was selected before the loop, or the loops overlap at their
  // edges. Still wait for the paint: skipping the check here is how the first iteration of a
  // loop ends up asserting nothing.
  if (await radio.getAttribute('aria-checked') === 'true') return waitForSettledInk(style)

  const figureBefore = (await styleFigure())?.trim()
  await radio.click()

  await expect
    .poll(async () => (await styleFigure())?.trim(), {
      message: `${style} should report its own code size — if it matches the previous style's `
        + `(${figureBefore}), this signal cannot tell the two apart and the gate is blind again`,
      timeout: 20_000,
    })
    .not.toBe(figureBefore)

  await waitForSettledInk(style)
}

  return { selectStyle, waitForSettledInk, styleFigure, inkFraction }
}

test('a saved meal renders a printable label in every style', async ({ page }) => {
  const errors: string[] = []
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', e => errors.push(String(e)))
  const canvas = await openLabelSheet(page)

  // Select the style explicitly rather than trusting what the sheet opens on: since Q-400 the pick
  // is remembered in `localStorage`, so "the default" is only what a browser that has never chosen
  // one shows. The 25×25 figure below belongs to this style, not to whatever was last used.
  await page.getByRole('radio', { name: /Ingredients · centred/i }).click()

  // The sheet reports the code's physical size, which is the number the whole print risk is about.
  await expect(page.getByText(/mm at 25×25 modules/), `console: ${errors.join(' | ')}`).toBeVisible()

  /** Is the canvas actually painted? A blank one is white everywhere; a drawn label has ink. */
  const { selectStyle } = makeStyleTools(page, canvas)

  for (const style of ['Ingredients · centred', 'Black band', 'Editorial', 'Deli ticket', 'Plaque', 'Big code']) {
    await selectStyle(style)
  }

  // **Does the code actually survive the layout?** The canvas pixels are pulled into Node and
  // decoded with zxing's pure-JS core — the same decoder family the in-app scanner uses. This is the
  // closest the sandbox gets to the print test that is still owed: it says nothing about ink spread
  // on paper, but it proves the symbol is complete, unobstructed and resolves to THIS meal at every
  // layout. It matters most for the two square styles, whose ingredient list is drawn directly above
  // the code — an earlier version of the centred layout ran the list into it, and a covered code
  // still looks like a code.
  for (const style of ['Ingredients · centred', 'Black band', 'Plaque', 'Big code']) {
    await selectStyle(style)

    // **No retry here, deliberately — and that is why this loop is the better place to catch the
    // decode flake.** The share-code test retries six times, so it only fails when every attempt
    // does; this one fails on the first, which is a cheaper and more faithful reproduction. Both
    // keep the pixels ZXing refused (LB-38), so whichever fails carries its own evidence.
    const shot = await shotOf(canvas)
    const text = decodeQr(shot)
    const dumped = text === null ? dumpCanvas(shot, `every-style-${style.replace(/\W+/g, '-')}`) : null
    expect(
      text,
      `${style}'s code must decode off the rendered label (ink ${darkFraction(shot).toFixed(4)}`
        + `${dumped ? `; failing canvas kept at ${dumped} — decode it with \`node e2e/decode-share-code-dump.js ${dumped}\`` : ''})`,
    ).toBeTruthy()
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
/**
 * BF-57 — the label a stranger can use.
 *
 * **Its own test, because the one it came from ran out of time.** That test paints seven styles and
 * decodes four; adding an eighth paint, a fifth decode and two more switches took it past its own
 * 180 s budget — it passed in CI on the PR that added it and failed locally straight afterwards,
 * which is the marginal-timeout shape this repo has been bitten by before. Split, each half has
 * room, and a failure now names which half broke.
 *
 * The token decode stays with the other test: it proves the code resolves to THIS meal for the
 * person who printed it. That is a private bookmark, and another account's scan of it finds nothing
 * — which is exactly why a shared label needed a different payload.
 */
test('the share style carries the recipe, and the print styles say they do not', async ({ page }) => {
  const canvas = await openLabelSheet(page)
  const { selectStyle } = makeStyleTools(page, canvas)

  await selectStyle('Share code')

  // **Read up to three times, a second apart.** `waitForSettledInk` proves the canvas stopped
  // changing, and it is still possible to sample across the tail of a repaint — the decode then
  // returns null. This file's own notes call that out as intermittent and *"more often under
  // file-level load"*, and this test saw it once in a full-suite run while passing alone twice. The
  // share code is version 11 at 61 modules, the densest symbol the feature draws, so it has the
  // least margin of any of them.
  //
  // **Not `expect.poll`, which was tried and is pathological here.** `shotOf` returns the canvas as
  // a plain array — 1179 × 1179 × 4 ≈ 5.5 million numbers over CDP — so polling it at 200 ms
  // intervals cannot finish an iteration between ticks and stalls the page outright: the polled
  // version failed on a run the single read had passed twice. A bounded retry with a real gap
  // closes the repaint window without the transfer cost.
  // **Six attempts, and this is mitigation rather than proof.** Measured across five runs of this
  // file: it decoded first time in three, and needed a retry in two. Three attempts was not enough
  // on one of those, so the budget is six — ~6 s worst case, and nothing on the happy path.
  // If it ever goes red in CI on this line, the answer is NOT another retry: read whether the
  // canvas is being redrawn after `selectStyle` returns, which is the only mechanism left that
  // `waitForSettledInk` would not already have caught.
  let text: string | null = null
  let lastInk = -1
  let lastShot: { w: number; h: number; lum: Buffer } | null = null
  for (let attempt = 0; attempt < 6 && text === null; attempt++) {
    if (attempt > 0) await page.waitForTimeout(1_000)
    const shot = await shotOf(canvas)
    lastShot = shot
    lastInk = darkFraction(shot)
    text = decodeQr(shot)
  }
  // LB-38's next step, and it only ever runs on a failure: keep the pixels ZXing refused, so the
  // question "does this same image decode offline?" can be asked without reproducing the flake
  // first. Six attempts have already failed by here, so this costs nothing on the happy path.
  const dump = text === null && lastShot !== null ? dumpCanvas(lastShot, 'share-code') : null
  // **The failure reports its own diagnosis, because it will not reproduce on demand** (LB-38).
  // Measured across nine runs: it passes alone every time and fails only sometimes under
  // file-level load, so the ink reading at the moment of failure has never been captured locally.
  // A passing attempt reads **0.172–0.179**. A failure reading ~0 or ~1 means `getImageData`
  // handed back a degenerate buffer and the gate above passed on a canvas that was never drawn;
  // a failure reading ~0.17 means the pixels arrived intact and the cause is in the decode.
  // Those are different bugs with different fixes, and this line is what tells them apart.
  expect(
    text,
    `the share code must decode off the rendered label (ink at last attempt: ${lastInk.toFixed(4)}`
      + `${dump ? `; failing canvas kept at ${dump} — decode it with \`node scripts/decode-share-code-dump.js ${dump}\`` : ''})`,
  ).toBeTruthy()
  // Not the token: this is the assertion that the swap actually happened. A `share` label still
  // emitting `encodeMealLabelToken` would decode fine and be useless to everyone else.
  expect(text).not.toBe(expectedToken)

  const shared = decodeSharedMeal(text!)
  expect(shared, 'the share code must decode as a meal, not a bookmark').not.toBeNull()
  expect(shared!.name).toBe(MEAL_NAME)
  // servings = 2, so a scanner's copy is the same batch rather than one plate.
  expect(shared!.servings).toBe(2)
  expect(shared!.rolled, 'eight ingredients cannot fit 251 bytes — this is the rolled path').toBeGreaterThan(0)
  expect(shared!.ingredients.length).toBeLessThan(8)

  // 8 × (60 g, 240 kcal, 50 P, 4 C, 2 F) at quantity 2 — exact, including across the remainder.
  // **This is the guarantee a scanner cannot check for themselves:** a copy with plausible-looking
  // wrong numbers is indistinguishable from a correct one.
  const sum = (k: 'weightG' | 'calories' | 'proteinG' | 'carbsG' | 'fatG') =>
    shared!.ingredients.reduce((a, i) => a + i[k], 0)
  expect(sum('weightG')).toBe(480)
  expect(sum('calories')).toBe(1920)
  expect(sum('proteinG')).toBeCloseTo(400, 6)
  expect(sum('carbsG')).toBeCloseTo(32, 6)
  expect(sum('fatG')).toBeCloseTo(16, 6)

  // BF-57 item 2: a copy that arrives with fewer rows than the author's must say so where the person
  // holding the paper can read it, not only inside the payload.
  await expect(
    page.getByText(/groups the other \d+ into one entry/),
    'the sheet must say what the share code could not name',
  ).toBeVisible({ timeout: 20_000 })

  // And a print style must say the opposite, plainly — the confusion BF-57 exists to end is someone
  // handing over a jar label and it doing nothing.
  await selectStyle('Big code')
  await expect(
    page.getByText(/private bookmark/i),
    'a token-carrying style must not read as shareable',
  ).toBeVisible({ timeout: 20_000 })
})

test('Save to gallery hands over a PNG that declares its print size', async ({ page }) => {
  await page.goto('/nutrition')
  await settleRouteBoundary(page)

  const savedMeals = page.getByRole('button', { name: 'My Foods', exact: true })
  await expect(savedMeals).toBeVisible({ timeout: 60_000 })
  const labelButton = page.getByRole('button', { name: `Print a label for ${MEAL_NAME}` })
  await expect(async () => {
    // Tap only while the sheet is still CLOSED. Since Q-395c this button opens Log Food, which
    // then covers the coordinate — so an unconditional re-tap lands on the sheet's own content and
    // the retry makes things worse rather than better. `meal-photo-picker.spec.ts` carries the same
    // guard for the same reason.
    if (await page.getByRole('dialog').count() === 0) {
      const box = (await savedMeals.boundingBox())!
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
    }
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
    // Tap only while the sheet is still CLOSED. Since Q-395c this button opens Log Food, which
    // then covers the coordinate — so an unconditional re-tap lands on the sheet's own content and
    // the retry makes things worse rather than better. `meal-photo-picker.spec.ts` carries the same
    // guard for the same reason.
    if (await page.getByRole('dialog').count() === 0) {
      const box = (await savedMeals.boundingBox())!
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
    }
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
    // Tap only while the sheet is still CLOSED. Since Q-395c this button opens Log Food, which
    // then covers the coordinate — so an unconditional re-tap lands on the sheet's own content and
    // the retry makes things worse rather than better. `meal-photo-picker.spec.ts` carries the same
    // guard for the same reason.
    if (await page.getByRole('dialog').count() === 0) {
      const box = (await savedMeals.boundingBox())!
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
    }
    await openSavedMeal(page, MEAL_NAME)
    await expect(labelButton).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 90_000 })
  await labelButton.tap()
  await expect(page.getByRole('img', { name: `Printable label for ${MEAL_NAME}` })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('radio', { name: /Deli ticket/i })).toHaveAttribute('aria-checked', 'true')
})
