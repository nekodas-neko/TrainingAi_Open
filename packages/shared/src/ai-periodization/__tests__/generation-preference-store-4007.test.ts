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
import { preferencesFromRows, withCheckinHold } from '../lift-preference-read'

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

type Store = (call: number, plan: AiPrescription) => 'busy' | 'refused' | 'reread_fails' | 'ok'

/**
 * `opts.store` scripts the repository's checked store (the Postgres one is `generation-preference-race-4007.test.ts`);
 * `opts.beforeStore(call)` changes the lifts' rows as a writer would while the model was answering. The fake does what
 * the adapter does under its lock: re-read the rows, compare with the stamp, restate through the caller's `restate`
 * when they moved, store.
 */
function harness(opts: { kind?: string; checked?: boolean; store?: Store; beforeStore?: (rows: Map<string, LiftPreferenceRow>, call: number) => void; scenario?: (typeof SCENARIOS)[number]; failBarRead?: boolean }) {
  const sc = opts.scenario ?? SC
  const stored: AiPrescription[] = []
  const plain: AiPrescription[] = []
  const rows = new Map<string, LiftPreferenceRow>()
  const storeCalls: { stamp: string; plan: AiPrescription }[] = []
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
    getLastExerciseLogsBatch: async () => { if (opts.failBarRead) throw new Error('bar read failed (test)'); return new Map() },
  }
  if (opts.checked !== false) {
    extra.storePrescriptionForCurrentPreferences = async (
      _u: string, _s: string, p: AiPrescription, _e: Date, _st: string, _g: unknown,
      g: { names: string[]; weekStart: string; stamp: string; finalize: (p: AiPrescription) => AiPrescription; restate: (c: { prefs: Map<string, never>; held: string[] }) => Promise<AiPrescription> },
    ) => {
      storeCalls.push({ stamp: g.stamp, plan: p })
      opts.beforeStore?.(rows, storeCalls.length)
      const verdict = opts.store?.(storeCalls.length, p) ?? 'ok'
      if (verdict === 'busy') throw new BusyError()
      if (verdict === 'reread_fails') throw new Error('re-read failed (test)')
      const { prefs, held } = preferencesFromRows(new Map(g.names.filter(x => rows.has(x)).map(x => [x, rows.get(x)!])), g.weekStart)
      for (const name of held) withCheckinHold(prefs, name, g.weekStart, null)
      let plan = p
      if (liftPreferencesStamp(prefs, g.names) !== g.stamp) {
        try { plan = await g.restate({ prefs: prefs as never, held }) } catch { /* stored as generated, as the adapter does */ }
      }
      if (verdict === 'refused') return { stored: false, prescription: plan }
      stored.push(g.finalize(plan))
      return { stored: true, prescription: plan }
    }
  }
  const repo = fakeRepo(sc.phase, [], extra)
  const run = () => {
    mocks.signals = structuredClone(sc.signals)
    mocks.model = sc.model
    mocks.calls = 0
    return generatePrescriptionForSession(`user-4007-store-${++n}`, SESSION_ID, repo as WorkoutRepository, TZ)
  }
  return { run, rows, stored, plain, storeCalls }
}

const rowOf = (plan: AiPrescription, id: string) => plan.exercises.find(e => e.sessionExerciseId === id)!

describe('a generation whose lift preferences moved before it stored (#4007)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-21T02:00:00Z'))
  })
  afterEach(() => { vi.useRealTimers() })

  const RANGE: LiftPreferenceRow = { repMin: 12, repMax: 15, restSec: null, nextLoadStep: null, setsDelta: null, oneShotSetAt: null }

  it('restates the plan it made for the new range and stores that, with one model call and one store', async () => {
    const h = harness({ beforeStore: rows => { rows.set('Lift s', RANGE) } })
    const result = await h.run()
    expect(result.ok).toBe(true)
    expect(mocks.calls).toBe(1)
    expect(h.storeCalls).toHaveLength(1)
    // The one ask carries the stamp of what the plan was built from (no preference).
    expect(h.storeCalls[0].stamp).toBe(liftPreferencesStamp(new Map(), NAMES))
    const first = rowOf(h.storeCalls[0].plan, 's')
    const second = rowOf(h.stored[0], 's')
    expect(first.reps).toBeLessThan(12)
    expect(second.reps).toBeGreaterThanOrEqual(12)
    expect(second.reps).toBeLessThanOrEqual(15)
    expect(second.liftPreference?.repRange).toEqual({ min: 12, max: 15 })
    expect(rowOf(h.stored[0], 'p')).toEqual(rowOf(h.storeCalls[0].plan, 'p'))
    expect(result.ok && result.prescription.exercises).toEqual(h.stored[0].exercises)
    expect(h.plain).toHaveLength(0)
  })

  // The old store restated at most three times and then stored unchecked: a 4th change was lost. The store is now
  // one locked step, so the number of changes made while the model answered, or at any moment before the lock, cannot matter.
  it.each([1, 3, 4, 6, 10])('%i changes before the store: the plan stored is the plan for the last state, with 1 model call', async changes => {
    const ranges = [[4, 6], [6, 8], [8, 10], [10, 12], [12, 15], [3, 5], [5, 7], [7, 9], [9, 11], [14, 18]]
    const h = harness({
      beforeStore: rows => {
        for (let k = 0; k < changes; k++) rows.set('Lift s', { ...RANGE, repMin: ranges[k][0], repMax: ranges[k][1] })
      },
    })
    const result = await h.run()
    expect(result.ok).toBe(true)
    expect(mocks.calls).toBe(1)
    const last = ranges[changes - 1]
    expect(rowOf(h.stored[0], 's').liftPreference?.repRange).toEqual({ min: last[0], max: last[1] })
    expect(h.plain).toHaveLength(0)
    expect(rowOf(h.stored[0], 's').reps).toBeGreaterThanOrEqual(last[0])
    expect(rowOf(h.stored[0], 's').reps).toBeLessThanOrEqual(last[1])
  })

  it('a lock that stays busy stores the paid plan as it was generated, with no second model call', async () => {
    const h = harness({ store: () => 'busy' })
    const result = await h.run()
    expect(result.ok).toBe(true)
    expect(mocks.calls).toBe(1)
    expect(h.plain).toHaveLength(1)
    expect(h.storeCalls).toHaveLength(1)
  })

  it('a re-read that fails is not "no preferences": the plan is stored as generated, no restate, logged once', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const h = harness({ store: () => 'reread_fails', beforeStore: rows => { rows.set('Lift s', RANGE) } })
    const result = await h.run()
    expect(result.ok).toBe(true)
    expect(mocks.calls).toBe(1)
    expect(h.plain).toHaveLength(1)
    expect(h.plain[0].exercises).toEqual(h.storeCalls[0].plan.exercises)
    expect(err.mock.calls.filter(c => String(c[0]).includes('re-reading the lift preferences'))).toHaveLength(1)
    err.mockRestore()
  })

  it('a read the restate needs fails before the store: the plan is stored as generated by the plain store, no restate, logged once', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const h = harness({ failBarRead: true, beforeStore: rows => { rows.set('Lift s', { ...RANGE, checkinHeld: true }) } })
    const result = await h.run()
    expect(result.ok).toBe(true)
    // The checked store (the one that takes the lock) was never asked: the reads came first and failed.
    expect(h.storeCalls).toHaveLength(0)
    expect(h.plain).toHaveLength(1)
    expect(err.mock.calls.filter(c => String(c[0]).includes('reading what a restate needs'))).toHaveLength(1)
    err.mockRestore()
  })

  it('a slot whose phase moved is not stored, as before', async () => {
    const h = harness({ store: () => 'refused' })
    const result = await h.run()
    expect(result).toMatchObject({ ok: false, status: 409 })
    expect(h.plain).toHaveLength(0)
  })

  it('a repository without the checked store, a manual program and an automatic one store as before', async () => {
    for (const opts of [{ checked: false }, { kind: 'manual' }, { kind: 'automatic' }]) {
      const h = harness({ ...opts, beforeStore: rows => { rows.set('Lift s', RANGE) } })
      expect((await h.run()).ok).toBe(true)
      expect(h.storeCalls).toHaveLength(0)
      expect(h.plain).toHaveLength(1)
    }
  })

  it('a deload plan carries no preference, so it is stored as before', async () => {
    const h = harness({ scenario: SCENARIOS[4] })
    expect((await h.run()).ok).toBe(true)
    expect(h.storeCalls).toHaveLength(0)
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
