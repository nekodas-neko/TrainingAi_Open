// #3285. The Coach apply and undo routes called `invalidateProgramStructure()` on the server, where
// `lib/cache-groups` reaches no cache, and the client sites that get the OK back cleared only goals
// and history. A swap then kept serving the pre-swap programme until the TTL ran out.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const invalidated: string[] = []

vi.mock('@/lib/sqlite/cache', () => ({
  invalidateCache: (k: string) => { invalidated.push(k); return Promise.resolve() },
}))

import { invalidateCoachChange } from '../cache-groups'

beforeEach(() => { invalidated.length = 0 })

const PROGRAMME_KEYS = ['workout-data', 'next-session', 'workout-card:', 'phase-sets', 'ai-periodization-session:']

describe('invalidateCoachChange', () => {
  it.each(['session_exercise', 'program_phase', 'early_deload', 'injury'] as const)(
    'an applied %s change clears the programme caches and the history list', async domain => {
      await invalidateCoachChange(domain)
      expect(invalidated).toEqual(expect.arrayContaining([...PROGRAMME_KEYS, 'coach-history']))
      expect(invalidated).not.toContain('user-goals')
    },
  )

  it.each(['user_goals', 'nutrition_targets'] as const)(
    'an applied %s change clears the goal caches, not the programme', async domain => {
      await invalidateCoachChange(domain)
      expect(invalidated).toEqual(expect.arrayContaining(['user-goals', 'nutrition-targets', 'coach-history']))
      expect(invalidated).not.toContain('workout-data')
    },
  )

  it('an applied injury change also clears the injury list the Health tab and workout screen read', async () => {
    await invalidateCoachChange('injury')
    expect(invalidated).toContain('injuries')
  })

  it.each(['session_exercise', 'user_goals'] as const)('an applied %s change leaves the injury list', async domain => {
    await invalidateCoachChange(domain)
    expect(invalidated).not.toContain('injuries')
  })

  it('an undo, which does not know the domain, clears the superset', async () => {
    await invalidateCoachChange()
    expect(invalidated).toEqual(expect.arrayContaining([...PROGRAMME_KEYS, 'user-goals', 'injuries', 'coach-history']))
  })
})

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__tests__' || name === '__check_fixture__' || name.startsWith('.')) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(full)) out.push(full)
  }
  return out
}

describe('every client that reaches the Coach apply or undo route clears the caches', () => {
  const clients = ['app', 'components']
    .flatMap(r => walk(r))
    .filter(f => !f.startsWith(join('app', 'api')))
    .filter(f => /["'`]\/api\/coach\/apply[\/"'`$]/.test(readFileSync(f, 'utf8')))

  // The four known sites: change-preview, number-dial, the tier-3 confirm screen and Coach history
  // (undo). A count that drops to zero would let the rule below pass on nothing.
  it('finds the apply and undo clients', () => {
    expect(clients.length).toBeGreaterThanOrEqual(4)
  })

  it.each(clients)('%s calls invalidateCoachChange', file => {
    expect(readFileSync(file, 'utf8')).toContain('invalidateCoachChange(')
  })

  it.each(['app/api/coach/apply/route.ts', 'app/api/coach/apply/[id]/undo/route.ts'])(
    '%s does not call a client cache group', file => {
      expect(readFileSync(file, 'utf8')).not.toContain('lib/cache-groups')
    },
  )
})
