import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { stripComments } from '../../../scripts/lib/strip-comments.js'

const ROOT = path.resolve(__dirname, '../../..')
const file = stripComments(readFileSync(path.join(ROOT, 'components/more/stats-grid.tsx'), 'utf8'))

/** `formatVolume`'s body alone — `formatDistance` sits in the same file and emits `km`. */
const src = file.slice(file.indexOf('function formatVolume'), file.indexOf('function formatDistance'))

/**
 * RV-207 ⑦ — `13.0T` reads as thirteen trillion.
 *
 * Uppercase `T` is the SI symbol for the tesla; the tonne is lowercase `t`, and `kT` was a
 * kilotesla where a kilotonne is `kt`. There is no DOM project in this suite and `formatVolume`
 * is module-private, so this is a source assertion — enough to stop the capital coming back,
 * which is the whole failure.
 */
describe('RV-207 — lifetime volume is written in tonnes, not teslas', () => {
  /** Every unit `formatVolume` can emit, read off the end of each template literal. */
  const units = [...src.matchAll(/\}\s*([A-Za-z]+)`/g)].map(m => m[1])

  it('emits tonnes, kilotonnes and kilograms — all lowercase', () => {
    expect(units).toEqual(['kt', 't', 'kg'])
  })

  it('separates the number from the unit in every branch', () => {
    // `13.0t` is as wrong to read as `13.0T` was; the space is what makes it a unit rather than
    // a suffix, and the kilogram branch had none either.
    expect(src).not.toMatch(/\}[A-Za-z]+`/)
  })
})
