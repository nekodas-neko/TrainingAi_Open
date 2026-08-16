import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const invalidated: string[] = []

vi.mock('@/lib/sqlite/cache', () => ({
  invalidateCache: (k: string) => { invalidated.push(k); return Promise.resolve() },
}))

import { invalidateOuraSync, invalidateCoachHistory } from '../cache-groups'

beforeEach(() => { invalidated.length = 0 })

const root = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

/**
 * Q-165 triage: three render-path GETs were converted from bare `fetch` to a `readCacheSync` seed
 * plus `cachedFetch`, so a repeat visit paints last-known data instead of a skeleton.
 *
 * A converted key is only safe if every write that changes its payload clears it — that is the
 * half a source-text assertion cannot see, so it is proven against the real group helpers here.
 * The call sites themselves are asserted as source text because this suite runs `environment:
 * 'node'` with no jsdom, so a React component cannot be rendered.
 */
describe('Q-165 — converted reads seed from cache, and their keys are invalidated', () => {
  it('an Oura/HR sync clears the per-activity HR traces it just changed', async () => {
    // The window is fixed but its samples are not: an activity reviewed before its HR landed
    // caches an empty trace, and only this prefix clear replaces it.
    await invalidateOuraSync()
    expect(invalidated).toContain('hr-window:')
  })

  it('the coach history key is cleared by its own group', async () => {
    await invalidateCoachHistory()
    expect(invalidated).toContain('coach-history')
  })

  it('every write that changes the coach history list invalidates it', () => {
    // A saved conversation and an applied change are the only two things that add a row.
    for (const file of [
      'app/coach/coach-content.tsx',        // thread save
      'components/coach/change-preview.tsx', // apply, multi-change
      'components/coach/number-dial.tsx',    // apply, single tier-1 value
    ]) {
      expect(read(file), file).toContain('invalidateCoachHistory')
    }
  })

  it('the three converted call sites no longer bare-fetch their route', () => {
    const cases: Array<[string, string]> = [
      ['components/activity/exercise-review-sheet.tsx', '/api/oura/hr-window'],
      ['components/activity/activity-detail-sheet.tsx', '/api/oura/hr-window'],
      ['components/coach/coach-history.tsx', '/api/coach/threads'],
    ]
    for (const [file, route] of cases) {
      const src = read(file)
      expect(src, file).toMatch(/readCacheSync</)
      expect(src, file).toMatch(/cachedFetch</)
      // The route string must not sit behind a bare `fetch(` any more.
      expect(src.match(new RegExp(`fetch\\(\`?['"\`]?${route.replace(/\//g, '\\/')}`, 'g')), file).toBeNull()
    }
  })

  it('a cache key that embeds the window cannot serve another activity’s trace', () => {
    // Both HR sites key by the query string, not by the activity id — editing an activity's
    // times changes the key, so the seed misses rather than painting the pre-edit trace.
    for (const file of [
      'components/activity/exercise-review-sheet.tsx',
      'components/activity/activity-detail-sheet.tsx',
    ]) {
      expect(read(file), file).toMatch(/`hr-window:\$\{(query|params)\}`/)
    }
  })
})
