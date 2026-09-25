import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/** RV-67. `nutrition-meal-types` now carries `freshWithinTtl: true` at its hot read sites, which
 *  means a read inside the 6-hour TTL does NOT touch the network. That is only safe while every
 *  write of the payload clears the key, and the proof is:
 *
 *   - the four repository writers (`createMealType`, `updateMealType`, `deleteMealType`,
 *     `reassignAndDeleteMealType`) are reached from exactly two routes, `/api/nutrition/meal-types`
 *     and `/api/nutrition/meal-types/[id]`;
 *   - those routes are called from exactly one client file, `meal-type-manager.tsx`, and every one
 *     of its mutating calls is followed by `invalidateMealTypes()`, whose group holds the key;
 *   - nothing else writes them — the offline mirror `replaceMealTypes` has one caller, which
 *     hydrates it FROM this cached response, so it is downstream of the cache rather than a writer.
 *
 *  The fragile half is the second bullet. A new mutating caller somewhere else would not fail any
 *  existing test, and the symptom would be a meal-type list stale for six hours rather than a
 *  crash. This pins it. */

const ROOT = path.resolve(__dirname, '../../..')
const SELF = 'components/nutrition/__tests__/rv67-meal-types-ttl-gate.test.ts'
const OWNER = 'components/nutrition/meal-type-manager.tsx'

/** The whole `cachedFetch(...)`/`useCachedValue(...)` call that reads the key, brace-balanced.
 *  A fixed character window is the same mistake as a regex that cannot balance parens: the first
 *  cut of this test used 700 chars and the flag sat at 720, so it reported a missing flag that was
 *  there. Walk the parens instead. */
function readCallFor(src: string, key: string): string | null {
  const at = src.indexOf(`'${key}', '/api/nutrition/meal-types'`)
  if (at < 0) return null
  const open = src.lastIndexOf('(', at)
  let d = 1, j = open + 1
  while (j < src.length && d > 0) { const c = src[j]; if (c === '(') d++; else if (c === ')') d--; j++ }
  return src.slice(open, j)
}

const sourceFiles = () =>
  execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes('__tests__') && f !== SELF)

describe('RV-67 — the meal-types TTL gate stays safe', () => {
  it('only the manager mutates the meal-types endpoint', () => {
    // A mutating fetch is one whose call text carries a method other than GET. Scanned over the
    // whole call, not the line, because these span several lines.
    const offenders: string[] = []
    for (const f of sourceFiles()) {
      if (f === OWNER || f.startsWith('app/api/')) continue
      const src = readFileSync(path.join(ROOT, f), 'utf8')
      for (const m of src.matchAll(/fetch\(\s*[`'"][^`'"]*api\/nutrition\/meal-types[^`'"]*[`'"]([\s\S]{0,160})/g)) {
        if (/method:\s*['"](POST|PATCH|PUT|DELETE)['"]/.test(m[1])) offenders.push(`${f}: ${m[0].slice(0, 70)}`)
      }
    }
    expect(offenders, 'a new writer of meal types outside the manager breaks RV-67\'s invalidation '
      + 'proof — either route it through the manager, or call invalidateMealTypes() and add the file '
      + 'here with that shown').toEqual([])
  })

  it('every mutating call in the manager is followed by an invalidation', () => {
    const src = readFileSync(path.join(ROOT, OWNER), 'utf8')
    const mutations = [...src.matchAll(/method:\s*['"](POST|PATCH|PUT|DELETE)['"]/g)]
    expect(mutations.length, 'the manager stopped mutating — this test would pass vacuously')
      .toBeGreaterThanOrEqual(3)
    expect(src.match(/invalidateMealTypes\(\)/g)?.length ?? 0,
      'fewer invalidations than mutating calls').toBeGreaterThanOrEqual(mutations.length)
  })

  it('the flag is on the hot read sites and off the writer screen', () => {
    for (const f of ['app/nutrition/nutrition-content.tsx', 'components/nutrition/assign-step.tsx',
                     'components/nutrition/meal-plan-review-step.tsx']) {
      // The FETCH call, not the first mention of the key — these files also `readCacheSync` it to
      // seed, earlier in the file and with no options to carry a flag.
      const call = readCallFor(readFileSync(path.join(ROOT, f), 'utf8'), 'nutrition-meal-types')
      expect(call, `${f} no longer fetches the key`).not.toBeNull()
      expect(call!, `${f} lost freshWithinTtl`).toMatch(/freshWithinTtl:\s*true/)
    }
    // The screen that edits them keeps revalidating, deliberately.
    const owner = readFileSync(path.join(ROOT, OWNER), 'utf8')
    const call = readCallFor(owner, 'nutrition-meal-types')
    expect(call, 'the manager no longer fetches the key').not.toBeNull()
    expect(call!).not.toMatch(/freshWithinTtl/)
  })
})
