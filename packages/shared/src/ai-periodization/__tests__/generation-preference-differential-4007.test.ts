/**
 * #4007: the store's preference check changes nothing when nothing moved.
 *
 * A differential over the generation path: each of 600 seeded cases (a spread of scenarios, program kinds
 * and random lift preferences, one-offs and check-in holds) is generated twice with the model mocked, once
 * through a repository that has no preference-checked store (what `main` does) and once through one that has
 * it and finds the preferences as they were read. The two stored plans, and the plan each run answers with,
 * must be byte-identical: 0 differ. The program kinds `automatic` and `manual` never reach the check.
 *
 * With `DIFFERENTIAL_DUMP=<file>` the first run's plans are written there, one line per case, so the same
 * file written on `main` can be compared with this branch's. 0 real model requests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { appendFileSync, writeFileSync } from 'node:fs'
import type { AiPrescription } from '@trainingai/shared/types/ai-periodization'
import type { WorkoutRepository } from '@/lib/data/repository'
import type { LiftPreferenceRow } from '../lift-preference'
import { liftPreferenceFromRow } from '../lift-preference'
import { SCENARIOS, SESSION_ID, fakeRepo } from './fixtures/lift-preference-scenarios'
import { liftPreferencesStamp } from '../lift-preference-moved'
import { preferencesFromRows, withCheckinHold } from '../lift-preference-read'
import { startOfWeekInTz } from '@trainingai/shared/date-utils'

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
const CASES = 600
const NAMES = ['Lift p', 'Lift s', 'Lift a']

/** mulberry32: a seeded generator, so a failing case number reproduces. */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function randomRows(next: () => number): Map<string, LiftPreferenceRow> {
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)]
  const rows = new Map<string, LiftPreferenceRow>()
  for (const name of NAMES) {
    if (next() < 0.35) continue
    const min = pick([4, 6, 8, 10, 12])
    rows.set(name, {
      repMin: next() < 0.5 ? min : null, repMax: null as number | null,
      restSec: next() < 0.4 ? pick([45, 60, 90, 120, 180]) : null,
      nextLoadStep: next() < 0.3 ? pick(['lighter', 'heavier']) : null,
      setsDelta: next() < 0.2 ? pick([-1, 1]) : null,
      oneShotSetAt: null,
      checkinHeld: next() < 0.3,
    })
    const r = rows.get(name)!
    if (r.repMin != null) r.repMax = r.repMin + 3
    if (r.nextLoadStep != null || r.setsDelta != null) r.oneShotSetAt = new Date(Date.UTC(2026, 10, 20, 1, Math.floor(next() * 59)))
  }
  return rows
}

type Kind = 'ai_dynamic' | 'automatic' | 'manual'

function makeRepo(kind: Kind, rows: Map<string, LiftPreferenceRow>, phase: string, stored: AiPrescription[], withGuard: boolean, guardCalls: { n: number }): WorkoutRepository {
  const week = startOfWeekInTz(TZ)
  const program = {
    id: 'prog-1', createdAt: new Date(0), trainingGoal: 'strength', phaseMode: kind,
    sessions: [{ id: SESSION_ID, timeBudgetMinutes: 90, exercises: NAMES.map(exerciseName => ({ exerciseName })) }],
  }
  const read = (names: string[], weekStart?: string) => new Map(names.filter(n => rows.has(n)).map(n => {
    const { checkinHeld, ...row } = rows.get(n)!
    return [n, weekStart ? { ...row, ...(checkinHeld && { checkinHeld: true }) } : row] as const
  }))
  const extra: Record<string, unknown> = {
    getActiveProgramWithStructureStamp: async () => ({ program, structure: 'stamp' }),
    getActiveProgram: async () => program,
    listExercisePreferences: async (_u: string, names: string[], opts?: { checkinWeekStart?: string }) => read(names, opts?.checkinWeekStart),
    getLastExerciseLogsBatch: async (_u: string, names: string[]) =>
      new Map(names.map(n => [n, { sets: [{ weightKg: 60, reps: 5 }], estimated1rm: 100 }])),
    listPersonalRecords: async () => new Map(),
    getLastRealOneRmBatch: async () => new Map(),
    getExerciseEstimates: async () => [],
  }
  if (withGuard) {
    // What the adapter does in its transaction: read the rows again, stamp them, compare, store.
    extra.storePrescriptionIfPreferencesUnchanged = async (
      _u: string, _s: string, p: AiPrescription, _e: Date, _st: string, _g: unknown, guard: { names: string[]; weekStart: string; stamp: string },
    ) => {
      guardCalls.n++
      const { prefs, held } = preferencesFromRows(read(guard.names, guard.weekStart), guard.weekStart)
      for (const name of held) withCheckinHold(prefs, name, guard.weekStart, null)
      if (liftPreferencesStamp(prefs, guard.names) !== guard.stamp) return 'preferences_moved'
      stored.push(p)
      return 'stored'
    }
  }
  void week
  return fakeRepo(phase, stored, extra)
}

function signalsWith(base: unknown, rows: Map<string, LiftPreferenceRow>, weekStart: string) {
  const sig = structuredClone(base) as { exercises: { name: string; liftPreference?: unknown }[] }
  const { prefs, held } = preferencesFromRows(rows, weekStart)
  for (const name of held) withCheckinHold(prefs, name, weekStart, 60)
  for (const ex of sig.exercises) {
    const preference = prefs.get(ex.name) ?? liftPreferenceFromRow(null)
    if (preference) ex.liftPreference = { preference, basisKg: 100 }
  }
  return sig
}

describe('generation with no concurrent change is unchanged by the preference-checked store (#4007)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-21T02:00:00Z'))
  })
  afterEach(() => { vi.useRealTimers() })

  it(`${CASES} cases: 0 differ, and only the AI plan reaches the check`, async () => {
    const dump = process.env.DIFFERENTIAL_DUMP
    if (dump) writeFileSync(dump, '')
    const next = rng(4007)
    const weekStart = startOfWeekInTz(TZ)
    let differ = 0
    let guarded = 0
    let checked = 0
    for (let i = 0; i < CASES; i++) {
      const sc = SCENARIOS[Math.floor(next() * SCENARIOS.length)]
      const kind: Kind = (['ai_dynamic', 'automatic', 'manual'] as const)[Math.floor(next() * 3)]
      const rows = randomRows(next)
      const run = async (withGuard: boolean) => {
        const stored: AiPrescription[] = []
        const guardCalls = { n: 0 }
        mocks.signals = signalsWith(sc.signals, rows, weekStart)
        mocks.model = sc.model
        // A user per run: the dedup and cooldown maps are keyed by user.
        const result = await generatePrescriptionForSession(`user-4007-${i}-${withGuard}`, SESSION_ID, makeRepo(kind, rows, sc.phase, stored, withGuard, guardCalls), TZ)
        return { stored: JSON.stringify(stored), result: JSON.stringify(result), calls: guardCalls.n }
      }
      const plain = await run(false)
      const checkedRun = await run(true)
      if (dump) appendFileSync(dump, `${i}\t${plain.stored}\t${plain.result}\n`)
      if (plain.stored !== checkedRun.stored || plain.result !== checkedRun.result) differ++
      if (checkedRun.calls > 0) { guarded++; expect(kind, `case ${i}`).toBe('ai_dynamic') }
      checked++
      expect(plain.stored.length, `case ${i} stored nothing`).toBeGreaterThan(2)
    }
    console.info(`[4007 differential] ${checked} cases, ${guarded} reached the preference check, ${differ} differ`)
    expect(checked).toBeGreaterThanOrEqual(500)
    expect(differ).toBe(0)
    expect(guarded).toBeGreaterThan(100)
  }, 120_000)
})
