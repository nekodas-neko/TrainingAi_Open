import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DAY_TIMELINE_KEY_PREFIX, dayTimelineKey } from '@/lib/hooks/use-day-timeline'

/**
 * TN-35's date-scoped timeline key is invalidated only because it sits under a prefix six write
 * groups already clear. Nothing else enforces that, and missed invalidation is this repo's most
 * repeated bug class — a stale key here would put a deleted meal beside a stress reading and look
 * like data rather than like a cache.
 *
 * Two halves, both needed: the key must be a CHILD of the prefix, and the groups must still clear
 * that prefix as a prefix. Either one changing alone breaks the guarantee silently.
 */
const GROUPS = readFileSync(join(__dirname, '../../../lib/cache-groups.ts'), 'utf8')

describe('the day-timeline cache key is covered by the existing invalidation groups', () => {
  it('builds a key under the prefix, not beside it', () => {
    const key = dayTimelineKey('2026-09-20')
    expect(key.startsWith(DAY_TIMELINE_KEY_PREFIX)).toBe(true)
    // A sibling like `day-timeline:...` would match no group at all. This is the exact
    // prefix-sibling hazard the cache rules name.
    expect(key).toBe('home-day-timeline:2026-09-20')
  })

  it('is still cleared by every group that clears the timeline', () => {
    const calls = [...GROUPS.matchAll(/invalidateCache\('([^']*day-timeline[^']*)'\)/g)].map(m => m[1])
    expect(calls.length, 'no group clears the day timeline any more — the key is now orphaned')
      .toBeGreaterThan(0)
    const key = dayTimelineKey('2026-09-20')
    for (const prefix of calls) {
      expect(key.startsWith(prefix),
        `invalidateCache('${prefix}') no longer covers ${key}`).toBe(true)
    }
  })
})
