// #3890 / #4019: the done screen's Next workout card shows the bar and reps the session screen will.
// Both run the one per-lift reader (`loadLiftPreferences`, with this week's check-in hold) and the one
// step that applies it (`liftPreferenceOnStyle`); this compares the card's response with the session
// screen's own builder (`buildWorkoutExercises`) on the same data, for a lift the check-in holds and a
// lift with a stored rep range, on a static program and an AI-driven one. Made-up numbers.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildWorkoutExercises } from '@trainingai/shared/workout/session-data'
import { loadLiftPreferences } from '@trainingai/shared/ai-periodization/lift-preference-read'
import { prescribedBar } from '@trainingai/shared/workout/load-rounding'
import { startOfWeekInTz } from '@trainingai/shared/date-utils'
import type { WorkoutRepository } from '@/lib/data/repository'

type Row = Record<string, unknown>
const TZ = 'Australia/Brisbane'
const BENCH = 'Bench Press'
const SQUAT = 'Back Squat'

const prefRow = (over: Row = {}) => ({
  repMin: null, repMax: null, restSec: null, nextLoadStep: null, setsDelta: null, oneShotSetAt: null, ...over,
})

const data = {
  periodization: null as Row | null,
  prefs: new Map<string, Row>(),
}
const repo = {
  getNextSession: vi.fn(),
  listProgressionStyles: vi.fn(async () => [{ id: 'style-1', name: 'Standard', sets: [
    { pct: 82.5, reps: 8, restSec: 120, useFor1rm: true }, { pct: 82.5, reps: 8, restSec: 120, useFor1rm: true },
  ] }]),
  listExerciseLibrary: vi.fn(async () => [
    { name: BENCH, exerciseType: 'weighted', equipment: ['barbell'], muscles: [] },
    { name: SQUAT, exerciseType: 'weighted', equipment: ['barbell'], muscles: [] },
  ]),
  getLastExerciseLogsBatch: vi.fn(async (_u: string, names: string[]) => new Map(names.map(n => [n, {
    estimated1rm: 100, loggedAt: new Date('2026-11-20T08:00:00Z'), sets: [{ weightKg: 60, reps: 8 }, { weightKg: 70, reps: 8 }],
  }]))),
  getLastRealOneRmBatch: vi.fn(async (_u: string, names: string[]) => new Map(names.map(n => [n, { estimated1rm: 100, target80: 80 }]))),
  listPersonalRecords: vi.fn(async () => new Map()),
  getExerciseEstimates: vi.fn(async () => []),
  // The card re-evaluates a plan that drives the load against today's signals, as the screen does (#4019).
  getMoodLog: async () => null, getDayCheckin: async () => null, listInjuries: async () => [],
  getRecentSessionsOfType: async () => [], getExerciseMuscleAssignments: async () => ({}), getOuraDailyDerived: async () => [],
  getSessionPeriodization: vi.fn(async () => data.periodization),
  listExercisePreferences: vi.fn(async (_u: string, names: string[], o?: { checkinWeekStart?: string }) =>
    new Map([...data.prefs].filter(([n]) => names.includes(n)).map(([n, r]) =>
      [n, o?.checkinWeekStart ? r : (({ checkinHeld: _h, ...rest }) => rest)(r as Row)]))),
  getExerciseEquipment: vi.fn(async (names: string[]) => Object.fromEntries(names.map(n => [n, ['barbell']]))),
  getExerciseTypes: vi.fn(async (names: string[]) => Object.fromEntries(names.map(n => [n, 'weighted']))),
  replacePrescriptionIfUnchanged: vi.fn(async () => true),
}

vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'user-1', timezone: 'Australia/Brisbane' } })) }))
vi.mock('@/lib/data', () => ({ getRepository: async () => repo }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))

import { GET } from '../route'

const session = {
  id: 'sess-1', programId: 'prog-1', name: 'Push', position: 0, timeBudgetMinutes: 60,
  exercises: [
    { id: 'ex-b', sessionId: 'sess-1', exerciseName: BENCH, styleId: 'style-1', position: 0, exerciseRole: 'primary', muscleGroups: [] },
    { id: 'ex-s', sessionId: 'sess-1', exerciseName: SQUAT, styleId: 'style-1', position: 1, exerciseRole: 'primary', muscleGroups: [] },
  ],
}

const plan = () => ({
  phase: 'accumulation', phaseAction: 'stay', deload: false, reasoning: '', confidence: 1,
  estimatedSessionDurationMin: 45, weeklyVolumeContribution: {},
  exercises: [
    { sessionExerciseId: 'ex-b', name: BENCH, sets: 3, reps: 5, pct: 85, restSec: 150 },
    { sessionExerciseId: 'ex-s', name: SQUAT, sets: 3, reps: 10, pct: 72.5, restSec: 150 },
  ],
})

function setUp(mode: 'manual' | 'ai_dynamic') {
  const program = { id: 'prog-1', phaseMode: mode, trainingGoal: 'strength', sessions: [session] }
  repo.getNextSession.mockResolvedValue({ isRestDay: false, session, reason: '', program })
  data.periodization = mode === 'ai_dynamic'
    ? {
        phase: 'accumulation', phaseStartedAt: new Date(0), baselineComplete: true, prescriptionStatus: 'accepted',
        prescriptionGeneratedAt: new Date(), prescriptionExpiresAt: null, prescription: plan(),
        checkinHeldWeeks: [startOfWeekInTz(TZ)],
      }
    : null
  return program
}

/** What the session screen builds from the same data: `buildWorkoutExercises`, as /api/workout-data. */
async function sessionScreen(program: Row) {
  const r = repo as unknown as WorkoutRepository
  const names = session.exercises.map(e => e.exerciseName)
  const [styles, library, lastLogs, lastReal, liftPreferences] = await Promise.all([
    repo.listProgressionStyles(), repo.listExerciseLibrary(), repo.getLastExerciseLogsBatch('user-1', names),
    repo.getLastRealOneRmBatch('user-1', names), loadLiftPreferences(r, 'user-1', names, { checkinWeekStart: startOfWeekInTz(TZ) }),
  ])
  const ai = program.phaseMode === 'ai_dynamic'
  return buildWorkoutExercises(session as never, {
    lastLogs: lastLogs as never, lastRealOneRm: lastReal as never, prMap: new Map(), estimateMap: new Map(),
    styleById: new Map(styles.map(s => [s.id, s.sets])) as never, styleByName: new Map(styles.map(s => [s.name, s.sets])) as never, styles: styles as never,
    libByName: new Map(library.map(e => [e.name.toLowerCase(), e])) as never,
    currentPhase: null, allPhases: [], isDeloadActive: false, isBaselinePhase: false,
    aiDrivesLoad: ai, aiPrescription: ai ? plan() as never : null, aiPhaseLabel: 'Accumulation', isAiDynamic: ai, aiDeload: false,
    droppedThisCycle: new Set(), loggedTodayInThisSession: new Set(), trainingGoal: 'strength', liftPreferences,
  }).map(ex => ({
    name: ex.name,
    sets: (ex.progressionStyle ?? []).map(s => ({ weightKg: prescribedBar(ex.estimated1rm, s.pct, ex.equipment), reps: s.reps, restSec: s.restSec })),
  }))
}

async function card() {
  const body = await (await GET()).json() as { exercises: Array<{ name: string; sets: Row[] }> }
  return body.exercises.map(e => ({ name: e.name, sets: e.sets }))
}

describe('the Next workout card shows the session screen\'s bar and reps', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    data.prefs = new Map([
      // Held by the check-in: last session's heaviest set was 70 kg.
      [BENCH, prefRow({ checkinHeld: true })],
      // A stored rep range of 10 to 12.
      [SQUAT, prefRow({ repMin: 10, repMax: 12 })],
    ])
  })

  for (const mode of ['manual', 'ai_dynamic'] as const) {
    it(`${mode}: a held lift and a lift with a rep range read the same on the card as on the session screen`, async () => {
      const program = setUp(mode)
      const [onCard, onScreen] = [await card(), await sessionScreen(program)]
      expect(onCard).toEqual(onScreen)
      const bench = onCard.find(e => e.name === BENCH)!
      for (const s of bench.sets) expect(s.weightKg).toBeLessThanOrEqual(70)
      expect(bench.sets[0].weightKg).toBe(70)
      if (mode === 'manual') for (const s of onCard.find(e => e.name === SQUAT)!.sets) expect(s.reps).toBe(10)
    })
  }

  it('with no preference and no hold, the card is as it was (the program\'s own numbers)', async () => {
    data.prefs = new Map()
    setUp('manual')
    const onCard = await card()
    expect(onCard.find(e => e.name === BENCH)!.sets).toEqual([
      { weightKg: 82.5, reps: 8, restSec: 120 }, { weightKg: 82.5, reps: 8, restSec: 120 },
    ])
  })

  it('the response keeps its shape: name, sessionExerciseId, exerciseType and sets of weightKg, reps, restSec', async () => {
    setUp('ai_dynamic')
    const body = await (await GET()).json() as { exercises: Row[] }
    expect(Object.keys(body).sort()).toEqual(['exercises', 'isRestDay', 'sessionName', 'source'])
    for (const ex of body.exercises) {
      expect(Object.keys(ex).sort()).toEqual(['exerciseType', 'name', 'sessionExerciseId', 'sets'])
      for (const s of ex.sets as Row[]) expect(Object.keys(s).sort()).toEqual(['reps', 'restSec', 'weightKg'])
    }
  })
})
