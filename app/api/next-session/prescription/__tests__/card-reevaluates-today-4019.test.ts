// #4019 item 2: the done screen's Next workout card re-evaluates a plan that drives the load against today's
// soreness, injuries and illness, with the SAME function the session screen's single-session read runs
// (`reevaluateStoredPlanForToday`), so the two no longer differ after that step moves a load. On the card it is a
// READ: nothing is stored, no regeneration starts, no model is called (a model mock throws if it is touched).
// This runs the REAL `/api/workout-data` single-session handler and the REAL card route on the same stored data
// and compares them lift by lift, over: program kind (ai_dynamic with a plan driving · manual · automatic) × the
// plan's phase × a signal grid (none · one sore muscle · sore plus an injury · every muscle sore, which asks for a
// whole-session deload · 3 sore muscles a day after a session, the one-day emergency trigger) × the plan already
// re-checked for today's inputs, or not. Made-up names and numbers.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { prescribedBar } from '@trainingai/shared/workout/load-rounding'
import { todayInTz } from '@trainingai/shared/date-utils'
import { reevaluationKey } from '@trainingai/shared/ai-periodization/reevaluate'

type Row = Record<string, unknown>
const TZ = 'Australia/Brisbane'
const today = todayInTz(TZ)
const LIFTS = [
  { id: 'ex-p', name: 'Bench Press', role: 'primary', muscle: 'Chest' },
  { id: 'ex-s', name: 'Overhead Press', role: 'secondary', muscle: 'Shoulders' },
  { id: 'ex-a', name: 'Cable Fly', role: 'accessory', muscle: 'Triceps' },
] as const
const set = (pct: number, reps: number, restSec = 120) => ({ pct, reps, restSec, useFor1rm: true })
const STYLES = [{ id: 'style-main', name: 'Main', sets: [set(80, 8), set(80, 8), set(77.5, 8)] }]

type Scenario = 'none' | 'one sore muscle' | 'sore + injury' | 'every muscle sore' | 'three sore, a day after a session'
const SCENARIOS: Scenario[] = ['none', 'one sore muscle', 'sore + injury', 'every muscle sore', 'three sore, a day after a session']

const state = { program: null as Row | null, periodization: null as Row | null, scenario: 'none' as Scenario, keyCurrent: false }
const calls = { regenerate: 0, generate: 0, model: 0, writes: 0, errors: [] as string[] }

const moodFor = (s: Scenario) => s === 'none' ? null : {
  bodyState: ['sore_muscles'], suggestedSoreMuscles: null,
  soreMuscles: s === 'one sore muscle' || s === 'sore + injury' ? ['Chest'] : ['Chest', 'Shoulders', 'Triceps'],
}
const injuriesFor = (s: Scenario) => s === 'sore + injury' ? [{ muscleName: 'Shoulders', resolvedDate: null, updatedAt: new Date('2026-11-20T00:00:00Z') }] : []

const repo = {
  getNextSession: vi.fn(),
  getActiveProgram: vi.fn(async () => state.program),
  listProgressionStyles: vi.fn(async () => STYLES),
  listExerciseLibrary: vi.fn(async () => LIFTS.map(l => ({ id: `lib-${l.id}`, name: l.name, exerciseType: 'weighted', equipment: ['barbell'], muscles: [] }))),
  getProgramPhaseState: vi.fn(async () => ({ phases: [] as Row[], sessionCounts: new Map<string, number>() })),
  getLastExerciseLogsBatch: vi.fn(async (_u: string, names: string[]) => new Map(names.map(n => [n, {
    estimated1rm: 100, loggedAt: new Date('2026-11-20T08:00:00Z'), styleName: 'Main', sets: [{ weightKg: 60, reps: 8 }],
  }]))),
  getLastRealOneRmBatch: vi.fn(async (_u: string, names: string[]) => new Map(names.map(n => [n, { estimated1rm: 100, target80: 80 }]))),
  listPersonalRecords: vi.fn(async () => new Map()),
  getExerciseEstimates: vi.fn(async () => []),
  getDayExerciseNames: vi.fn(async () => []),
  reconcileSessionsInPhase: vi.fn(async () => {}),
  getSessionPeriodization: vi.fn(async () => state.periodization),
  listExercisePreferences: vi.fn(async () => new Map()),
  getExerciseEquipment: vi.fn(async (names: string[]) => Object.fromEntries(names.map(n => [n, ['barbell']]))),
  getExerciseTypes: vi.fn(async (names: string[]) => Object.fromEntries(names.map(n => [n, 'weighted']))),
  replacePrescriptionIfUnchanged: vi.fn(async () => true),
  updatePrescriptionExercisesCache: vi.fn(async () => { calls.writes++ }),
  updatePrescriptionStatus: vi.fn(async () => { calls.writes++ }),
  listSessionPeriodizationForProgram: vi.fn(async () => []),
  listProgramCompletions: vi.fn(async () => []),
  getMoodLog: vi.fn(async (_u: string, date: string) => date === today ? moodFor(state.scenario) : null),
  getDayCheckin: vi.fn(async () => null),
  listInjuries: vi.fn(async () => injuriesFor(state.scenario)),
  // A session finished 20 hours ago, after the plan was made (so it is not baked into it) only for the emergency cell.
  getRecentSessionsOfType: vi.fn(async () => state.scenario === 'three sore, a day after a session'
    ? [{ completedAt: new Date(Date.now() - 20 * 3_600_000) }] : []),
  getExerciseMuscleAssignments: vi.fn(async (names: string[]) => Object.fromEntries(
    names.map(n => [n, [{ muscle: LIFTS.find(l => l.name === n)!.muscle, role: 'main' }]]))),
  getOuraDailyDerived: vi.fn(async () => []),
  // The figure re-cost a moved row triggers (`loadFigureSignals`).
  getSetTimingRows: vi.fn(async () => []),
  getTimingAuditData: vi.fn(async () => ({ sessions: [], sets: [], exercises: [] })),
}

vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'user-1', timezone: TZ } })) }))
vi.mock('@/lib/data', () => ({ getRepository: async () => repo, getRepositoryAsync: async () => ({ insertErrorEvent: (e: unknown) => { calls.errors.push(JSON.stringify(e).slice(0, 300)) } }) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))
// No model may be reached from either route: a regeneration the screen starts is counted, and a direct call throws.
vi.mock('@trainingai/shared/ai-periodization/regenerate-in-background', () => ({ regeneratePrescriptionInBackground: () => { calls.regenerate++ } }))
vi.mock('@trainingai/shared/ai-periodization/generate-prescription', () => ({ generatePrescriptionForSession: async () => { calls.generate++ } }))
vi.mock('ai', async importOriginal => ({ ...(await importOriginal<typeof import('ai')>()), generateText: () => { calls.model++; throw new Error('a model was called') } }))
vi.mock('@ai-sdk/google', () => ({ google: () => { calls.model++; throw new Error('a model was called') }, createGoogleGenerativeAI: () => () => { calls.model++; throw new Error('a model was called') } }))

import { GET as card } from '../route'
import { GET as workoutData } from '@/app/api/workout-data/route'

const session = {
  id: 'sess-1', programId: 'prog-1', name: 'Push', position: 0, timeBudgetMinutes: 60,
  exercises: LIFTS.map((l, i) => ({
    id: l.id, sessionId: 'sess-1', exerciseName: l.name, styleId: 'style-main', position: i, exerciseRole: l.role, muscleGroups: [l.muscle],
  })),
}
const plan = (deload: boolean) => ({
  phase: deload ? 'deload' : 'accumulation', phaseAction: 'stay', deload, reasoning: '', confidence: 1, source: 'model',
  estimatedSessionDurationMin: 45, weeklyVolumeContribution: {},
  exercises: LIFTS.map(l => ({ sessionExerciseId: l.id, name: l.name, sets: 3, reps: 5, pct: deload ? 55 : 82.5, restSec: 150 })),
})

type Kind = 'ai driving' | 'manual' | 'automatic'
function setUp(kind: Kind, planDeload: boolean, scenario: Scenario, keyCurrent: boolean) {
  state.scenario = scenario
  const program: Row = { id: 'prog-1', userId: 'user-1', phaseMode: kind === 'ai driving' ? 'ai_dynamic' : kind, trainingGoal: 'strength', sessions: [session], autoApplyPrescriptions: true }
  state.program = program
  repo.getNextSession.mockResolvedValue({ isRestDay: false, session, reason: '', program })
  if (kind === 'automatic') {
    program.phaseSetId = 'set-1'; program.startedAt = '2026-10-01'
    repo.getProgramPhaseState.mockResolvedValue({
      phases: [{ id: 'ph-1', phaseSetId: 'set-1', position: 0, name: 'Build', durationCycles: 4, phaseType: 'normal', primaryStyleId: 'style-main', secondaryStyleId: 'style-main' }],
      sessionCounts: new Map([['sess-1', 1]]),
    })
  } else repo.getProgramPhaseState.mockResolvedValue({ phases: [], sessionCounts: new Map() })
  state.periodization = null
  if (kind === 'ai driving') {
    const p = plan(planDeload) as Row
    if (keyCurrent) p.reevaluatedInputsKey = reevaluationKey(today, moodFor(scenario) as never, null, injuriesFor(scenario) as never)
    state.periodization = {
      id: 'per-1', userId: 'user-1', programSessionId: 'sess-1', phase: planDeload ? 'deload' : 'accumulation',
      phaseStartedAt: new Date('2026-11-10T00:00:00Z'), sessionsInPhase: 0, baselineComplete: true, baseline1rm: {}, prescription: p,
      prescriptionGeneratedAt: new Date('2026-11-21T00:00:00Z'), prescriptionExpiresAt: new Date(Date.now() + 3 * 86_400_000),
      prescriptionStatus: 'accepted', lastSessionRanPrescription: null, pendingTransition: null, preEmergencyDeloadPhase: null, updatedAt: new Date(),
    }
  }
}

type Lift = { name: string; sessionExerciseId: string; sets: Array<{ weightKg: number | null; reps: number; restSec: number }> }
async function onScreen(): Promise<Lift[]> {
  const body = await (await workoutData(new NextRequest('http://localhost/api/workout-data?session=sess-1&poll=1'))).json() as { exercises: Array<{
    name: string; sessionExerciseId: string; estimated1rm: number | null; equipment?: string[]; exerciseType: string
    progressionStyle: Array<{ pct: number; reps: number; restSec: number }> | null }> }
  return body.exercises.map(ex => ({ name: ex.name, sessionExerciseId: ex.sessionExerciseId,
    sets: (ex.progressionStyle ?? []).map(s => ({ weightKg: ex.exerciseType === 'bodyweight' || !ex.estimated1rm ? null : prescribedBar(ex.estimated1rm, s.pct, ex.equipment), reps: s.reps, restSec: s.restSec })) }))
}
const onCard = async () => ((await (await card()).json()) as { exercises: Array<Lift & { exerciseType: string }> }).exercises
  .map(({ name, sessionExerciseId, sets }) => ({ name, sessionExerciseId, sets }))

const tally = { cases: 0, liftCases: 0, mismatches: 0, moved: 0, screenRegenerated: 0 }

describe('the Next workout card re-evaluates against today like the session screen (#4019)', () => {
  beforeEach(() => { vi.clearAllMocks(); calls.regenerate = calls.generate = calls.model = calls.writes = 0; calls.errors = [] })

  const cells: Array<[Kind, boolean]> = [['ai driving', false], ['ai driving', true], ['manual', false], ['automatic', false]]
  for (const [kind, planDeload] of cells) for (const scenario of SCENARIOS) for (const keyCurrent of kind === 'ai driving' ? [false, true] : [false]) {
    it(`${kind}${kind === 'ai driving' ? (planDeload ? ' (a deload plan)' : '') : ''} · ${scenario} · plan ${keyCurrent ? 'already re-checked' : 'not re-checked today'}`, async () => {
      setUp(kind, planDeload, scenario, keyCurrent)
      // The card first: it must not have changed what the screen then reads.
      const cardLifts = await onCard()
      expect(calls.writes, 'the card stores nothing').toBe(0)
      expect(calls.regenerate + calls.generate + calls.model, 'the card starts no regeneration and calls no model').toBe(0)
      const screenLifts = await onScreen()
      tally.cases++; tally.liftCases += screenLifts.length
      if (JSON.stringify(cardLifts) !== JSON.stringify(screenLifts)) tally.mismatches++
      expect(cardLifts).toEqual(screenLifts)
      if (calls.regenerate > 0) tally.screenRegenerated++
      // Did today's signals move a load on the screen? (Compared with the plan as stored: 5 reps at 82.5 % or 55 %.)
      const storedBar = (pct: number) => prescribedBar(100, pct, ['barbell'])
      if (kind === 'ai driving' && screenLifts.some(l => l.sets[0]?.weightKg !== storedBar(planDeload ? 55 : 82.5))) tally.moved++
      expect(calls.model).toBe(0)
      expect(calls.errors, 'no error was reported by either route').toEqual([])
    })
  }

  it('the grid was not vacuous: signals moved loads and asked for regenerations on the screen, and the card matched every time', () => {
    expect(tally.cases).toBe(SCENARIOS.length * (2 * 2 + 2))
    expect(tally.mismatches).toBe(0)
    expect(tally.moved).toBeGreaterThan(0)
    expect(tally.screenRegenerated).toBeGreaterThan(0)
    console.info(`[#4019 item 2] cases: ${tally.cases} (${tally.liftCases} lift comparisons), mismatches: ${tally.mismatches}; a signal moved a load in ${tally.moved} cases, the screen asked for a regeneration in ${tally.screenRegenerated}`)
  })

  it('with the soreness check run on the card, a sore chest lightens the card\'s bench exactly as the screen does', async () => {
    setUp('ai driving', false, 'one sore muscle', false)
    const [bench] = await onCard()
    const stored = prescribedBar(100, 82.5, ['barbell'])
    expect(bench.sets[0].weightKg).not.toBe(stored)
    expect(bench.sets).toEqual((await onScreen())[0].sets)
  })
})
