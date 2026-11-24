// #4019 item 2, decided: the done screen's Next workout card shows the STORED plan and does not re-check it
// against today's soreness, injuries, check-in or illness. The card previews a session that is usually a day or
// more away, and today's signals are not that session's. (A card that re-checked as a read was built and reviewed
// at a54dca72 and taken out on purpose.) The session screen keeps its re-check (`reevaluateStoredPlanForToday`).
// This runs the REAL card route and the REAL `/api/workout-data` single-session handler on the same stored data,
// over: program kind (ai_dynamic normal plan · model deload · rules deload · baseline · automatic · manual) × today's
// signals (none · one sore muscle · sore plus an injury · every muscle sore · sick · three sore a day after a
// session, the emergency trigger) × the plan already re-checked for today's inputs, or not. Made-up names and numbers.
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

type Scenario = 'none' | 'one sore muscle' | 'sore + injury' | 'every muscle sore' | 'sick' | 'three sore, a day after a session'
const SCENARIOS: Scenario[] = ['none', 'one sore muscle', 'sore + injury', 'every muscle sore', 'sick', 'three sore, a day after a session']

const state = { program: null as Row | null, periodization: null as Row | null, scenario: 'none' as Scenario, keyCurrent: false }
const calls = { regenerate: 0, generate: 0, model: 0, writes: 0, screenStores: 0, errors: [] as string[] }

const moodFor = (s: Scenario) => s === 'none' ? null : s === 'sick' ? { bodyState: ['sick'], suggestedSoreMuscles: null, soreMuscles: [] as string[] } : {
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
  // The screen stores its re-check here; the card has no business calling it (counted separately for the card).
  updatePrescriptionExercisesCache: vi.fn(async (_u: string, _s: string, p: unknown) => { calls.writes++; calls.screenStores++; if (state.periodization) state.periodization.prescription = p }),
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
const plan = (deload: boolean, source: 'model' | 'rules' = 'model') => ({
  phase: deload ? 'deload' : 'accumulation', phaseAction: 'stay', deload, reasoning: '', confidence: 1, source,
  estimatedSessionDurationMin: 45, weeklyVolumeContribution: {},
  exercises: LIFTS.map(l => ({ sessionExerciseId: l.id, name: l.name, sets: 3, reps: 5, pct: deload ? 55 : 82.5, restSec: 150 })),
})

type Kind = 'ai normal' | 'ai model deload' | 'ai rules deload' | 'ai baseline' | 'manual' | 'automatic'
const KINDS: Kind[] = ['ai normal', 'ai model deload', 'ai rules deload', 'ai baseline', 'manual', 'automatic']
const isAi = (k: Kind) => k.startsWith('ai')
function setUp(kind: Kind, scenario: Scenario, keyCurrent: boolean) {
  state.scenario = scenario
  const program: Row = { id: 'prog-1', userId: 'user-1', phaseMode: isAi(kind) ? 'ai_dynamic' : kind, trainingGoal: 'strength', sessions: [session], autoApplyPrescriptions: true }
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
  if (isAi(kind)) {
    const baseline = kind === 'ai baseline'
    const deload = kind === 'ai model deload' || kind === 'ai rules deload'
    const p = baseline ? null : plan(deload, kind === 'ai rules deload' ? 'rules' : 'model') as Row
    if (p && keyCurrent) p.reevaluatedInputsKey = reevaluationKey(today, moodFor(scenario) as never, null, injuriesFor(scenario) as never)
    state.periodization = {
      id: 'per-1', userId: 'user-1', programSessionId: 'sess-1', phase: baseline ? 'baseline' : deload ? 'deload' : 'accumulation',
      phaseStartedAt: new Date('2026-11-10T00:00:00Z'), sessionsInPhase: 0, baselineComplete: !baseline, baseline1rm: {}, prescription: p,
      prescriptionGeneratedAt: p ? new Date('2026-11-21T00:00:00Z') : null, prescriptionExpiresAt: p ? new Date(Date.now() + 3 * 86_400_000) : null,
      prescriptionStatus: p ? 'accepted' : null, lastSessionRanPrescription: null, pendingTransition: null, preEmergencyDeloadPhase: null, updatedAt: new Date(),
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
const cardBody = async (): Promise<{ exercises: Array<Lift & { exerciseType: string }> }> => (await card()).json()
const onCard = async (): Promise<Lift[]> => (await cardBody()).exercises.map(({ name, sessionExerciseId, sets }) => ({ name, sessionExerciseId, sets }))

const tally = { cells: 0, differsFromNoSignal: 0, screenLightened: 0 }
const storedBar = (pct: number) => prescribedBar(100, pct, ['barbell'])

describe('the Next workout card shows the stored plan, not today\'s soreness (#4019)', () => {
  beforeEach(() => { vi.clearAllMocks(); calls.regenerate = calls.generate = calls.model = calls.writes = calls.screenStores = 0; calls.errors = [] })

  for (const kind of KINDS) for (const scenario of SCENARIOS) for (const keyCurrent of isAi(kind) ? [false, true] : [false]) {
    it(`${kind} · ${scenario} · plan ${keyCurrent ? 'already re-checked' : 'not re-checked today'}: the card is what it is with no signal at all`, async () => {
      // The same stored data with no signal today: what the card must show.
      setUp(kind, 'none', false)
      const noSignal = await cardBody()
      setUp(kind, scenario, keyCurrent)
      const withSignal = await cardBody()
      tally.cells++
      if (JSON.stringify(withSignal) !== JSON.stringify(noSignal)) tally.differsFromNoSignal++
      expect(withSignal).toEqual(noSignal)
      expect(calls.writes, 'the card stores nothing').toBe(0)
      expect(calls.regenerate + calls.generate + calls.model, 'the card starts no regeneration and calls no model').toBe(0)
      expect(calls.errors, 'the card reports no error (there is no figure re-cost on a card read)').toEqual([])
    })
  }

  it('an AI plan\'s card carries the stored numbers: 5 reps at 82.5 %, even with every muscle sore', async () => {
    setUp('ai normal', 'every muscle sore', false)
    for (const lift of await onCard()) expect(lift.sets[0], lift.name).toEqual({ weightKg: storedBar(82.5), reps: 5, restSec: 150 })
  })

  it('a sore chest: the card shows the stored bench, the screen\'s read lightens it, and once the screen has stored the re-check the card shows what is stored', async () => {
    setUp('ai normal', 'one sore muscle', false)
    const before = await onCard()
    expect(before[0].sets[0].weightKg).toBe(storedBar(82.5))

    const screenLifts = await onScreen()
    expect(calls.screenStores, 'the screen stored its re-check').toBe(1)
    tally.screenLightened += screenLifts[0].sets[0].weightKg !== storedBar(82.5) ? 1 : 0
    expect(screenLifts[0].sets[0].weightKg).toBeLessThan(storedBar(82.5)!)

    // The row now holds the screen's re-check; the card reads that row as it would read any stored plan.
    const stored = (state.periodization!.prescription as { exercises: Array<{ pct: number; reps: number; restSec: number }> }).exercises[0]
    const after = await onCard()
    expect(after[0].sets[0].weightKg).toBe(prescribedBar(100, stored.pct, ['barbell']))
    expect(after[0].sets).toEqual(screenLifts[0].sets)
    expect(after[0].sets[0].weightKg).not.toBe(before[0].sets[0].weightKg)
  })

  it('on the screen, the same signals do change the lifts (so the grid above is not vacuous)', async () => {
    let moved = 0
    for (const scenario of SCENARIOS.filter(s => s !== 'none')) {
      setUp('ai normal', scenario, false)
      const cardLifts = await onCard()
      const screenLifts = await onScreen()
      if (JSON.stringify(cardLifts) !== JSON.stringify(screenLifts)) moved++
    }
    expect(moved).toBeGreaterThan(0)
  })

  it('the grid ran in full and no cell differed from "no signal"', () => {
    expect(tally.cells).toBe(SCENARIOS.length * (4 * 2 + 2))
    expect(tally.differsFromNoSignal).toBe(0)
    console.info(`[#4019 item 2] cells: ${tally.cells}, differing from no-signal: ${tally.differsFromNoSignal}`)
  })
})
