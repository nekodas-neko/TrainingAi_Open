/**
 * #4007: what a generation does when its store finds the lift preferences moved (or cannot ask). The
 * repository is a fake whose preference-checked store answers as scripted; the Postgres behaviour, with
 * the real writers, is `lib/data/postgres/__tests__/generation-preference-race-4007.test.ts`.
 * 0 model requests: the model is a mock that counts its calls.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { AiPrescription } from '@trainingai/shared/types/ai-periodization'
import type { WorkoutRepository } from '@/lib/data/repository'
import { BusyError } from '@trainingai/shared/errors'
import type { LiftPreferenceRow } from '../lift-preference'
import { SCENARIOS, SESSION_ID, fakeRepo } from './fixtures/lift-preference-scenarios'
import { liftPreferencesStamp, liftsWithMovedHold, liftsWithMovedPreference, restateForMovedPreferences } from '../lift-preference-moved'
import { preferencesFromRows } from '../lift-preference-read'

const mocks = vi.hoisted(() => ({ signals: null as unknown, model: null as Record<string, unknown> | null, calls: 0 }))
vi.mock('../signals', async importOriginal => ({
  ...(await importOriginal<typeof import('../signals')>()),
  aggregateSignals: async () => mocks.signals,
}))
vi.mock('@/lib/ai/instrument', () => ({
  loggedGenerateObject: async () => {
    mocks.calls++
    if (!mocks.model) throw new Error('model unavailable (test)')
    return { object: structuredClone(mocks.model) }
  },
}))
const { generatePrescriptionForSession } = await import('../generate-prescription')

const TZ = 'Australia/Brisbane'
const NAMES = ['Lift p', 'Lift s', 'Lift a']
const SC = SCENARIOS[0] // strength, three roles, the model's plan has all three lifts
let n = 0

type Guard = (call: number, guard: { names: string[]; weekStart: string; stamp: string }, plan: AiPrescription) => Promise<'stored' | 'not_stored' | 'preferences_moved'>

function harness(opts: { kind?: string; guard?: Guard | null; scenario?: (typeof SCENARIOS)[number] }) {
  const sc = opts.scenario ?? SC
  const stored: AiPrescription[] = []
  const plain: AiPrescription[] = []
  const rows = new Map<string, LiftPreferenceRow>()
  const guardCalls: { stamp: string; plan: AiPrescription }[] = []
  const program = {
    id: 'prog-1', createdAt: new Date(0), trainingGoal: 'strength', phaseMode: opts.kind ?? 'ai_dynamic',
    sessions: [{ id: SESSION_ID, timeBudgetMinutes: 90, exercises: NAMES.map(exerciseName => ({ exerciseName })) }],
  }
  const extra: Record<string, unknown> = {
    getActiveProgramWithStructureStamp: async () => ({ program, structure: 'stamp' }),
    getActiveProgram: async () => program,
    listExercisePreferences: async (_u: string, names: string[]) => new Map(names.filter(x => rows.has(x)).map(x => [x, rows.get(x)!])),
    storePrescription: async (_u: string, _s: string, p: AiPrescription) => { plain.push(p); return true },
    listPersonalRecords: async () => new Map(),
    getLastRealOneRmBatch: async () => new Map(),
    getExerciseEstimates: async () => [],
  }
  if (opts.guard !== null && opts.guard) {
    const guard = opts.guard
    extra.storePrescriptionIfPreferencesUnchanged = async (
      _u: string, _s: string, p: AiPrescription, _e: Date, _st: string, _g: unknown, g: { names: string[]; weekStart: string; stamp: string },
    ) => {
      guardCalls.push({ stamp: g.stamp, plan: p })
      const out = await guard(guardCalls.length, g, p)
      if (out === 'stored') stored.push(p)
      return out
    }
  }
  const repo = fakeRepo(sc.phase, [], extra)
  const run = () => {
    mocks.signals = structuredClone(sc.signals)
    mocks.model = sc.model
    mocks.calls = 0
    return generatePrescriptionForSession(`user-4007-store-${++n}`, SESSION_ID, repo as WorkoutRepository, TZ)
  }
  return { run, rows, stored, plain, guardCalls }
}

const rowOf = (plan: AiPrescription, id: string) => plan.exercises.find(e => e.sessionExerciseId === id)!

describe('a generation whose lift preferences moved before it stored (#4007)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-21T02:00:00Z'))
  })
  afterEach(() => { vi.useRealTimers() })

  it('restates the plan it made for the new range and stores that, with one model call', async () => {
    const ref: { h?: ReturnType<typeof harness> } = {}
    const h = harness({
      guard: async call => {
        if (call > 1) return 'stored'
        ref.h!.rows.set('Lift s', { repMin: 12, repMax: 15, restSec: null, nextLoadStep: null, setsDelta: null, oneShotSetAt: null })
        return 'preferences_moved'
      },
    })
    ref.h = h
    const result = await h.run()
    expect(result.ok).toBe(true)
    expect(mocks.calls).toBe(1)
    expect(h.guardCalls).toHaveLength(2)
    // The first ask carries the stamp of what the plan was built from (no preference); the second, of the new range.
    const none = liftPreferencesStamp(new Map(), NAMES)
    const withRange = liftPreferencesStamp(preferencesFromRows(h.rows).prefs, NAMES)
    expect(h.guardCalls.map(c => c.stamp)).toEqual([none, withRange])
    expect(none).not.toBe(withRange)
    // The plan stored is the restated one, and it is what the call answers with.
    const first = rowOf(h.guardCalls[0].plan, 's')
    const second = rowOf(h.stored[0], 's')
    expect(first.reps).toBeLessThan(12)
    expect(second.reps).toBeGreaterThanOrEqual(12)
    expect(second.reps).toBeLessThanOrEqual(15)
    expect(second.liftPreference?.repRange).toEqual({ min: 12, max: 15 })
    expect(rowOf(h.stored[0], 'p')).toEqual(rowOf(h.guardCalls[0].plan, 'p'))
    expect(result.ok && result.prescription).toEqual(h.stored[0].exercises ? expect.objectContaining({ exercises: h.stored[0].exercises }) : undefined)
    expect(h.plain).toHaveLength(0)
  })

  it('a preference that keeps moving is restated at most three times, then the plan is stored as it stands', async () => {
    const h = harness({ guard: async () => 'preferences_moved' })
    const result = await h.run()
    expect(result.ok).toBe(true)
    expect(mocks.calls).toBe(1)
    expect(h.guardCalls).toHaveLength(3)
    expect(h.plain).toHaveLength(1) // the paid plan is not lost
  })

  it('a lock that stays busy stores the paid plan as it was generated, with no second model call', async () => {
    const h = harness({ guard: async () => { throw new BusyError() } })
    const result = await h.run()
    expect(result.ok).toBe(true)
    expect(mocks.calls).toBe(1)
    expect(h.plain).toHaveLength(1)
    expect(h.guardCalls).toHaveLength(1)
  })

  it('a slot whose phase moved is not stored, as before', async () => {
    const h = harness({ guard: async () => 'not_stored' })
    const result = await h.run()
    expect(result).toMatchObject({ ok: false, status: 409 })
    expect(h.plain).toHaveLength(0)
  })

  it('a repository without the checked store, a manual program and an automatic one store as before', async () => {
    for (const opts of [{ guard: null }, { kind: 'manual', guard: async () => 'preferences_moved' as const }, { kind: 'automatic', guard: async () => 'preferences_moved' as const }]) {
      const h = harness(opts as Parameters<typeof harness>[0])
      expect((await h.run()).ok).toBe(true)
      expect(h.guardCalls).toHaveLength(0)
      expect(h.plain).toHaveLength(1)
    }
  })

  it('a deload plan carries no preference, so it is stored as before', async () => {
    const h = harness({ scenario: SCENARIOS[4], guard: async () => 'preferences_moved' })
    expect((await h.run()).ok).toBe(true)
    expect(h.guardCalls).toHaveLength(0)
    expect(h.plain).toHaveLength(1)
  })
})

describe('the preference stamp and the restate of a moved lift', () => {
  const pref = (over: Partial<Parameters<typeof preferencesFromRows>[0] extends Iterable<[string, infer R]> | null | undefined ? R : never> = {}) =>
    preferencesFromRows([['Lift s', { repMin: null, repMax: null, restSec: null, nextLoadStep: null, setsDelta: null, oneShotSetAt: null, ...over } as LiftPreferenceRow]], '2026-11-16')

  it('differs for a rep range, a rest, a one-off and a hold, and not for a hold bar', () => {
    const base = liftPreferencesStamp(pref().prefs, NAMES)
    expect(liftPreferencesStamp(pref({ repMin: 8, repMax: 10 }).prefs, NAMES)).not.toBe(base)
    expect(liftPreferencesStamp(pref({ restSec: 60 }).prefs, NAMES)).not.toBe(base)
    expect(liftPreferencesStamp(pref({ nextLoadStep: 'lighter', oneShotSetAt: new Date(1_000) }).prefs, NAMES)).not.toBe(base)
    const held = pref({ checkinHeld: true })
    const withBar = (bar: number | null) => {
      const m = new Map(held.prefs)
      m.set('Lift s', { ...(m.get('Lift s') ?? { repRange: null, restSec: null, oneShot: null }), checkinHold: { weekStart: '2026-11-16', barKg: bar } })
      return liftPreferencesStamp(m, NAMES)
    }
    expect(withBar(60)).not.toBe(base)
    expect(withBar(60)).toBe(withBar(null))
  })

  it('a lift not in the session is not read, so it cannot move the stamp', () => {
    const other = preferencesFromRows([['Some other lift', { repMin: 8, repMax: 10, restSec: null, nextLoadStep: null, setsDelta: null, oneShotSetAt: null }]])
    expect(liftPreferencesStamp(other.prefs, NAMES)).toBe(liftPreferencesStamp(new Map(), NAMES))
  })

  it('moves nothing when nothing moved', () => {
    const plan = { phase: 'accumulation', exercises: [{ sessionExerciseId: 's', name: 'Lift s', sets: 3, reps: 8, pct: 70, restSec: 120 }] } as unknown as AiPrescription
    const same = pref({ restSec: 60 }).prefs
    const ctx = {
      programSessionId: 'ps', phase: 'accumulation' as const, trainingGoal: 'strength', weekStart: '2026-11-16',
      lifts: [{ sessionExerciseId: 's', name: 'Lift s', role: 'secondary', equipment: ['cable'], bodyweight: false }],
      built: same, current: same, basisKg: () => 100,
    }
    expect(liftsWithMovedPreference(ctx)).toEqual([])
    expect(liftsWithMovedHold(ctx)).toEqual([])
    expect(restateForMovedPreferences(plan, ctx)).toBe(plan)
  })
})
