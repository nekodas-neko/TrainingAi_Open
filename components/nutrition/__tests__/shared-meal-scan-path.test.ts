import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '../../..')
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8')

/**
 * BF-57 — the scan half, guarded at the source.
 *
 * Source-level because there is nowhere else to put it: both vitest projects run
 * `environment: 'node'`, so no component renders, and the branch under test is reached only from a
 * camera. What it protects is real — each of these regressions leaves a screen that renders
 * perfectly and simply never takes the new path.
 */
describe('shared-meal scan path', () => {
  it('the food capture screen recognises both label shapes, not just the old token', () => {
    const src = read('components/nutrition/capture-actions.tsx')
    // `decodeMealLabelToken` only matches the 22-character bookmark. Left in place, a shared label —
    // a ~250-character string — falls through to the barcode lookup, which can only 400 it. The
    // scan would fail with a product-not-found message, which names the wrong thing entirely.
    // `decodeMealLabelToken\(` — the CALL, not the name. The name appears in prose explaining why
    // the swap happened, and a bare-word assertion would fail on the comment that documents it.
    expect(src, 'the token-only decoder cannot see a shared label').not.toMatch(/decodeMealLabelToken\s*\(/)
    expect(src).toMatch(/decodeMealLabelScan/)
    expect(src, 'the shared-meal branch must be routed, not merely decoded').toMatch(/kind === 'shared-meal'/)
    // Both branches stay. A label already stuck to a jar has no upgrade path, so the old shape has
    // to keep resolving for the person who printed it — indefinitely.
    expect(src).toMatch(/kind === 'meal-id'/)
  })

  it('the ingredient picker recognises them too — the other camera into a meal label', () => {
    // Sibling surface. It refuses a meal label with a specific message rather than sending it to the
    // barcode route; that refusal has to recognise the new shape or the newer labels are the ones
    // that fall through.
    const src = read('components/nutrition/ingredient-picker.tsx')
    expect(src).toMatch(/decodeMealLabelScan/)
    expect(src).not.toMatch(/decodeMealLabelToken\s*\(/)
  })

  it('a scanned shared meal is saved, and saved as a copy', () => {
    const src = read('components/nutrition/food-logger-sheet.tsx')
    expect(src).toMatch(/onScannedSharedMeal=\{handleScannedSharedMeal\}/)
    // Saved to the library, never logged. A scan that silently put a meal into today's diary would
    // be recording something nobody said they had eaten.
    expect(src).toMatch(/saveSharedMealToLibrary/)
    const handler = src.slice(src.indexOf('async function handleScannedSharedMeal'), src.indexOf('return (\n    <>'))
    expect(handler, 'a scanned label must not log the meal').not.toMatch(/logMealItems/)
  })

  it('a re-scanned label is recognised instead of copied again (LB-34)', () => {
    const src = read('components/nutrition/food-logger-sheet.tsx')
    const handler = src.slice(
      src.indexOf('async function handleScannedSharedMeal'),
      src.indexOf('return (\n    <>'),
    )
    // Comments stripped before matching. The handler explains the check in prose naming both
    // helpers, and a bare-word assertion would pass on the comment documenting its own fix — the
    // shape that has slipped through three times in this repo.
    const code = handler.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '')

    expect(code, 'the scan must ask whether this meal is already saved').toMatch(/findDuplicateMeal\s*\(/)
    expect(code, 'and ask it with the payload\'s own totals').toMatch(/sharedMealTotals\s*\(/)
    // The property the whole entry is about: on a match it returns WITHOUT writing. A check that
    // found the duplicate and saved anyway is the bug with extra steps.
    const branch = code.slice(code.indexOf('findDuplicateMeal'))
    const dupBranch = branch.slice(0, branch.indexOf('saveSharedMealToLibrary'))
    expect(dupBranch, 'a duplicate must return before the save').toMatch(/return\b/)
    // Local-first, and no fetch: a shared label\'s whole point is that it works with no signal, so
    // the duplicate check must never be the thing that needs the network.
    expect(code, 'the library read must be local-first').toMatch(/getSavedMeals\s*\(/)
    expect(code, 'the duplicate check must not add a network round-trip').not.toMatch(/fetch\s*\(/)
    // An escape hatch, because two friends can genuinely cook the same-named dish and the user is
    // the one who knows.
    expect(code, 'the user must be able to keep the copy anyway').toMatch(/Save a copy/)
  })

  it('an unresolvable id no longer asserts the meal was deleted', () => {
    const src = read('components/nutrition/food-logger-sheet.tsx')
    // This branch resolves an id against the SCANNING user's own meals, so it is reached both when
    // the owner deleted their meal and when someone else's pre-BF-57 label is scanned — where the
    // meal exists and simply is not theirs. The old copy asserted the first, and the second is the
    // case that matters now that labels get handed to people.
    expect(src).not.toMatch(/That saved meal no longer exists/)
    expect(src).toMatch(/not in your library/)
    expect(src, 'the message must name the other cause too').toMatch(/printed by someone else/)
  })
})
