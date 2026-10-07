// #2543: what a sync pull writes must reach the cache in front of it. The engine half is pinned by
// the `supplements` and `mealPlans` vectors in `packages/shared/src/sync/vectors/pull-flags.json`;
// this pins the caller half — the real `pullDelta` on `node:sqlite`, handed to the one invalidation
// helper the sync provider and the More tab both call — so neither half can regress alone.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const invalidated: string[] = []

vi.mock('@/lib/sqlite/sqlite-service', () => import('./parity/node-sqlite-service'))
vi.mock('@/lib/sqlite/cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/sqlite/cache')>()),
  invalidateCache: (k: string) => { invalidated.push(k); return Promise.resolve() },
}))
// Same stand-in as parity-vectors.test.ts: `getLocalStore`'s CommonJS require cannot load under
// vitest, and choosing the store is none of what this file pins.
vi.mock('../index', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../index')>()
  const { SQLiteLocalStore } = await import('../sqlite-backend')
  const store = new SQLiteLocalStore()
  return { ...actual, getLocalStore: () => store }
})

import { PULL_FLAGS } from '@trainingai/shared/sync/vectors/schema'
import { invalidatePulledDomains } from '@/lib/cache-groups'
import { pullDelta, _resetSyncBackoff, type SyncedDomains } from '../sync-engine'
import { openVectorDb } from './parity/node-sqlite-service'

const EMPTY_PAGE = {
  programs: [], progressionStyles: [], bodyMetrics: [], sleepSessions: [], moodLogs: [],
  activityLogs: [], workoutSessions: [], syncedAt: '2026-10-01T01:00:00.000Z',
}

async function pullOne(page: Record<string, unknown>) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true, status: 200, json: async () => ({ ...EMPTY_PAGE, ...page }),
  })))
  try {
    _resetSyncBackoff()
    openVectorDb()
    return await pullDelta('pull-invalidation-user', true)
  } finally {
    vi.unstubAllGlobals()
  }
}

const noFlags = (): SyncedDomains =>
  Object.fromEntries(PULL_FLAGS.map(f => [f, false])) as unknown as SyncedDomains

beforeEach(() => { invalidated.length = 0 })

describe('a pull reaches the cache it changed (#2543)', () => {
  it('a supplement-only page invalidates the supplements cache', async () => {
    const res = await pullOne({
      supplements: [{ id: 'sup-1', name: 'Creatine', dose: '5 g', defaultAmount: 5, unit: 'g', sortOrder: 0,
        active: true, dosePrompt: false, reminderEnabled: false,
        updatedAt: '2026-09-30T20:00:00.000Z', deletedAt: null }],
    })
    expect(res!.synced).toBe(1)
    await invalidatePulledDomains(res!.domains)
    expect(invalidated).toContain('supplements')
    expect(invalidated).not.toContain('meal-plans')
  })

  it('a meal-plan page invalidates the meal-plan cache', async () => {
    const res = await pullOne({
      mealPlans: [{ id: 'mp-1', name: 'Cut', isActive: true, mealsPerDay: 4, targetCalories: 2400,
        targetProteinG: 180, targetCarbsG: 250, targetFatG: 70, trainingTime: null,
        generatedAt: '2026-09-29T00:00:00.000Z', lastReviewedAt: null,
        updatedAt: '2026-09-29T00:00:00.000Z', deletedAt: null }],
      mealPlanVariants: [{ id: 'mpv-1', mealPlanId: 'mp-1', dayType: 'training', targetCalories: 2400,
        targetProteinG: 180, targetCarbsG: 250, targetFatG: 70 }],
      mealPlanMeals: [{ id: 'mpm-1', variantId: 'mpv-1', position: 0, name: 'Breakfast', notes: null,
        targetCalories: 600, targetProteinG: 45, targetCarbsG: 60, targetFatG: 18, ingredients: [],
        suggestedTime: null }],
    })
    // Plan, variant and meal: every row the page wrote is counted.
    expect(res!.synced).toBe(3)
    await invalidatePulledDomains(res!.domains)
    expect(invalidated).toEqual(expect.arrayContaining(['meal-plans', 'meal-plan-active']))
  })

  it('a set edited on its own invalidates the workout summaries', async () => {
    const res = await pullOne({
      setLogs: [{ id: 'set-1', exerciseLogId: 'el-1', setNumber: 1, weightKg: 100, reps: 5,
        updatedAt: '2026-09-30T20:00:00.000Z' }],
    })
    expect(res!.domains.workouts).toBe(true)
    await invalidatePulledDomains(res!.domains)
    expect(invalidated).toContain('weekly-stats')
  })

  it('an empty page invalidates nothing', async () => {
    const res = await pullOne({})
    await invalidatePulledDomains(res!.domains)
    expect(invalidated).toEqual([])
  })
})

describe('invalidatePulledDomains', () => {
  // dayCheckins has no cache: that UI reads the local store / API directly.
  for (const flag of PULL_FLAGS.filter(f => f !== 'dayCheckins')) {
    it(`acts on ${flag}`, async () => {
      await invalidatePulledDomains({ ...noFlags(), [flag]: true })
      expect(invalidated.length).toBeGreaterThan(0)
    })
  }

  it('does nothing when no flag is raised', async () => {
    await invalidatePulledDomains(noFlags())
    expect(invalidated).toEqual([])
  })
})

describe('callers of the pull', () => {
  // The provider and the More tab each kept a hand-written copy of this block, gated on
  // `synced > 0`; More's never had a meal-plan line. Both now hand the flags to the one helper.
  for (const file of ['components/sync-provider.tsx', 'app/more/more-content.tsx']) {
    it(`${file} hands the pull's flags to invalidatePulledDomains`, () => {
      const src = readFileSync(join(process.cwd(), file), 'utf8')
      expect(src).toMatch(/invalidatePulledDomains\(delta\.domains\)/)
      expect(src).not.toMatch(/delta\.domains\.\w+/)
      expect(src).not.toMatch(/delta\.synced\s*>\s*0/)
    })
  }
})
