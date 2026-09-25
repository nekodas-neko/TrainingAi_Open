import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/** RV-67, second key. `nutrition-targets` carries `freshWithinTtl: true`, so a read inside the
 *  6-hour TTL does not touch the network. The proof that makes it safe:
 *
 *   - the GET is a stored-row read (`repo.getNutritionTargets`), NOT a derivation — so a body-weight
 *     write cannot change the payload behind the cache's back;
 *   - `upsertNutritionTargets` has exactly two callers, `PUT /api/nutrition/targets` and — the
 *     non-obvious one — `PUT /api/user/goals`, which upserts targets as a side effect, making every
 *     goals writer a targets writer;
 *   - all four client files that write through those routes call `invalidateGoalRecommendations()`,
 *     which holds the key;
 *   - nothing in the sync delta or local store carries `nutrition_targets` or `user_goals`.
 *
 *  The fragile half is the second bullet: a goals writer that forgets the invalidation would leave a
 *  stale target for six hours with no crash. That is what this pins. */

const ROOT = path.resolve(__dirname, '../..')
const GROUP = 'invalidateGoalRecommendations'

const sourceFiles = () =>
  execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes('__tests__') && !f.startsWith('app/api/'))

describe('RV-67 — the nutrition-targets TTL gate stays safe', () => {
  it('the payload is still a stored row, not a derivation', () => {
    // If this route ever computes targets from weight or goals, every such write becomes a writer of
    // this key and the proof has to be redone from scratch.
    const route = readFileSync(path.join(ROOT, 'app/api/nutrition/targets/route.ts'), 'utf8')
    const get = route.slice(route.indexOf('export async function GET'), route.indexOf('export async function PUT'))
    expect(get).toMatch(/getNutritionTargets\(/)
    expect(get, 'the GET now derives something — redo the RV-67 proof').not.toMatch(/getBodyMetrics|computeT[dD]ee|getUserGoals/)
  })

  it('every client that writes targets or goals invalidates the group', () => {
    const offenders: string[] = []
    let writers = 0
    for (const f of sourceFiles()) {
      const src = readFileSync(path.join(ROOT, f), 'utf8')
      // A write is a fetch of either route carrying a mutating method.
      const touches = /['"`][^'"`]*\/api\/(nutrition\/targets|user\/goals)[^'"`]*['"`]/.test(src)
      if (!touches) continue
      if (!/method:\s*['"](POST|PUT|PATCH|DELETE)['"]|writeJson\([^)]*['"](PUT|POST|PATCH)['"]/.test(src)) continue
      writers++
      if (!src.includes(GROUP)) offenders.push(f)
    }
    expect(writers, 'no writer found — this test would pass vacuously').toBeGreaterThanOrEqual(3)
    expect(offenders, `a writer of targets/goals does not call ${GROUP}(), which is what keeps `
      + 'freshWithinTtl safe on nutrition-targets — six hours of a stale target, with no crash').toEqual([])
  })

  it('the group still contains the key, and the flag is on the read path only', () => {
    expect(readFileSync(path.join(ROOT, 'lib/cache-groups.ts'), 'utf8'))
      .toMatch(/invalidateGoalRecommendations[\s\S]{0,400}nutrition-targets/)
    const hook = readFileSync(path.join(ROOT, 'app/nutrition/use-nutrition-targets-refresh.ts'), 'utf8')
    expect(hook).toMatch(/freshWithinTtl:\s*true/)
    // The invalidation subscription is what makes the flag safe — without it a cleared entry would
    // not be re-read until something else happened to fetch.
    expect(hook).toMatch(/useInvalidationRefetch\('nutrition-targets'/)
    // The writer screen and the warm list stay unflagged: flag component read paths, never warming.
    const pane = readFileSync(path.join(ROOT, 'components/profile/macro-targets-pane.tsx'), 'utf8')
    const at = pane.indexOf("'nutrition-targets', '/api/nutrition/targets'")
    expect(pane.slice(at, at + 300)).not.toMatch(/freshWithinTtl/)
  })
})
