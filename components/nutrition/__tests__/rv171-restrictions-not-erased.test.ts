import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { sameRestrictions } from '../restrictions-diff'

const ROOT = path.resolve(__dirname, '../../..')
const SHEET = 'components/nutrition/meal-plan-setup-sheet.tsx'
const src = () => readFileSync(path.join(ROOT, SHEET), 'utf8')

/**
 * RV-171 — opening the meal-plan setup with a failed request erased every dietary restriction.
 *
 * The load used a bare `fetch` with `if (!d) return` / `.catch(() => {})`, so a failure left
 * `restrictions` at its initial `[]`. `handleGenerate` then PUT `{ entries: restrictions }`
 * unconditionally into `replaceUserDietaryRestrictions`, which DELETES every row for the user
 * before inserting. One 429, 5xx or dropped request while the sheet opened wiped the owner's
 * allergies and intolerances — and the plan was generated without them, because the generate route
 * reads them back from the database.
 *
 * The sheet itself is only reachable with no active plan, which the seeded e2e user has, so the
 * browser path is not driven here. `sameRestrictions` is tested as the pure function it is; the
 * two guards around the write are asserted on source.
 */
describe('RV-171 — sameRestrictions compares sets, not lists', () => {
  const peanut = { restrictionId: 'peanut', severity: 'allergy' as const }
  const gluten = { restrictionId: 'gluten', severity: 'intolerance' as const }

  it('is order-insensitive — the picker rebuilds the array on every toggle', () => {
    // Order equality would make almost every open look like an edit and re-run the delete-and-
    // reinsert this guard exists to avoid.
    expect(sameRestrictions([peanut, gluten], [gluten, peanut])).toBe(true)
  })

  it('sees a severity change, which is the edit most easily missed', () => {
    expect(sameRestrictions([peanut], [{ restrictionId: 'peanut', severity: 'intolerance' }])).toBe(false)
  })

  it('sees an addition and a removal', () => {
    expect(sameRestrictions([peanut], [peanut, gluten])).toBe(false)
    expect(sameRestrictions([peanut, gluten], [peanut])).toBe(false)
  })

  it('treats two empty sets as equal, so an empty load never triggers a write', () => {
    expect(sameRestrictions([], [])).toBe(true)
  })

  it('does not call a shorter list equal to a longer one that contains it', () => {
    // The `every` half alone would pass here; the length check is what makes it symmetric.
    expect(sameRestrictions([peanut, peanut], [peanut])).toBe(false)
  })
})

describe('RV-171 — the write cannot fire without a successful load', () => {
  it('records what the server had, separately from what is being edited', () => {
    expect(src()).toMatch(/const \[loadedRestrictions, setLoadedRestrictions\] = useState<RestrictionSelection\[\] \| null>\(null\)/)
  })

  it('a failed load sets the failure flag instead of silently leaving an empty set', () => {
    const s = src()
    expect(s).toMatch(/if \(!d\) \{ setRestrictionsFailed\(true\); return \}/)
    expect(s).toMatch(/\.catch\(\(\) => setRestrictionsFailed\(true\)\)/)
    // The old swallow is gone: a bare `.catch(() => {})` on THIS fetch is the defect itself.
    expect(s).not.toMatch(/dietary-restrictions'\)\s*\n[\s\S]{0,400}?\.catch\(\(\) => \{\}\)/)
  })

  it('the PUT is guarded on BOTH a successful load and an actual edit', () => {
    expect(src()).toMatch(/if \(loadedRestrictions && !sameRestrictions\(loadedRestrictions, restrictions\)\)/)
  })

  it('the PUT response is read rather than swallowed', () => {
    const s = src()
    expect(s).toMatch(/const res = await fetch\('\/api\/nutrition\/dietary-restrictions'/)
    expect(s).toMatch(/if \(!res\?\.ok\)/)
  })

  it('the failed load is visible to the user, not only to the code', () => {
    expect(src()).toMatch(/restrictionsFailed && \(/)
  })
})
