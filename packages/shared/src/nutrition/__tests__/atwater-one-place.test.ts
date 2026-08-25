// LB-9: the Atwater factors had four longhand copies — an unexported `KCAL_PER_G` in
// `calorie-balance.ts`, four hardcoded `* 4` / `* 9` sites in `goal-recommendation.ts`, and a
// component copy that existed only because it could not reach either.
//
// Source-scraped, not just value-compared: the point is that the numbers are not RETYPED, and an
// imported value cannot tell a literal `4` from a reference to one.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { KCAL_PER_G } from '../atwater'

const root = join(__dirname, '..', '..', '..', '..', '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

const CONSUMERS = [
  'packages/shared/src/nutrition/calorie-balance.ts',
  'packages/shared/src/nutrition/goal-recommendation.ts',
  'components/nutrition/macro-energy.ts',
]

describe('the Atwater factors live in one place (LB-9)', () => {
  it('is the only declaration in the repo', () => {
    // A second `KCAL_PER_G = { … }` anywhere is a fifth copy being born.
    for (const path of CONSUMERS) {
      expect(read(path)).not.toMatch(/KCAL_PER_G\s*=\s*\{/)
    }
    expect(read('packages/shared/src/nutrition/atwater.ts')).toMatch(/KCAL_PER_G\s*=\s*\{/)
  })

  it.each(CONSUMERS)('%s imports them rather than redeclaring', path => {
    expect(read(path)).toMatch(/import \{ KCAL_PER_G \} from/)
  })

  it('leaves no hardcoded 4 / 9 in the macro maths', () => {
    // The four sites the entry named. `goal-recommendation.ts` is where they hid, because
    // `proteinG * 4` reads as arithmetic rather than as a constant.
    const src = read('packages/shared/src/nutrition/goal-recommendation.ts')
    expect(src).not.toMatch(/proteinG \* 4/)
    expect(src).not.toMatch(/carbsG \* 4/)
    expect(src).not.toMatch(/fatG \* 9/)
  })

  it('holds the values the four copies agreed on', () => {
    // Behaviour-preserving by construction: every copy already said this, which is why the fold is
    // safe. Pinned so a future edit to the constants is a deliberate act, not a refactor's side effect.
    expect(KCAL_PER_G).toEqual({ protein: 4, carbs: 4, fat: 9 })
  })
})
