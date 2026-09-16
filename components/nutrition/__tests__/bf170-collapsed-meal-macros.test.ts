import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { mealFooter } from '@/components/nutrition/meal-card-footer'

const ROOT = path.resolve(__dirname, '../../..')
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')
/** The component explains this bug in prose and quotes the shape it replaced, so a raw match would
 *  pass on the comment. */
const code = (rel: string) =>
  read(rel)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')

/**
 * BF-170 — owner, on his Nutrition diary: *"Same issue here where the singular meal doesnt show
 * macro below it."*
 *
 * `mealFooter` withholds a section's totals footer for a lone meal on an explicit premise — *"a
 * group row states its own macros AND calories"*. The group row stated only calories: the P/C/F
 * line sat inside `{open && …}`, and collapsed is the default. So the footer was withheld for a
 * claim that was half true and the macros appeared nowhere.
 *
 * **This is BF-120's defect with the kinds swapped** — there the section showing nothing was the
 * loose food and the one above it was the meal; here it is the other way round.
 */
describe('BF-170 — a collapsed meal group states its own macros', () => {
  const src = code('components/nutrition/diary-meal-group.tsx')
  const macroLine = src.indexOf('MACRO_COLORS.protein')
  const expansion = src.indexOf('{open && (')

  it('renders the macro line outside the expansion, so the default state shows it', () => {
    expect(macroLine, 'the macro line must exist').toBeGreaterThan(-1)
    expect(expansion, 'the expansion must still exist').toBeGreaterThan(-1)
    expect(macroLine, 'the macro line must come BEFORE the {open && …} block').toBeLessThan(expansion)
  })

  it('renders it exactly once, so expanding does not print it twice', () => {
    // The entry's stated alternative — fixing this in `mealFooter` instead — would show the section
    // footer's copy alongside the group's as soon as the group opened.
    expect(src.match(/MACRO_COLORS\.protein/g) ?? []).toHaveLength(1)
  })

  it('leaves the expansion carrying the ingredient rows and nothing else', () => {
    // The flood of one meal as eight sibling rows is what BF-39 was filed on; collapsing must still
    // hide the ingredients.
    expect(src).toContain('{open && (')
    expect(src).toContain('{children}')
  })

  it('and mealFooter is left alone, because its premise is now true', () => {
    // The fix belongs at the group: it makes the comment true for EVERY meal group rather than only
    // a lone one, and needs no change to the decision table.
    expect(mealFooter(['meal'])).toEqual({ show: false, showCalories: false })
    expect(mealFooter(['log'])).toEqual({ show: true, showCalories: false })
    expect(mealFooter(['meal', 'log'])).toEqual({ show: true, showCalories: true })
  })
})
