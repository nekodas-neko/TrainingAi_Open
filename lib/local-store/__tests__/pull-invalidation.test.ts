// #2543: what a sync pull writes must reach the cache in front of it. The engine half is pinned by
// the `supplements` and `mealPlans` vectors in `packages/shared/src/sync/vectors/pull-flags.json`;
// this pins the caller half — the real `pullDelta` on `node:sqlite`, handed to the one invalidation
// helper the sync provider and the More tab both call — so neither half can regress alone.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
// Comments name `pullDelta(` in prose; only code counts. Line numbers survive the strip.
import { stripComments } from '../../../scripts/lib/strip-comments.js'

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
import { pullDelta, restoreFromCloud, _resetSyncBackoff, type SyncedDomains } from '../sync-engine'
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

// #2550: `pullDelta` advances the cursor, so the caller that runs a pull is the only one that will
// ever see those rows' flags. Eight call sites threw the result away; every one now routes it to
// `invalidatePulledDomains`. This scan fails on the next caller that does not.
//
// The engine was not taught to invalidate for itself, which would make the rule impossible to miss:
// `sync-engine.ts` runs under the node parity-vector runner, and importing the cache layer there
// would need `@/lib/sqlite/cache` stubbed in every file that drives the real engine.
describe('every pullDelta caller routes its flags to the cache (#2550)', () => {
  // A file listed here may call `pullDelta` without the hand-off; each needs a reason a reviewer
  // can check, not a wave-through.
  const MAY_IGNORE: Record<string, string> = {
    // The engine's own restore driver. It does not drop the flags: it ORs every page's `domains`
    // into its return value, and its one caller (data-sync-panel's Restore) invalidates them —
    // pinned by the `restoreFromCloud` tests below and by the Restore assertion in this block.
    'lib/local-store/sync-engine.ts': 'restoreFromCloud returns the merged flags to its caller',
  }
  const ROOTS = ['app', 'components', 'hooks', 'lib', 'packages/shared/src']
  // How far below the call the hand-off may sit: the More tab awaits an allSettled first.
  const WINDOW_LINES = 8

  function sourceFiles(dir: string): string[] {
    const out: string[] = []
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === '__tests__' || name.startsWith('.')) continue
      const full = join(dir, name)
      if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full)
    }
    return out
  }

  /** The 1-based lines of each `pullDelta(` call with no `invalidatePulledDomains(` close below it. */
  function unrouted(src: string): number[] {
    const lines = stripComments(src).split('\n')
    const bad: number[] = []
    lines.forEach((line, i) => {
      if (!/\bpullDelta\(/.test(line)) return
      if (/\bfunction\s+pullDelta\(/.test(line)) return
      const window = lines.slice(i, i + WINDOW_LINES + 1).join('\n')
      if (!/\binvalidatePulledDomains\(/.test(window)) bad.push(i + 1)
    })
    return bad
  }

  const callers = ROOTS.flatMap(root => sourceFiles(join(process.cwd(), root)))
    .map(full => ({ file: relative(process.cwd(), full).split(sep).join('/'), src: readFileSync(full, 'utf8') }))
    .filter(({ src }) => /\bpullDelta\(/.test(stripComments(src)))

  it('finds the callers it is guarding', () => {
    // A scan that silently matched nothing would pass forever.
    expect(callers.map(c => c.file)).toEqual(expect.arrayContaining([
      'app/health/health-content.tsx', 'app/more/more-content.tsx',
      'app/session-select/session-select-content.tsx', 'components/config-screen.tsx',
      'components/guided-walk/walk-summary.tsx', 'components/more/data-sync-panel.tsx',
      'components/sync-provider.tsx', 'components/workout-screen.tsx',
    ]))
  })

  it('every call site hands its result to invalidatePulledDomains', () => {
    const offenders = callers
      .filter(({ file }) => !(file in MAY_IGNORE))
      .flatMap(({ file, src }) => unrouted(src).map(line => `${file}:${line}`))
    expect(offenders).toEqual([])
  })

  it('flags a fire-and-forget pull and passes a routed one', () => {
    expect(unrouted('if (userId) pullDelta(userId, true).catch(() => {});')).toEqual([1])
    // A hand-off that only exists in a comment is not one.
    expect(unrouted('await pullDelta(userId, true) // invalidatePulledDomains(x)')).toEqual([1])
    expect(unrouted(
      'pullDelta(u).then(res => { if (res) return invalidatePulledDomains(res.domains); }).catch(() => {})',
    )).toEqual([])
  })

  it('the Restore button invalidates what restoreFromCloud returns', () => {
    const src = readFileSync(join(process.cwd(), 'components/more/data-sync-panel.tsx'), 'utf8')
    const code = stripComments(src)
    const at = code.indexOf('await restoreFromCloud(')
    expect(at).toBeGreaterThan(-1)
    expect(code.slice(at, at + 400)).toMatch(/invalidatePulledDomains\(result\.domains\)/)
  })
})

describe('restoreFromCloud carries every page\'s flags (#2550)', () => {
  const SUPPLEMENT = { id: 'sup-1', name: 'Creatine', dose: '5 g', defaultAmount: 5, unit: 'g', sortOrder: 0,
    active: true, dosePrompt: false, reminderEnabled: false,
    updatedAt: '2026-09-30T20:00:00.000Z', deletedAt: null }
  const MEAL_PLAN = { id: 'mp-1', name: 'Cut', isActive: true, mealsPerDay: 4, targetCalories: 2400,
    targetProteinG: 180, targetCarbsG: 250, targetFatG: 70, trainingTime: null,
    generatedAt: '2026-09-29T00:00:00.000Z', lastReviewedAt: null,
    updatedAt: '2026-09-29T00:00:00.000Z', deletedAt: null }

  // `pullDelta` stops at 20 pages, so page 21 belongs to the restore's second `pullDelta` call: the
  // flags have to survive across calls, not only across the pages of one.
  async function restore(pageAt: (n: number) => Record<string, unknown> | null) {
    let n = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      const page = pageAt(n++)
      return page
        ? { ok: true, status: 200, json: async () => ({ ...EMPTY_PAGE, ...page }) }
        : { ok: false, status: 503, json: async () => ({}) }
    }))
    try {
      _resetSyncBackoff()
      openVectorDb()
      return await restoreFromCloud('pull-invalidation-user')
    } finally {
      vi.unstubAllGlobals()
    }
  }

  it('ORs a flag raised in the first pull with one raised in the second', async () => {
    const res = await restore(n =>
      n === 0 ? { supplements: [SUPPLEMENT], hasMore: true }
      : n < 20 ? { hasMore: true }
      : { mealPlans: [MEAL_PLAN], hasMore: false })
    expect(res!.failed).toBe(false)
    expect(res!.domains.supplements).toBe(true)
    expect(res!.domains.mealPlans).toBe(true)
    await invalidatePulledDomains(res!.domains)
    expect(invalidated).toEqual(expect.arrayContaining(['supplements', 'meal-plans']))
  })

  it('a paused restore still returns the flags of the pages it wrote', async () => {
    const res = await restore(n =>
      n === 0 ? { supplements: [SUPPLEMENT], hasMore: true }
      : n < 20 ? { hasMore: true }
      : null)
    expect(res!.failed).toBe(true)
    expect(res!.domains.supplements).toBe(true)
  })
})
