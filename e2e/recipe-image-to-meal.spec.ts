import { test, expect, type Page } from '@playwright/test'
import { Client } from 'pg'
import { settleRouteBoundary } from './fixtures'

/**
 * A recipe from a picture reaches the meal builder (BF-40).
 *
 * The owner's case is a Google AI overview: the ingredients are rendered into Google's own results
 * page with the source behind a chip, so **there is no URL to paste** and the image is the only
 * handle on that content. `recipe-url-to-meal.spec.ts` covers the link path; this covers the half
 * that path structurally cannot serve.
 *
 * The scan is stubbed — it reaches an AI model, so a live run would be non-deterministic and would
 * cost a call per run. What the stub cannot check is the model's reading of the image; what it can
 * check, and what actually broke twice in this area, is everything downstream of the response.
 */

// The service worker re-issues every `/api/` request and Playwright cannot intercept a
// service-worker fetch, so the stub below is only reliable with it blocked (PS-14).
test.use({ serviceWorkers: 'block' })

/**
 * **The import mints a real `food_item` per ingredient, so this spec must clean up after itself.**
 * Without this it passes on a fresh database and fails from the second local run onward: the foods
 * it left behind come back in the picker's own list, and the assertion below matches both the
 * ingredient row and a stale search row. CI provisions a fresh database every run and would never
 * have shown it — which is the "green in CI, red locally" trap CLAUDE.md documents, self-inflicted.
 */
async function cleanup() {
  const db = new Client({ connectionString: process.env.DATABASE_URL })
  await db.connect()
  try {
    await db.query("DELETE FROM saved_meal_items WHERE food_item_id IN (SELECT id FROM food_items WHERE name LIKE 'Spec Pancake%' OR name IN ('Spec Flour', 'Spec Milk'))")
    await db.query("DELETE FROM food_logs WHERE food_item_id IN (SELECT id FROM food_items WHERE name IN ('Spec Flour', 'Spec Milk'))")
    await db.query("DELETE FROM food_items WHERE name IN ('Spec Flour', 'Spec Milk')")
  } finally { await db.end() }
}

test.beforeAll(cleanup)
test.afterAll(cleanup)

// A 1×1 PNG. The stub never looks at it; the file input needs something to carry.
const PIXEL =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

async function openBuilder(page: Page) {
  await page.goto('/nutrition')
  await settleRouteBoundary(page)
  const button = page.getByRole('button', { name: 'My Meals', exact: true })
  await expect(button).toBeVisible({ timeout: 60_000 })
  await expect(async () => {
    if (await page.getByRole('dialog').count() === 0) {
      const box = (await button.boundingBox())!
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
    }
    await expect(page.getByRole('tab', { name: 'Meals', exact: true })).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 90_000 })
  await page.getByRole('tab', { name: 'Meals', exact: true }).tap()
  await page.getByRole('button', { name: /^(New|Build your first meal)$/ }).first().tap()
  await expect(page.getByRole('button', { name: /^(Update|Save) Meal$/ })).toBeVisible({ timeout: 15_000 })
}

test('a recipe picture becomes ingredients, and the builder asks how many it serves', async ({ page }) => {
  let posted: Record<string, unknown> | null = null
  await page.route('**/api/nutrition/scan', async route => {
    posted = JSON.parse(route.request().postData() ?? '{}')
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        name: 'Spec Pancakes',
        // Whole-batch figures, exactly as the route returns them for an image.
        ingredients: [
          { name: 'Spec Flour', weightG: 250, caloriesPer100g: 364, proteinPer100g: 10, carbsPer100g: 76, fatPer100g: 1 },
          { name: 'Spec Milk', weightG: 300, caloriesPer100g: 62, proteinPer100g: 3, carbsPer100g: 5, fatPer100g: 3 },
        ],
        candidates: [],
        // A screenshot has no JSON-LD, so this is null — and null is the whole point.
        recipeYield: null,
      }),
    })
  })

  await openBuilder(page)

  // **`Recipe photo`, and it is in the builder's source row now (BF-52).** It used to be a
  // full-width `Build from a recipe picture` button rendered into the ingredient search's slot, and
  // only on an EMPTY search — one of three mutually exclusive renders of one place, which is why
  // the owner could not find any of them. The picking code is unchanged; the chrome around it is a
  // tile, and it is always visible.
  const pick = page.getByRole('button', { name: 'Recipe photo' })
  await expect(pick, 'the source row offers a recipe picture').toBeVisible()

  // **By name, not by type.** BF-46 ①a put the meal's photo picker at the top of this same builder,
  // so `input[type="file"]` reaches that one first and the recipe picture went to it — silently,
  // and the ingredient rows below simply never appeared.
  await page.setInputFiles('input[name="recipe-picture"]', {
    name: 'recipe.png', mimeType: 'image/png', buffer: Buffer.from(PIXEL, 'base64'),
  })

  // Matched on the INGREDIENT row's own shape — name plus weight — not on the bare name. The bare
  // name also matches a search-result row for a food of the same name, which is what this spec's
  // own minted foods become on a second run.
  await expect(page.getByRole('button', { name: /Spec Flour.*250 g/ })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: /Spec Milk.*300 g/ })).toBeVisible()

  // **The request said which question it was asking.** Without this the model is told to estimate a
  // finished plate from a picture of a word list, which is the entire defect BF-40 fixes.
  expect(posted).toMatchObject({ imageKind: 'recipe', mimeType: 'image/jpeg' })

  // **And the yield was asked, not assumed.** A screenshot carries no yield; defaulting to one
  // portion is the documented four-fold calorie error that reads as entirely plausible.
  await expect(page.getByText(/didn.t say how many this serves/i)).toBeVisible()
})

/**
 * **Rewritten by BF-52, because the behaviour it asserted was deliberately removed.**
 *
 * It used to check that the picture button *yielded* to a typed query and to a pasted link. That
 * yielding was the defect: the photo button, the URL import and the AI estimate were three
 * mutually exclusive renders of one slot, so each existed only while the others did not — and the
 * owner reported *"I dont see a URL option"* because it did not exist until they had already pasted
 * the URL. The photo tile is in the source row now and yields to nothing.
 *
 * **What survives is the half that was never about layout:** a pasted link must still offer the
 * import. Without that branch it falls through to the AI estimate, and an estimate over the text of
 * a URL produces a food called "https" with invented macros. It is a guard, not an affordance.
 */
test('the photo tile no longer yields, and a pasted link still offers the import', async ({ page }) => {
  await openBuilder(page)
  const pick = page.getByRole('button', { name: 'Recipe photo' })
  await expect(pick).toBeVisible()

  const search = page.getByPlaceholder(/search/i).first()
  await search.fill('chicken')
  await expect(pick, 'the tile is no longer competing for the search slot').toBeVisible()

  await search.fill('https://example.com/recipe')
  await expect(pick).toBeVisible()
  await expect(
    page.getByText(/Import the recipe from example\.com/),
    'a pasted link must not fall through to the AI estimate',
  ).toBeVisible()
})
