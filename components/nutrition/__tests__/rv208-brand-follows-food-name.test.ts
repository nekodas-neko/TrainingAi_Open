import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { foodSecondaryLine } from '../food-name-line'
import { stripComments } from '../../../scripts/lib/strip-comments.js'

/**
 * RV-208 ⑤ — the food name leads and the brand follows, on every surface.
 *
 * Two of the five surfaces put the brand in FRONT: `Uncle Tobys — Rolled oats` in the food-database
 * results and the recents panel, against the diary's `Rolled oats` over `Uncle Tobys · 1 serving`.
 * The entry asked for one of the two. Name-leading wins on more than symmetry — **both
 * brand-leading sites are SEARCH lists**, where the user typed the food name, so leading with the
 * brand pushes the term they matched on rightward into `FoodRow`'s `line-clamp-2`.
 */

const ROOT = path.resolve(__dirname, '../../..')

/**
 * Every surface that renders a brand beside a food name — six, where the entry named two.
 *
 * Reached by censusing `<FoodRow` and then every `${…brand…}` interpolation in `app/` and
 * `components/`, rather than by working outward from the two the entry quotes. That found two more
 * kinds of divergence than "one form or the other":
 *
 *   - `food-list.tsx` was already name-leading, with its own `[brand, serving].join(' · ')` — a
 *     third copy of the join, agreeing by coincidence rather than by construction.
 *   - `ingredient-search.tsx` dropped the brand ENTIRELY. So the library's `Search` tab did not
 *     identify a food that its own `Recent` tab did, which is the same defect as a wrong form and
 *     is invisible if you only compare the two lists the entry names.
 *
 * `review-step.tsx` also interpolates a brand and is deliberately absent: it builds an LLM prompt
 * context string, not a render, and it already leads with the name.
 */
const SURFACES = [
  'components/nutrition/food-database-results.tsx',
  'components/nutrition/recent-foods-panel.tsx',
  'components/nutrition/meal-card.tsx',
  'components/nutrition/capture-actions.tsx',
  'components/nutrition/food-list.tsx',
  'components/nutrition/ingredient-search.tsx',
]

describe('RV-208 ⑤ — one brand form', () => {
  it('joins with the separator the name-leading sites already used', () => {
    expect(foodSecondaryLine('Uncle Tobys', '40 g serving')).toBe('Uncle Tobys · 40 g serving')
    expect(foodSecondaryLine('Uncle Tobys', null)).toBe('Uncle Tobys')
    expect(foodSecondaryLine(null, '40 g serving')).toBe('40 g serving')
    expect(foodSecondaryLine(null, null)).toBeNull()
  })

  it('treats an empty or blank brand as no brand, because the DB column is nullable AND free text', () => {
    // `review-step.tsx` writes this field from a text input, so `''` reaches storage. A bare
    // truthiness check would have been enough for `''`; `' '` would have produced a leading
    // separator with nothing before it.
    expect(foodSecondaryLine('', '40 g')).toBe('40 g')
    expect(foodSecondaryLine('   ', '40 g')).toBe('40 g')
    expect(foodSecondaryLine('Uncle Tobys', '  ')).toBe('Uncle Tobys')
  })

  it('no surface puts the brand in front of the name again', () => {
    for (const f of SURFACES) {
      const src = stripComments(readFileSync(path.join(ROOT, f), 'utf8'))
      // Matched on CODE, not on mentions: the shape is a template whose brand interpolation is
      // followed by a name interpolation, which is what brand-leading actually looked like. A
      // docstring explaining the rule must not trip its own guard.
      expect(src, `${f} interpolates a brand ahead of a name again`)
        .not.toMatch(/\$\{[\w.?]*brand[\w.?]*\}\s*[—-]\s*\$\{/i)
      expect(src, `${f} builds its own brand line instead of calling foodSecondaryLine`)
        .toMatch(/foodSecondaryLine\(/)
    }
  })

  it('no surface hand-rolls the join either, however innocent it looks', () => {
    // `food-list.tsx` held `[item.brand, serving].filter(Boolean).join(' · ')` and produced the
    // right string. It is still the failure this rule is about: a fourth site agreeing by accident
    // is what the other three did until one of them stopped.
    for (const f of SURFACES) {
      const src = stripComments(readFileSync(path.join(ROOT, f), 'utf8'))
      expect(src, `${f} joins a brand by hand instead of calling foodSecondaryLine`)
        .not.toMatch(/\[\s*[\w.?]*brand[\w.?]*\s*,[^\]]*\]\s*\n?\s*\.?\s*(filter|join)/i)
    }
  })

  it('and the quick-edit header is deliberately NOT converted', () => {
    // It already leads with the name; the brand is its own grey line below, not a secondary string,
    // because this is a sheet header rather than a `FoodRow`. Converting it would mean inventing a
    // separator for a line that has nothing to separate.
    const src = readFileSync(
      path.join(ROOT, 'components/nutrition/quick-edit-log-sheet.tsx'), 'utf8')
    expect(src).toMatch(/\{item\?\.name\}/)
    expect(src).toMatch(/item\?\.brand && <p[^>]*>\{item\.brand\}<\/p>/)
  })
})
