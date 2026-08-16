// Q-240. Editing a goal PATCHed `/api/user/goals` and invalidated nothing, so the Health tab kept
// rendering the previous goal for up to the `user-goals` TTL — and repainted it stale on the next
// cold start, because the same key is seeded synchronously. `patchProfile` in the very same file
// had always called `invalidateGoalRecommendations()`; the goals path simply was never wired to it.
//
// The sibling sweep the entry asked for found the omission on two further surfaces (the Coach
// change-preview and number-dial apply paths), which is why this guard is a rule about *every*
// goal writer rather than an assertion about the one that was reported. A fourth writer added later
// fails here instead of shipping the same 30-minute staleness a third time.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOTS = ['app', 'components', 'lib']
const INVALIDATOR = 'invalidateGoalRecommendations'

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__tests__' || name.startsWith('.')) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(full)) out.push(full)
  }
  return out
}

/**
 * A client-side writer of the user's goals.
 *
 * Deliberately not "any file mentioning goals": the API route itself writes the database and must
 * NOT call a client cache helper, and the read sites legitimately mention the key. What is caught
 * is a *client* module that sends a goal-changing request — either straight to `/api/user/goals`,
 * or through the Coach apply endpoint carrying the `user_goals` patch domain.
 */
function isGoalWriter(src: string): boolean {
  if (!src.includes("'use client'") && !src.includes('"use client"')) return false
  // The URL and the method must be in the SAME call. A file-wide "mentions the URL and mentions
  // PATCH somewhere" test flagged `health-content.tsx`, which only *reads* this endpoint through
  // `cachedFetch` and happens to PATCH other things a few hundred lines away — the guard would have
  // shipped demanding an invalidation from a pure read site.
  const patchesGoals = /\/api\/user\/goals['"`][^)]{0,200}?['"]PATCH['"]/s.test(src)
  // Coach applies goals through its own endpoint, so the URL rule cannot see it. Keyed on
  // `GOAL_LOCAL_STORAGE_KEYS` because that marker is in these files *independently of this fix* —
  // the first version of this guard matched the string `user_goals`, which `number-dial.tsx` did
  // not contain until the fix itself added it. A detector that only recognises writers already
  // carrying the fix is circular: it would have passed on the very code it exists to catch.
  const writesGoalKeys = src.includes('GOAL_LOCAL_STORAGE_KEYS')
  return patchesGoals || writesGoalKeys
}

describe('every client goal writer invalidates the goal caches (Q-240)', () => {
  const files = ROOTS.flatMap(r => walk(r))
  const writers = files.filter(f => isGoalWriter(readFileSync(f, 'utf8')))

  // If this drops to zero the rule below passes vacuously and guards nothing — the failure mode
  // that makes a green guard meaningless. The three known writers are the Profile goals editor,
  // the AI recommendation sheet, and the two Coach apply widgets.
  it('finds the goal writers at all', () => {
    expect(writers.length).toBeGreaterThanOrEqual(4)
  })

  it.each(writers)('%s calls invalidateGoalRecommendations', file => {
    expect(readFileSync(file, 'utf8')).toContain(INVALIDATOR)
  })
})
