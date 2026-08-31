import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '../../..')
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8')

/**
 * BF-52 — the entry point, guarded at the source.
 *
 * Source-level because both vitest projects run `environment: 'node'` and nothing renders. Each of
 * these is a way the change reverts to the state the owner reported while still compiling.
 */
describe('meal source row', () => {
  it('sits in the builder, OUTSIDE the collapsed ingredient picker', () => {
    const sheet = read('components/nutrition/saved-meals-sheet.tsx')
    // **The whole entry.** The old affordances lived inside `IngredientPicker`, which the builder
    // only mounts once "Add ingredient" is tapped — so they could not be found without already
    // knowing they were there. Rendering the row inside the picker would compile, look right in a
    // screenshot of an open picker, and change nothing about the reported problem.
    const i = sheet.indexOf('<MealSourceRow')
    const j = sheet.indexOf('{pickerOpen ? (')
    expect(i, 'the row must be rendered by the builder').toBeGreaterThan(-1)
    expect(i, 'and BEFORE the collapsed picker, not inside it').toBeLessThan(j)
    expect(read('components/nutrition/ingredient-picker.tsx')).not.toMatch(/MealSourceRow/)
  })

  it('offers exactly the three whole-meal inputs, and not the barcode', () => {
    const file = read('components/nutrition/meal-source-row.tsx')
    // **From the component, not the file.** The doc comment above it explains why the barcode is
    // absent — and a whole-file grep for "barcode" therefore fails on the documentation of its own
    // decision. Third time this shape has bitten today; slice past the prose before asserting on it.
    const src = file.slice(file.indexOf('export function MealSourceRow'))
    expect(src).toMatch(/Recipe link/)
    expect(src).toMatch(/Describe it/)
    expect(src, 'the photo tile reuses the picker that already handles Capacitor and the named input')
      .toMatch(/RecipeImageButton[\s\S]{0,80}variant="tile"/)
    expect(file, 'and the reason it is absent stays written down').toMatch(/barcode names one product/)
    // **Against BF-52's own instruction, deliberately.** These three produce a whole ingredient
    // list; a barcode names one product, and under "start this meal from" it promises to build a
    // meal from a packet. It belongs beside the ingredient search, where BF-63 put it.
    expect(src, 'a barcode is not a meal source').not.toMatch(/[Bb]arcode/)
    expect(read('components/nutrition/ingredient-search.tsx'), 'and it must still be on the search')
      .toMatch(/aria-label="Scan a barcode"/)
  })

  it('sends each input to the one route that already takes all three', () => {
    const src = read('components/nutrition/meal-source-row.tsx')
    // No new extraction: `/api/nutrition/scan` branches on `image`/`url`/`text`, so all three go
    // through `runRecipeImport` and differ only in the payload.
    expect(src).toMatch(/imageKind: 'recipe'/)
    expect(src).toMatch(/\{ url: link \}/)
    expect(src).toMatch(/\{ text: text\.trim\(\) \}/)
    expect(src, 'the import itself is shared, never re-implemented').toMatch(/runRecipeImport/)
    expect(src).not.toMatch(/recipeYield/)
  })

  it('keeps what you typed when an import fails', () => {
    const src = read('components/nutrition/meal-source-row.tsx')
    const run = src.slice(src.indexOf('async function run('), src.indexOf('const link ='))
    // Both failure branches return BEFORE the resets. Closing the field on a failed paste turns a
    // one-character typo into a re-type, and a mis-read link into a mystery.
    const empty = run.indexOf("outcome.kind === 'empty'")
    const reset = run.indexOf('setUrl(\'\')')
    expect(empty).toBeGreaterThan(-1)
    expect(reset).toBeGreaterThan(empty)
    expect(run.slice(empty, reset)).toMatch(/return/)
  })

  it('the search slot no longer hides the photo button, but keeps the URL guard', () => {
    const src = read('components/nutrition/ingredient-search.tsx')
    // It moved to the row. Left here it would still only render on an EMPTY search — one of the two
    // mutually exclusive renders of one slot that made neither findable.
    expect(src).not.toMatch(/RecipeImageButton/)
    // **The URL branch stays, and not merely for convenience.** Without it a pasted link falls to
    // the estimate below, and an AI estimate over the text of a URL produces a food called "https"
    // with invented macros. Deleting it would reintroduce that.
    expect(src, 'a pasted link must not fall through to the estimate').toMatch(/onImportRecipe\(recipeUrl\)/)
  })
})
