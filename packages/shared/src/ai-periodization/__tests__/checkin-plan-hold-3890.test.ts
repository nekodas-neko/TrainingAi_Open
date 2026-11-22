// #3890 (decision 8): the weekly check-in's "Heavy" hold on the live plan. A held lift's prescribed bar
// is no heavier than the bar the person last used for it, during the week the check-in applies to, on
// every path that sets a load: the model plan, autoregulation, the rules fallback, the static program
// and a stored plan where it is served. Sets and reps are not changed; every other lift is identical.
// 0 real model calls: the model is a mock. Made-up numbers.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import type { AiPrescription, SessionPeriodization } from '@trainingai/shared/types/ai-periodization'
import type { WorkoutRepository } from '@/lib/data/repository'
import { SCENARIOS, SESSION_ID, fakeRepo, STATIC_SESSION, staticCtx, exercise, signals } from './fixtures/lift-preference-scenarios'
import { buildWorkoutExercises } from '../../workout/session-data'
import { prescribedBar } from '../../workout/load-rounding'
import { heaviestLoggedWeightKg, lastSessionBarKg, pctUnderBar, type LiftPreference } from '../lift-preference'
import { holdPlanRows, holdStoredPrescription, holdStoredPlanUnderCheckin, rehold, rewriteHeldRow } from '../checkin-plan-hold'
import { loadLiftPreferences } from '../lift-preference-read'
import { CHECKIN_HOLD_LIVE } from '../../weekly-checkin/effects'
import type { ExerciseLog } from '../../types/log'

const mocks = vi.hoisted(() => ({
  signals: null as unknown,
  model: null as Record<string, unknown> | null,
  prompts: [] as Array<{ system: string; prompt: string }>,
}))
vi.mock('../signals', async importOriginal => ({
  ...(await importOriginal<typeof import('../signals')>()),
  aggregateSignals: async () => mocks.signals,
}))
vi.mock('ai', async importOriginal => ({
  ...(await importOriginal<typeof import('ai')>()),
  generateObject: async (args: { system: string; prompt: string }) => {
    mocks.prompts.push({ system: args.system, prompt: args.prompt })
    if (!mocks.model) throw new Error('model unavailable (test)')
    return { object: structuredClone(mocks.model) }
  },
}))
vi.mock('@/lib/ai/instrument', () => ({
  loggedGenerateObject: async (_opts: unknown, run: (signal: undefined, settings: object) => Promise<unknown>) => run(undefined, {}),
}))
const { generatePrescriptionForSession } = await import('../generate-prescription')

const WEEK = '2026-11-23'
const hold = (barKg: number | null, over: Partial<LiftPreference> = {}): LiftPreference =>
  ({ repRange: null, restSec: null, oneShot: null, checkinHold: { weekStart: WEEK, barKg }, ...over })

let n = 0
async function generate(sig: unknown, model: Record<string, unknown> | null) {
  mocks.signals = structuredClone(sig)
  mocks.model = model ? structuredClone(model) : null
  mocks.prompts = []
  const stored: AiPrescription[] = []
  await generatePrescriptionForSession(`user-3890-hold-${++n}`, SESSION_ID, fakeRepo((sig as { phase: string }).phase, stored), 'Australia/Brisbane')
  return { stored: stored[0], prompt: mocks.prompts[0]?.prompt }
}

/** The scenario's signals with a hold on `id` (basis 100 kg). */
function withHold(sc: (typeof SCENARIOS)[number], id: string, barKg: number | null, basisKg = 100) {
  const sig = structuredClone(sc.signals)
  sig.exercises = sig.exercises.map(e => e.sessionExerciseId === id ? { ...e, liftPreference: { preference: hold(barKg), basisKg } } : e)
  return sig
}

const rowOf = (p: AiPrescription | undefined, id: string) => p!.exercises.find(e => e.sessionExerciseId === id)!
const others = (p: AiPrescription | undefined, id: string) =>
  JSON.stringify(p!.exercises.filter(e => e.sessionExerciseId !== id))

describe('CHECKIN_HOLD_LIVE', () => {
  it('is true now that the plan enforces the hold', () => expect(CHECKIN_HOLD_LIVE).toBe(true))
})

describe('the ceiling on a pct (pctUnderBar) and the last bar (lastSessionBarKg)', () => {
  it('leaves a pct whose bar is at or under the bar alone (a ceiling, never a floor)', () => {
    expect(pctUnderBar(70, 100, ['barbell'], 70)).toBe(70)
    expect(pctUnderBar(60, 100, ['barbell'], 70)).toBe(60)
  })
  it('lowers a heavier pct to the heaviest plate-step bar at or under the bar', () => {
    const pct = pctUnderBar(82.5, 100, ['barbell'], 75)
    expect(prescribedBar(100, pct, ['barbell'])).toBe(75)
    const off = pctUnderBar(80, 137, ['cable'], 101) // a bar off the 1.25 kg grid
    expect(prescribedBar(137, off, ['cable'])).toBe(100)
    expect(off).toBeLessThan(80)
  })
  it('does nothing without a basis', () => expect(pctUnderBar(90, null, ['barbell'], 50)).toBe(90))
  const log = (estimated1rm: number, sets: Array<[number | null | undefined, number]>) =>
    ({ estimated1rm, sets: sets.map(([weightKg, reps], i) => ({ setNumber: i + 1, weightKg, reps })) }) as unknown as ExerciseLog
  it('the last bar is the heaviest working weight of the last session, never its lightest or most frequent', () => {
    expect(lastSessionBarKg(log(120, [[60, 5], [70, 5], [80, 5]]))).toBe(80)
    expect(lastSessionBarKg(log(120, [[65, 5], [75, 5], [85, 5]]))).toBe(85)
    expect(lastSessionBarKg(log(120, [[40, 5], [40, 5], [60, 5], [80, 5]]))).toBe(80)
    expect(lastSessionBarKg(log(120, [[80, 5], [80, 5], [82.5, 5], [82.5, 5]]))).toBe(82.5)
    expect(lastSessionBarKg(log(120, [[100, 3], [80, 8], [80, 8]]))).toBe(100)
    expect(lastSessionBarKg(log(120, [[80, 5], [90, 5], [90, 5], [90, 4]]))).toBe(90)
    expect(lastSessionBarKg(log(120, [[72.5, 5]]))).toBe(72.5)
  })
  it('a set with a zero or missing weight, or no reps, is ignored; a deload log, an empty log or none is no bar', () => {
    expect(lastSessionBarKg(log(120, [[0, 10], [null, 8], [undefined, 8], [60, 5], [200, 0]]))).toBe(60)
    expect(heaviestLoggedWeightKg([])).toBeNull()
    expect(heaviestLoggedWeightKg(null)).toBeNull()
    expect(lastSessionBarKg(log(120, []))).toBeNull()
    expect(lastSessionBarKg(log(0, [[50, 5], [50, 5]]))).toBeNull()
    expect(lastSessionBarKg(log(120, [[0, 0]]))).toBeNull()
    expect(lastSessionBarKg(null)).toBeNull()
  })
  it('a pyramid planned near its top set is capped at the top set, not cut to the first one', () => {
    const bar = lastSessionBarKg(log(120, [[60, 5], [70, 5], [80, 5]]))!
    expect(prescribedBar(100, pctUnderBar(77.5, 100, ['barbell'], bar), ['barbell'])).toBe(77.5)
    expect(prescribedBar(100, pctUnderBar(85, 100, ['barbell'], bar), ['barbell'])).toBe(80)
  })
})

describe('generation: the model plan, autoregulation and the rules fallback', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-23T02:00:00Z'))
  })
  afterEach(() => { vi.useRealTimers() })

  it('model plan: the held primary is capped at its last bar; sets, reps and every other row unchanged', async () => {
    const sc = SCENARIOS[0]
    const plain = await generate(sc.signals, sc.model)
    const held = await generate(withHold(sc, 'p', 70), sc.model)
    expect(prescribedBar(100, rowOf(plain.stored, 'p').pct, ['barbell'])).toBeGreaterThan(70)
    expect(prescribedBar(100, rowOf(held.stored, 'p').pct, ['barbell'])).toBeLessThanOrEqual(70)
    expect(rowOf(held.stored, 'p').sets).toBe(rowOf(plain.stored, 'p').sets)
    expect(rowOf(held.stored, 'p').reps).toBe(rowOf(plain.stored, 'p').reps)
    expect(others(held.stored, 'p')).toBe(others(plain.stored, 'p'))
    expect(held.stored!.checkinHold).toEqual({ weekStart: WEEK, rows: { p: { pct: rowOf(plain.stored, 'p').pct, heldPct: rowOf(held.stored, 'p').pct } } })
    expect(plain.stored!.checkinHold).toBeUndefined()
    // The model is told, on the held lift's line only.
    expect(held.prompt).toContain('held_this_week: no heavier than 70 kg')
    expect(held.prompt!.replace(/, held_this_week: [^)]*\(the lifter called last week heavy; do not add load\)/, '')).toBe(plain.prompt)
  })

  it('autoregulation: a lift it pushes is still capped, and the pushed set count is kept', async () => {
    const sc = SCENARIOS[1] // the secondary is easy and progressing: autoregulation pushes it
    const plain = await generate(sc.signals, sc.model)
    const held = await generate(withHold(sc, 's', 60), sc.model)
    expect(prescribedBar(100, rowOf(plain.stored, 's').pct, ['cable'])).toBeGreaterThan(60)
    expect(prescribedBar(100, rowOf(held.stored, 's').pct, ['cable'])).toBeLessThanOrEqual(60)
    expect(rowOf(held.stored, 's').sets).toBe(rowOf(plain.stored, 's').sets)
    expect(rowOf(held.stored, 's').reps).toBe(rowOf(plain.stored, 's').reps)
    expect(others(held.stored, 's')).toBe(others(plain.stored, 's'))
  })

  it('rules fallback: a failed model call still caps the held lift', async () => {
    const sc = SCENARIOS[3]
    const plain = await generate(sc.signals, null)
    const held = await generate(withHold(sc, 'p', 60), null)
    expect(plain.stored!.source).toBe('rules')
    expect(prescribedBar(100, rowOf(held.stored, 'p').pct, ['barbell'])).toBeLessThanOrEqual(60)
    expect(rowOf(held.stored, 'p').sets).toBe(rowOf(plain.stored, 'p').sets)
    expect(others(held.stored, 'p')).toBe(others(plain.stored, 'p'))
    expect(held.stored!.checkinHold?.rows.p).toBeDefined()
  })

  it('a lighter prescription, no last bar, a bodyweight lift and a deload phase are left alone', async () => {
    const sc = SCENARIOS[0]
    const plain = await generate(sc.signals, sc.model)
    for (const sig of [
      withHold(sc, 'p', 200),                   // the plan is already lighter than the last bar
      withHold(sc, 'p', null),                  // never logged
    ]) {
      const out = await generate(sig, sc.model)
      expect(JSON.stringify(out.stored!.exercises)).toBe(JSON.stringify(plain.stored!.exercises))
      expect(out.stored!.checkinHold).toBeUndefined()
    }
    const bw = structuredClone(sc.signals)
    bw.exercises = bw.exercises.map(e => e.sessionExerciseId === 'p' ? { ...e, exerciseType: 'bodyweight', liftPreference: { preference: hold(10), basisKg: 100 } } : e)
    const bwPlain = structuredClone(sc.signals)
    bwPlain.exercises = bwPlain.exercises.map(e => e.sessionExerciseId === 'p' ? { ...e, exerciseType: 'bodyweight' } : e)
    expect(JSON.stringify((await generate(bw, sc.model)).stored)).toBe(JSON.stringify((await generate(bwPlain, sc.model)).stored))
    const dl = SCENARIOS[4]
    expect(JSON.stringify((await generate(withHold(dl, 'p', 20), null)).stored)).toBe(JSON.stringify((await generate(dl.signals, null)).stored))
  })

  it('identity: a saved check-in with no Heavy answers changes no plan or prompt (the #3896 golden file)', async () => {
    const golden: Record<string, string> = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'lift-preference-identity-3896.golden.json'), 'utf8'))
    vi.setSystemTime(new Date('2026-11-21T02:00:00Z'))
    for (let i = 0; i < SCENARIOS.length; i++) {
      const sc = SCENARIOS[i]
      mocks.signals = structuredClone(sc.signals)
      mocks.model = sc.model
      mocks.prompts = []
      const stored: AiPrescription[] = []
      const calls: unknown[][] = []
      // The check-in exists (About right / Light only): the reader is asked about the week and answers
      // no held lift, so no last-bar read follows.
      const program = {
        id: 'prog-1', createdAt: new Date(0), trainingGoal: 'strength',
        sessions: [{ id: SESSION_ID, timeBudgetMinutes: 90, exercises: sc.signals.exercises.map(e => ({ id: e.sessionExerciseId, exerciseName: e.name, exerciseRole: e.role })) }],
      }
      await generatePrescriptionForSession(`user-3890-noheavy-${i}`, SESSION_ID, fakeRepo(sc.phase, stored, {
        getActiveProgramWithStructureStamp: async () => ({ program, structure: 'stamp' }),
        getActiveProgram: async () => program,
        listExercisePreferences: async (...args: unknown[]) => { calls.push(args); return new Map() },
        getLastExerciseLogsBatch: async () => { throw new Error('no last-bar read without a held lift') },
        listCheckinHeldLifts: async () => new Set<string>(),
      }), 'Australia/Brisbane')
      expect(calls[0]?.[2]).toEqual({ checkinWeekStart: '2026-11-16' })
      expect(JSON.stringify({ stored: stored[0], prompt: mocks.prompts[0] }, null, 2)).toBe(golden[`ai:${i}`])
    }
  })
})

describe('the static program path', () => {
  const lastLog = (weightKg: number) => ({ estimated1rm: 140, sets: [1, 2, 3].map(i => ({ setNumber: i, weightKg, reps: 5 })) }) as unknown as ExerciseLog

  for (const mode of ['automatic', 'ai_dynamic'] as const) {
    it(`${mode}: every set of the held lift is at most its last bar, every other lift identical`, () => {
      const plain = buildWorkoutExercises(STATIC_SESSION, staticCtx(mode))
      const held = buildWorkoutExercises(STATIC_SESSION, staticCtx(mode, { liftPreferences: new Map([['Lift p', hold(100)]]) }))
      const p = held.find(e => e.name === 'Lift p')!
      expect(plain.find(e => e.name === 'Lift p')!.progressionStyle!.some(s => prescribedBar(140, s.pct, ['barbell'])! > 100)).toBe(true)
      for (const s of p.progressionStyle!) expect(prescribedBar(140, s.pct, ['barbell'])).toBeLessThanOrEqual(100)
      expect(p.progressionStyle!.map(s => s.reps)).toEqual(plain.find(e => e.name === 'Lift p')!.progressionStyle!.map(s => s.reps))
      expect(p.defaultSets).toBe(plain.find(e => e.name === 'Lift p')!.defaultSets)
      expect(p.liftPreference).toBeUndefined()
      expect(JSON.stringify(held.filter(e => e.name !== 'Lift p'))).toBe(JSON.stringify(plain.filter(e => e.name !== 'Lift p')))
    })
  }

  it('a lighter style, a bodyweight lift, a deload and a baseline are left alone', () => {
    const cases: Array<Parameters<typeof staticCtx>[1]> = [{}, { isDeloadActive: true }, { isBaselinePhase: true }]
    for (const over of cases) {
      const plain = buildWorkoutExercises(STATIC_SESSION, staticCtx('automatic', over))
      const held = buildWorkoutExercises(STATIC_SESSION, staticCtx('automatic', {
        ...over, liftPreferences: new Map([['Lift p', hold(over && Object.keys(over).length ? 20 : 500)], ['Lift b', hold(1)]]),
      }))
      expect(JSON.stringify(held)).toBe(JSON.stringify(plain))
    }
  })

  it('an AI-driven row is held where the session is built (the read-only all-sessions view)', () => {
    const plan = {
      phase: 'accumulation', phaseAction: 'stay', deload: false, reasoning: '', confidence: 0.5,
      estimatedSessionDurationMin: 50, weeklyVolumeContribution: {},
      exercises: [
        { sessionExerciseId: 'se-p', name: 'Lift p', sets: 4, reps: 5, pct: 85, restSec: 180 },
        { sessionExerciseId: 'se-s', name: 'Lift s', sets: 3, reps: 8, pct: 75, restSec: 150 },
      ],
    } as unknown as AiPrescription
    const ctx = { aiDrivesLoad: true, aiPrescription: plan, lastLogs: new Map([['Lift p', lastLog(110)]]) }
    const plain = buildWorkoutExercises(STATIC_SESSION, staticCtx('ai_dynamic', ctx))
    const held = buildWorkoutExercises(STATIC_SESSION, staticCtx('ai_dynamic', { ...ctx, liftPreferences: new Map([['Lift p', hold(110)]]) }))
    for (const s of held.find(e => e.name === 'Lift p')!.progressionStyle!) expect(prescribedBar(140, s.pct, ['barbell'])).toBeLessThanOrEqual(110)
    expect(prescribedBar(140, plain.find(e => e.name === 'Lift p')!.progressionStyle![0].pct, ['barbell'])).toBeGreaterThan(110)
    expect(JSON.stringify(held.filter(e => e.name !== 'Lift p'))).toBe(JSON.stringify(plain.filter(e => e.name !== 'Lift p')))
  })
})

describe('a deload on a held lift', () => {
  it('the full numbers a person reverts a deloaded AI row to are held too; with no hold they are as stored', () => {
    const plan = {
      phase: 'accumulation', phaseAction: 'stay', deload: false, reasoning: 'r', confidence: 0.5, estimatedSessionDurationMin: 55, weeklyVolumeContribution: {},
      exercises: [
        { sessionExerciseId: 'se-p', name: 'Lift p', sets: 2, reps: 5, pct: 50, restSec: 180, deloaded: true, deloadNote: 'Deload',
          preDeload: { sets: 4, reps: 5, pct: 85, restSec: 180 } },
        { sessionExerciseId: 'se-s', name: 'Lift s', sets: 3, reps: 8, pct: 75, restSec: 150 },
      ],
    } as unknown as AiPrescription
    const ctx = { aiDrivesLoad: true, aiPrescription: plan }
    const plain = buildWorkoutExercises(STATIC_SESSION, staticCtx('ai_dynamic', ctx))
    const held = buildWorkoutExercises(STATIC_SESSION, staticCtx('ai_dynamic', { ...ctx, liftPreferences: new Map([['Lift p', hold(110)]]) }))
    const [p0, p1] = [plain, held].map(b => b.find(e => e.name === 'Lift p')!)
    expect(p1.progressionStyle).toEqual(p0.progressionStyle)
    expect(prescribedBar(140, p0.preDeloadStyle![0].pct, ['barbell'])).toBeGreaterThan(110)
    for (const s of p1.preDeloadStyle!) expect(prescribedBar(140, s.pct, ['barbell'])).toBeLessThanOrEqual(110)
    expect(JSON.stringify(held.filter(e => e.name !== 'Lift p'))).toBe(JSON.stringify(plain.filter(e => e.name !== 'Lift p')))
  })

  it('a held row a deload cut later keeps its record, so a revert and the week\'s end still know its own load', () => {
    const ctx = () => ({ preference: hold(75), basisKg: 100, equipment: ['barbell'], bodyweight: false })
    const held = holdStoredPrescription(PLAN, WEEK, ex => ex.name === 'Lift p' ? ctx() : undefined)
    const heldPct = rowOf(held, 'p').pct
    // The re-evaluation deloads the held row: its pre-deload load is the held one.
    const deloaded = { ...held, exercises: held.exercises.map(e => e.sessionExerciseId === 'p'
      ? { ...e, pct: 50, sets: 2, deloaded: true, preDeload: { sets: e.sets, reps: e.reps, pct: e.pct, restSec: e.restSec } } : e) } as AiPrescription
    const kept = holdStoredPrescription(deloaded, WEEK, ex => ex.name === 'Lift p' ? ctx() : undefined)
    expect(kept).toBe(deloaded)
    expect(kept.checkinHold!.rows.p).toEqual({ pct: 82.5, heldPct })
    // Next week the row, still deloaded, keeps its record unchanged (no rewrite each week).
    expect(holdStoredPrescription(deloaded, '2026-11-30', () => undefined)).toBe(deloaded)
    // Reverted: back at the held pct, which the record turns back into its own load once not held.
    const reverted = { ...kept, exercises: kept.exercises.map(e => e.sessionExerciseId === 'p'
      ? { ...e, ...e.preDeload, deloaded: false, preDeload: undefined } : e) } as AiPrescription
    expect(rowOf(holdStoredPrescription(reverted, '2026-11-30', () => undefined), 'p').pct).toBe(82.5)
  })

  it('rehold: a plan the re-evaluation reverted is held from the preferences already read, and left alone with none', () => {
    const reverted = { ...PLAN }
    const prefs = new Map([['Lift p', hold(75)]])
    const lift = () => ({ basisKg: 100, equipment: ['barbell'], bodyweight: false })
    const out = rehold(reverted, 'accumulation', WEEK, prefs, lift)
    expect(prescribedBar(100, rowOf(out, 'p').pct, ['barbell'])).toBe(75)
    expect(rowOf(out, 's')).toEqual(PLAN.exercises[1])
    expect(rehold(reverted, 'accumulation', WEEK, new Map(), lift)).toBe(reverted)
    expect(rehold(reverted, 'deload', WEEK, prefs, lift)).toBe(reverted)
    expect(rehold(reverted, 'accumulation', '2026-11-30', prefs, lift)).toBe(reverted)
  })
})

// ── A stored plan where it is served ───────────────────────────────────────────────────────────

const PLAN: AiPrescription = {
  phase: 'accumulation', phaseAction: 'stay', deload: false, reasoning: 'r', confidence: 0.5,
  estimatedSessionDurationMin: 55, weeklyVolumeContribution: {},
  exercises: [
    { sessionExerciseId: 'p', name: 'Lift p', sets: 4, reps: 5, pct: 82.5, restSec: 180 },
    { sessionExerciseId: 's', name: 'Lift s', sets: 3, reps: 8, pct: 72.5, restSec: 150 },
  ],
} as unknown as AiPrescription

/** A repository for the serve step: the held set and last bar are given; every read and write counted. */
function serveRepo(opts: {
  heldFor?: Record<string, string[]>; lastBar?: number; basis?: number
  /** A real compare-and-swap over this stored plan, and a re-read of it (`getSessionPeriodization`). */
  stored?: AiPrescription
  /** Runs just before the swap compares (a regeneration landing meanwhile). */
  beforeSwap?: (set: (p: AiPrescription) => void) => void
  throwOnWrite?: boolean
} = {}) {
  const calls: string[] = []
  const writes: AiPrescription[] = []
  let current: AiPrescription | null = opts.stored ?? null
  const cas = opts.stored !== undefined
  const known: Record<string, (...a: never[]) => unknown> = {
    listExercisePreferences: async (_u: string, names: string[], o?: { checkinWeekStart?: string }) => {
      const held = new Set(opts.heldFor?.[o?.checkinWeekStart ?? ''] ?? [])
      return new Map(names.filter(nm => held.has(nm)).map(nm => [nm, { repMin: null, repMax: null, restSec: null, nextLoadStep: null, setsDelta: null, oneShotSetAt: null, checkinHeld: true }]))
    },
    getLastExerciseLogsBatch: async (_u: string, names: string[]) =>
      new Map(names.map(nm => [nm, { estimated1rm: opts.basis ?? 100, sets: [{ weightKg: opts.lastBar ?? 75, reps: 5 }] }])),
    getLastRealOneRmBatch: async (_u: string, names: string[]) => new Map(names.map(nm => [nm, { estimated1rm: opts.basis ?? 100 }])),
    getExerciseEstimates: async () => [],
    listPersonalRecords: async () => new Map(),
    getExerciseEquipment: async (names: string[]) => Object.fromEntries(names.map(nm => [nm, ['barbell']])),
    getExerciseTypes: async (names: string[]) => Object.fromEntries(names.map(nm => [nm, 'weighted'])),
    replacePrescriptionIfUnchanged: async (_u: string, _s: string, before: AiPrescription, after: AiPrescription) => {
      if (opts.throwOnWrite) throw new Error('write failed (test)')
      opts.beforeSwap?.(p => { current = p })
      await Promise.resolve()
      if (cas && !isDeepStrictEqual(current, before)) return false
      writes.push(after); current = after; return true
    },
    ...(cas && { getSessionPeriodization: async () => stateOf(structuredClone(current!), opts.heldFor ? Object.keys(opts.heldFor) : undefined) }),
  }
  const repo = new Proxy({}, { get: (_t, prop: string) => {
    if (!(prop in known)) return undefined
    return (...a: never[]) => { calls.push(prop); return known[prop](...a) }
  } }) as WorkoutRepository
  return { repo, calls, writes, current: () => current }
}

const stateOf = (prescription: AiPrescription, heldWeeks?: string[]): SessionPeriodization => ({
  id: 'sp', userId: 'u', programSessionId: 'ps', phase: 'accumulation', phaseStartedAt: new Date(0), sessionsInPhase: 2,
  baselineComplete: true, baseline1rm: {}, prescription, prescriptionGeneratedAt: null, prescriptionExpiresAt: null,
  prescriptionStatus: 'pending', lastSessionRanPrescription: null, pendingTransition: null, preEmergencyDeloadPhase: null,
  updatedAt: new Date(0), ...(heldWeeks && { checkinHeldWeeks: heldWeeks }),
})

const LA = 'America/Los_Angeles'
// Sunday 22 Nov 23:59 and Monday 23 Nov 00:00 in Los Angeles (UTC-8).
const SUN_2359 = new Date('2026-11-23T07:59:00Z')
const MON_0000 = new Date('2026-11-23T08:00:00Z')
const NEXT_MON = new Date('2026-11-30T08:00:00Z')

describe('a stored plan, served before, during and after the applies-to week', () => {
  it('no check-in: returned as it came, with no query', async () => {
    const { repo, calls } = serveRepo()
    const state = stateOf(PLAN)
    expect(await holdStoredPlanUnderCheckin('u', 'ps', repo, LA, state, MON_0000)).toBe(state)
    expect(calls).toEqual([])
  })

  it('the week boundary in a non-default timezone: Sunday 23:59 is not held, Monday 00:00 is', async () => {
    const r = serveRepo({ heldFor: { [WEEK]: ['Lift p'] }, lastBar: 75 })
    const state = stateOf(PLAN, [WEEK])
    expect(await holdStoredPlanUnderCheckin('u', 'ps', r.repo, LA, state, SUN_2359)).toBe(state)
    expect(r.calls).toEqual([])
    const served = await holdStoredPlanUnderCheckin('u', 'ps', r.repo, LA, state, MON_0000)
    expect(prescribedBar(100, rowOf(served.prescription!, 'p').pct, ['barbell'])).toBe(75)
    expect(rowOf(served.prescription!, 'p')).toMatchObject({ sets: 4, reps: 5, restSec: 180 })
    expect(rowOf(served.prescription!, 's')).toEqual(PLAN.exercises[1])
    expect(served.prescription!.checkinHold).toEqual({ weekStart: WEEK, rows: { p: { pct: 82.5, heldPct: rowOf(served.prescription!, 'p').pct } } })
    expect(r.writes).toHaveLength(1)
  })

  it('a second read in the week writes nothing; a second session at a lower bar re-holds from the plan\'s own load', async () => {
    const first = serveRepo({ heldFor: { [WEEK]: ['Lift p'] }, lastBar: 75 })
    const held = await holdStoredPlanUnderCheckin('u', 'ps', first.repo, LA, stateOf(PLAN, [WEEK]), MON_0000)
    const again = serveRepo({ heldFor: { [WEEK]: ['Lift p'] }, lastBar: 75 })
    expect((await holdStoredPlanUnderCheckin('u', 'ps', again.repo, LA, held, MON_0000)).prescription).toBe(held.prescription)
    expect(again.writes).toHaveLength(0)
    const lower = serveRepo({ heldFor: { [WEEK]: ['Lift p'] }, lastBar: 70 })
    const second = await holdStoredPlanUnderCheckin('u', 'ps', lower.repo, LA, held, new Date('2026-11-26T20:00:00Z'))
    expect(prescribedBar(100, rowOf(second.prescription!, 'p').pct, ['barbell'])).toBe(70)
    expect(second.prescription!.checkinHold!.rows.p.pct).toBe(82.5)
  })

  it('after an undo, and in the week after, the plan gets its own load back', async () => {
    const held = await holdStoredPlanUnderCheckin('u', 'ps', serveRepo({ heldFor: { [WEEK]: ['Lift p'] } }).repo, LA, stateOf(PLAN, [WEEK]), MON_0000)
    // Undo: the week still has a check-in that holds something else, or none at all.
    for (const weeks of [[WEEK], undefined]) {
      const r = serveRepo({ heldFor: { [WEEK]: [] } })
      const out = await holdStoredPlanUnderCheckin('u', 'ps', r.repo, LA, { ...held, checkinHeldWeeks: weeks }, MON_0000)
      expect(out.prescription).toEqual(PLAN)
    }
    // The week after: no read is needed to give it back.
    const r = serveRepo({ heldFor: { [WEEK]: ['Lift p'] } })
    const out = await holdStoredPlanUnderCheckin('u', 'ps', r.repo, LA, { ...held, checkinHeldWeeks: [WEEK] }, NEXT_MON)
    expect(out.prescription).toEqual(PLAN)
    expect(r.calls).toEqual(['replacePrescriptionIfUnchanged'])
  })

  it('a check-in for another week, a consumed or expired plan, and a deload plan are not held', async () => {
    const other = serveRepo({ heldFor: { '2026-11-30': ['Lift p'] } })
    const s1 = stateOf(PLAN, ['2026-11-30'])
    expect(await holdStoredPlanUnderCheckin('u', 'ps', other.repo, LA, s1, MON_0000)).toBe(s1)
    const s2 = { ...stateOf(PLAN, [WEEK]), prescriptionStatus: 'consumed' as const }
    expect(await holdStoredPlanUnderCheckin('u', 'ps', serveRepo({ heldFor: { [WEEK]: ['Lift p'] } }).repo, LA, s2, MON_0000)).toBe(s2)
    const s3 = { ...stateOf(PLAN, [WEEK]), prescriptionExpiresAt: new Date('2026-11-23T00:00:00Z') }
    expect(await holdStoredPlanUnderCheckin('u', 'ps', serveRepo({ heldFor: { [WEEK]: ['Lift p'] } }).repo, LA, s3, MON_0000)).toBe(s3)
    const s4 = stateOf({ ...PLAN, deload: true }, [WEEK])
    expect((await holdStoredPlanUnderCheckin('u', 'ps', serveRepo({ heldFor: { [WEEK]: ['Lift p'] } }).repo, LA, s4, MON_0000)).prescription).toBe(s4.prescription)
  })

  it('several reads at once in the held week all serve the held bar, and exactly one writes', async () => {
    const r = serveRepo({ heldFor: { [WEEK]: ['Lift p'] }, lastBar: 70, stored: PLAN })
    const served = await Promise.all(Array.from({ length: 5 }, () =>
      holdStoredPlanUnderCheckin('u', 'ps', r.repo, LA, stateOf(structuredClone(PLAN), [WEEK]), MON_0000)))
    for (const s of served) expect(prescribedBar(100, rowOf(s.prescription!, 'p').pct, ['barbell'])).toBe(70)
    expect(r.writes).toHaveLength(1)
    expect(new Set(served.map(s => JSON.stringify(s.prescription))).size).toBe(1)
  })

  it('a read whose store loses to a regeneration serves the NEW plan, held, and writes nothing', async () => {
    const regen = { ...PLAN, reasoning: 'regenerated', exercises: [{ ...PLAN.exercises[0], pct: 87.5, sets: 5 }, PLAN.exercises[1]] } as AiPrescription
    const r = serveRepo({ heldFor: { [WEEK]: ['Lift p'] }, lastBar: 70, stored: PLAN, beforeSwap: set => set(regen) })
    const served = await holdStoredPlanUnderCheckin('u', 'ps', r.repo, LA, stateOf(PLAN, [WEEK]), MON_0000)
    expect(served.prescription!.reasoning).toBe('regenerated')
    expect(rowOf(served.prescription!, 'p').sets).toBe(5)
    expect(prescribedBar(100, rowOf(served.prescription!, 'p').pct, ['barbell'])).toBe(70)
    expect(served.prescription!.checkinHold!.rows.p.pct).toBe(87.5)
    expect(r.writes).toHaveLength(0)
  })

  it('a store that throws still serves the held plan', async () => {
    const r = serveRepo({ heldFor: { [WEEK]: ['Lift p'] }, lastBar: 70, throwOnWrite: true })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const served = await holdStoredPlanUnderCheckin('u', 'ps', r.repo, LA, stateOf(PLAN, [WEEK]), MON_0000)
    err.mockRestore()
    expect(prescribedBar(100, rowOf(served.prescription!, 'p').pct, ['barbell'])).toBe(70)
    expect(r.writes).toHaveLength(0)
  })

  it('composes with the shorter-session fit in either order', () => {
    const ctx = () => ({ preference: hold(75), basisKg: 100, equipment: ['barbell'], bodyweight: false })
    const ctxFor = (ex: { name: string }) => ex.name === 'Lift p' ? ctx() : undefined
    // A stand-in for the re-fit: it changes sets and rests and carries every other field (as
    // `refitPrescriptionToBudget` does), never the load.
    const fit = (p: AiPrescription): AiPrescription => ({ ...p, exercises: p.exercises.map(e => ({ ...e, sets: 2, restSec: 90 })), checkinBudgetMin: 30 })
    const holdThenFit = fit(holdStoredPrescription(PLAN, WEEK, ctxFor))
    const fitThenHold = holdStoredPrescription(fit(PLAN), WEEK, ctxFor)
    expect(holdThenFit).toEqual(fitThenHold)
    expect(holdStoredPrescription(holdThenFit, WEEK, ctxFor)).toBe(holdThenFit)
    // And undone in either order: the hold given back, then the fit given back (and the other way).
    const unfit = (p: AiPrescription): AiPrescription => {
      const { checkinBudgetMin: _m, ...rest } = p
      return { ...rest, exercises: p.exercises.map((e, i) => ({ ...e, sets: PLAN.exercises[i].sets, restSec: PLAN.exercises[i].restSec })) }
    }
    expect(unfit(holdStoredPrescription(holdThenFit, WEEK, () => undefined))).toEqual(PLAN)
    expect(holdStoredPrescription(unfit(holdThenFit), WEEK, () => undefined)).toEqual(PLAN)
  })

  it('a row rewritten since the hold is taken as it now is; the Coach\'s restate keeps the hold', () => {
    const ctxFor = (ex: { name: string }) => ex.name === 'Lift p' ? { preference: hold(75), basisKg: 100, equipment: ['barbell'], bodyweight: false } : undefined
    const held = holdStoredPrescription(PLAN, WEEK, ctxFor)
    const heldPct = rowOf(held, 'p').pct
    const rewritten = { ...held, exercises: held.exercises.map(e => e.sessionExerciseId === 'p' ? { ...e, pct: 60 } : e) }
    expect(rowOf(holdStoredPrescription(rewritten, WEEK, () => undefined), 'p').pct).toBe(60)
    // A restate (here: one plate lighter, on the plan's own load) keeps the ceiling and the own load.
    const lighter = (r: { sessionExerciseId: string; pct: number }) => ({ ...r, pct: r.pct - 2.5 })
    const out = rewriteHeldRow(rowOf(held, 'p'), held.checkinHold, lighter)
    expect(out).toEqual({ row: { ...rowOf(held, 'p'), pct: heldPct }, held: { pct: 80, heldPct } })
    const muchLighter = rewriteHeldRow(rowOf(held, 'p'), held.checkinHold, r => ({ ...r, pct: 60 }))
    expect(muchLighter).toEqual({ row: { ...rowOf(held, 'p'), pct: 60 } })
  })

  it('holdPlanRows records nothing when nothing is lowered', () => {
    expect(holdPlanRows([{ id: 'p', pct: 60 }], () => ({ preference: hold(75), basisKg: 100, equipment: ['barbell'], bodyweight: false }))).toEqual({ pct: new Map() })
  })
})

describe('the one reader: the week goes in, the hold and its bar come out', () => {
  it('asks about the week only when given one, and reads a last bar only for a held lift', async () => {
    const r = serveRepo({ heldFor: { [WEEK]: ['Lift p'] }, lastBar: 90 })
    const none = await loadLiftPreferences(r.repo, 'u', ['Lift p', 'Lift s'])
    expect(none.size).toBe(0)
    expect(r.calls).toEqual(['listExercisePreferences'])
    const prefs = await loadLiftPreferences(r.repo, 'u', ['Lift p', 'Lift s'], { checkinWeekStart: WEEK })
    expect(prefs.get('Lift p')).toEqual(hold(90))
    expect(prefs.has('Lift s')).toBe(false)
    expect(r.calls).toEqual(['listExercisePreferences', 'listExercisePreferences', 'getLastExerciseLogsBatch'])
  })

  it('exposes the session signal shape untouched for a lift without a hold', () => {
    // A guard on the fixtures themselves: no scenario carries a hold, so the golden runs stay main's.
    for (const sc of SCENARIOS) for (const e of sc.signals.exercises) expect(e.liftPreference?.preference.checkinHold).toBeUndefined()
    expect(exercise('x', 'primary', 'quadriceps').liftPreference).toBeUndefined()
    expect(signals({}).exercises).toEqual([])
  })
})
