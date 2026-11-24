// #4019: the done screen's Next workout card shows the session screen's sets, reps and bar, for every
// program kind and phase, because both come from one builder (`buildWorkoutExercises`, reached by the
// card through `readSessionFromStoredState`). This runs the REAL `/api/workout-data` single-session
// handler and the REAL card route on the same stored data and compares them lift by lift, over:
//   program kind (manual · automatic · ai_dynamic with a plan driving · with no plan stored · with the
//   plan consumed) × phase (normal · deload · baseline · testing, where the kind has one) × lift kind
//   (primary · accessory · bodyweight) × a stored rep range or none × a weekly check-in hold or none.
// #4049: the Coach's "About" line (`staticNextExercise`) reads the same stored state through the same
// reader, so on every cell where no stored plan drives the bar it must equal the screen too, and it
// must call a deload, baseline or test week excluded exactly where the screen is in one.
// Made-up numbers; no model call (the regeneration entry points are mocked and counted).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { prescribedBar } from '@trainingai/shared/workout/load-rounding'
import { startOfWeekInTz, todayInTz } from '@trainingai/shared/date-utils'
import { loadLiftPreferences } from '@trainingai/shared/ai-periodization/lift-preference-read'
import { staticNextExercise } from '@/lib/coach/domains/lift-preference'

type Row = Record<string, unknown>
const TZ = 'Australia/Brisbane'
const PRIMARY = 'Bench Press'
const ACCESSORY = 'Cable Fly'
const BODYWEIGHT = 'Pull Up'
const LIFTS = [
  { id: 'ex-p', name: PRIMARY, role: 'primary', type: 'weighted', styleId: 'style-main' },
  { id: 'ex-a', name: ACCESSORY, role: 'accessory', type: 'weighted', styleId: 'style-acc' },
  { id: 'ex-w', name: BODYWEIGHT, role: 'secondary', type: 'bodyweight', styleId: 'style-main' },
] as const

const set = (pct: number, reps: number, restSec = 120) => ({ pct, reps, restSec, useFor1rm: true })
const STYLES = [
  { id: 'style-main', name: 'Main', sets: [set(82.5, 8), set(82.5, 8), set(80, 8)] },
  { id: 'style-acc', name: 'Accessory', sets: [set(60, 12, 90), set(60, 12, 90)] },
  { id: 'style-deload', name: 'Deload', sets: [set(50, 5, 90), set(50, 5, 90)] },
  { id: 'style-test', name: 'Testing', sets: [set(95, 3, 240)] },
]
const today = todayInTz(TZ)
const weekStart = startOfWeekInTz(TZ)

const state = {
  program: null as Row | null,
  periodization: null as Row | null,
  phases: [] as Row[],
  sessionCount: 0,
  prefs: new Map<string, Row>(),
}

const calls = { regenerate: 0, generate: 0, writes: 0 }
const repo = {
  getNextSession: vi.fn(),
  getActiveProgram: vi.fn(async () => state.program),
  listProgressionStyles: vi.fn(async () => STYLES),
  listExerciseLibrary: vi.fn(async () => LIFTS.map(l => ({
    id: `lib-${l.id}`, name: l.name, exerciseType: l.type, equipment: l.type === 'bodyweight' ? [] : ['barbell'], muscles: [],
  }))),
  listProgramPhases: vi.fn(async () => state.phases),
  countAllSessionsSinceStart: vi.fn(async () => new Map([['sess-1', state.sessionCount]])),
  // The routes and the Coach read phases and counts in one call (#4050).
  getProgramPhaseState: vi.fn(async () => ({ phases: state.phases, sessionCounts: new Map([['sess-1', state.sessionCount]]) })),
  getLastExerciseLogsBatch: vi.fn(async (_u: string, names: string[]) => new Map(names.map(n => [n, {
    estimated1rm: 100, loggedAt: new Date('2026-11-20T08:00:00Z'), styleName: 'Main',
    sets: [{ weightKg: 60, reps: 8 }, { weightKg: 70, reps: 8 }],
  }]))),
  getLastRealOneRmBatch: vi.fn(async (_u: string, names: string[]) => new Map(names.map(n => [n, { estimated1rm: 100, target80: 80 }]))),
  listPersonalRecords: vi.fn(async () => new Map()),
  getExerciseEstimates: vi.fn(async () => []),
  getDayExerciseNames: vi.fn(async () => []),
  reconcileSessionsInPhase: vi.fn(async () => {}),
  getSessionPeriodization: vi.fn(async () => state.periodization),
  listExercisePreferences: vi.fn(async (_u: string, names: string[], o?: { checkinWeekStart?: string }) =>
    new Map([...state.prefs].filter(([n]) => names.includes(n)).map(([n, r]) =>
      [n, o?.checkinWeekStart ? r : (({ checkinHeld: _h, ...rest }) => rest)(r as Row)]))),
  getExerciseEquipment: vi.fn(async (names: string[]) => Object.fromEntries(names.map(n => [n, ['barbell']]))),
  getExerciseTypes: vi.fn(async (names: string[]) => Object.fromEntries(names.map(n => [n, 'weighted']))),
  // The serve-time check-in fit/hold (`fitStoredPlanToCheckinBudget`) persists through this one; main's card already runs it.
  replacePrescriptionIfUnchanged: vi.fn(async () => true),
  updatePrescriptionExercisesCache: vi.fn(async () => { calls.writes++ }),
  updatePrescriptionStatus: vi.fn(async () => { calls.writes++ }),
  listSessionPeriodizationForProgram: vi.fn(async () => []),
  listProgramCompletions: vi.fn(async () => []),
  getMoodLog: vi.fn(async () => null),
  getDayCheckin: vi.fn(async () => null),
  listInjuries: vi.fn(async () => []),
  getRecentSessionsOfType: vi.fn(async () => []),
  getExerciseMuscleAssignments: vi.fn(async () => ({})),
  getOuraDailyDerived: vi.fn(async () => []),
}

vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'user-1', timezone: 'Australia/Brisbane' } })) }))
vi.mock('@/lib/data', () => ({ getRepository: async () => repo }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))
vi.mock('@trainingai/shared/ai-periodization/regenerate-in-background', () => ({
  regeneratePrescriptionInBackground: () => { calls.regenerate++ },
}))
vi.mock('@trainingai/shared/ai-periodization/generate-prescription', () => ({
  generatePrescriptionForSession: async () => { calls.generate++ },
}))

import { GET as card } from '../route'
import { GET as workoutData } from '@/app/api/workout-data/route'

const session = {
  id: 'sess-1', programId: 'prog-1', name: 'Push', position: 0, timeBudgetMinutes: 60,
  exercises: LIFTS.map((l, i) => ({
    id: l.id, sessionId: 'sess-1', exerciseName: l.name, styleId: l.styleId, position: i, exerciseRole: l.role, muscleGroups: [],
  })),
}

const plan = (deload: boolean) => ({
  phase: deload ? 'deload' : 'accumulation', phaseAction: 'stay', deload, reasoning: '', confidence: 1, source: 'model',
  estimatedSessionDurationMin: 45, weeklyVolumeContribution: {},
  exercises: [
    { sessionExerciseId: 'ex-p', name: PRIMARY, sets: 3, reps: 5, pct: deload ? 55 : 85, restSec: 150 },
    { sessionExerciseId: 'ex-a', name: ACCESSORY, sets: 3, reps: 10, pct: deload ? 45 : 72.5, restSec: 90 },
    { sessionExerciseId: 'ex-w', name: BODYWEIGHT, sets: 3, reps: 6, pct: deload ? 60 : 80, restSec: 120 },
  ],
})

type Kind = 'manual' | 'manual leftover week' | 'automatic' | 'ai driving' | 'ai no plan' | 'ai consumed'
type Phase = 'normal' | 'deload' | 'baseline' | 'testing'

const PHASES_BY_KIND: Record<Kind, Phase[]> = {
  manual: ['normal'],
  // #4114: a manual program carrying a stored early-deload week (a leftover from before the Coach declined it).
  // The screen has never lightened it, so the card and the Coach show the full numbers too.
  'manual leftover week': ['normal'],
  automatic: ['normal', 'deload', 'baseline', 'testing'],
  'ai driving': ['normal', 'deload', 'baseline'],
  'ai no plan': ['normal', 'deload', 'baseline'],
  'ai consumed': ['normal', 'deload', 'baseline'],
}

function setUp(kind: Kind, phase: Phase, o: { range: boolean; hold: boolean }) {
  const ai = kind.startsWith('ai')
  const program: Row = {
    id: 'prog-1', userId: 'user-1', phaseMode: kind.startsWith('manual') ? 'manual' : ai ? 'ai_dynamic' : 'automatic',
    trainingGoal: 'strength', sessions: [session], autoApplyPrescriptions: true,
    // An early-deload week confirmed from Home is how an ai_dynamic program reaches a "deload" without phase rows.
    ...((ai && phase === 'deload' && kind !== 'ai driving') || kind === 'manual leftover week' ? { earlyDeloadWeekStart: today } : {}),
  }
  state.program = program
  repo.getNextSession.mockResolvedValue({ isRestDay: false, session, reason: '', program })

  state.phases = []
  state.sessionCount = 0
  if (kind === 'automatic') {
    const order: Phase[] = ['normal', 'deload', 'baseline', 'testing']
    state.phases = order.map((p, i) => ({
      id: `ph-${p}`, phaseSetId: 'set-1', position: i, name: p, durationCycles: 1, phaseType: p,
      primaryStyleId: p === 'deload' ? 'style-deload' : p === 'testing' ? 'style-test' : 'style-main',
      secondaryStyleId: p === 'deload' ? 'style-deload' : 'style-main',
    }))
    state.sessionCount = order.indexOf(phase)
    program.phaseSetId = 'set-1'; program.startedAt = '2026-10-01'
  }

  state.periodization = null
  if (ai) {
    const driving = kind === 'ai driving'
    state.periodization = {
      id: 'per-1', userId: 'user-1', programSessionId: 'sess-1',
      phase: phase === 'baseline' ? 'baseline' : phase === 'deload' ? 'deload' : 'accumulation',
      phaseStartedAt: new Date('2026-11-10T00:00:00Z'), sessionsInPhase: 0, baselineComplete: phase !== 'baseline',
      baseline1rm: {}, prescription: driving ? plan(phase === 'deload') : null,
      prescriptionGeneratedAt: new Date(), prescriptionExpiresAt: null,
      prescriptionStatus: driving ? 'accepted' : kind === 'ai consumed' ? 'consumed' : 'none',
      lastSessionRanPrescription: null, pendingTransition: null, preEmergencyDeloadPhase: null, updatedAt: new Date(),
      ...(o.hold ? { checkinHeldWeeks: [weekStart] } : {}),
    }
  }

  const base = { repMin: null, repMax: null, restSec: null, nextLoadStep: null, setsDelta: null, oneShotSetAt: null }
  state.prefs = o.range || o.hold
    ? new Map(LIFTS.map(l => [l.name, { ...base, ...(o.range ? { repMin: 10, repMax: 12 } : {}), ...(o.hold ? { checkinHeld: true } : {}) }]))
    : new Map()
}

type Sets = Array<{ weightKg: number | null; reps: number; restSec: number }>
type Lift = { name: string; sessionExerciseId: string; exerciseType: string; sets: Sets }

/** The session screen's answer: the real handler, then the bar the app derives from each lift's basis and pct. */
async function onScreen(): Promise<Lift[]> {
  const res = await workoutData(new NextRequest('http://localhost/api/workout-data?session=sess-1&poll=1'))
  const body = await res.json() as { exercises: Array<{
    name: string; sessionExerciseId: string; exerciseType: string; estimated1rm: number | null; equipment?: string[]
    progressionStyle: Array<{ pct: number; reps: number; restSec: number }> | null
  }> }
  return body.exercises.map(ex => ({
    name: ex.name, sessionExerciseId: ex.sessionExerciseId, exerciseType: ex.exerciseType,
    sets: (ex.progressionStyle ?? []).map(s => ({
      weightKg: ex.exerciseType === 'bodyweight' || !ex.estimated1rm ? null : prescribedBar(ex.estimated1rm, s.pct, ex.equipment),
      reps: s.reps, restSec: s.restSec,
    })),
  }))
}

async function onCard(): Promise<{ lifts: Lift[]; body: Row; writes: number }> {
  calls.writes = 0
  const body = await (await card()).json() as Row & { exercises: Lift[] }
  return { lifts: body.exercises, body, writes: calls.writes }
}

/** The Coach's answer for every lift: its sets as the screen shows them, or `excluded` (a deload, baseline or test). */
async function onCoach(): Promise<Array<{ name: string; excluded: boolean; sets: Sets }>> {
  const prefs = await loadLiftPreferences(repo as never, 'user-1', LIFTS.map(l => l.name), { checkinWeekStart: weekStart })
  const out = []
  for (const l of LIFTS) {
    const target = {
      id: l.id, sessionId: 'sess-1', exerciseName: l.name, exerciseId: null, styleId: l.styleId, position: 0, muscleGroups: [],
      exerciseRole: l.role, sessionName: 'Push', programId: 'prog-1', phaseMode: state.program!.phaseMode, accessoryPhaseStyled: false,
    }
    const next = await staticNextExercise(repo as never, 'user-1', target as never, today, prefs)
    const ex = next?.exercise
    out.push({
      name: l.name, excluded: next?.excluded ?? false,
      sets: (ex?.progressionStyle ?? []).map(s => ({
        weightKg: ex!.exerciseType === 'bodyweight' || !ex!.estimated1rm ? null : prescribedBar(ex!.estimated1rm, s.pct, ex!.equipment),
        reps: s.reps, restSec: s.restSec,
      })),
    })
  }
  return out
}

const KINDS = Object.keys(PHASES_BY_KIND) as Kind[]
const tally = { cases: 0, liftCases: 0, mismatches: 0, nonEmpty: 0, coachCompared: 0, coachExcluded: 0 }

describe('the Next workout card equals the session screen for every program kind and phase (#4019)', () => {
  beforeEach(() => { vi.clearAllMocks(); calls.regenerate = 0; calls.generate = 0; calls.writes = 0 })

  for (const kind of KINDS) for (const phase of PHASES_BY_KIND[kind])
    for (const range of [false, true]) for (const hold of [false, true]) {
      // A hold is a weekly check-in's: it rides the stored plan's row on ai_dynamic and the preference read elsewhere.
      it(`${kind} · ${phase} · range ${range ? 'stored' : 'none'} · hold ${hold ? 'week' : 'none'}`, async () => {
        setUp(kind, phase, { range, hold })
        const screen = await onScreen()
        const { lifts: cardLifts, writes } = await onCard()
        tally.cases++
        tally.liftCases += screen.length
        // Same lifts, same order, same slot ids, then every lift's sets, reps, rest and bar.
        const same = JSON.stringify(cardLifts) === JSON.stringify(screen)
        if (!same) tally.mismatches++
        expect(cardLifts.map(l => l.sessionExerciseId)).toEqual(screen.map(l => l.sessionExerciseId))
        for (const [i, s] of screen.entries()) expect(cardLifts[i], `${s.name}`).toEqual(s)
        tally.nonEmpty += screen.filter(l => l.sets.length > 0).length
        // The Coach, #4049. Where a stored plan drives the bar the Coach is not asked (it describes the program
        // as written); the Coach reads no stored plan, so an ai_dynamic baseline is not one it can see.
        const coach = await onCoach()
        // The Coach is excluded for a phase's deload, baseline or test, and for a confirmed early-deload week
        // (how the ai_dynamic cells reach 'deload'). It cannot see a stored plan's own deload or baseline.
        const storedPlanOnly = kind === 'ai driving' || (kind.startsWith('ai') && phase === 'baseline')
        const excludedHere = kind === 'automatic' ? phase !== 'normal' : kind.startsWith('ai') && phase === 'deload' && kind !== 'ai driving'
        if (!storedPlanOnly) {
          for (const c of coach) expect(c.excluded, `coach ${kind} ${phase} ${c.name}: excluded`).toBe(excludedHere)
          if (excludedHere) tally.coachExcluded += coach.length
          else {
            for (const [i, s] of screen.entries()) expect(coach[i].sets, `coach ${s.name}`).toEqual(s.sets)
            tally.coachCompared += coach.length
          }
        }
        // Reading the card changes nothing and calls no model.
        // The card never writes a status or the plan cache (only the serve-time fit and hold, as on main).
        expect(writes).toBe(0)
        expect(calls.generate).toBe(0)
      })
    }

  it('the grid was not vacuous: it ran every kind × phase, with lifts that carry sets', () => {
    expect(tally.cases).toBe((1 + 1 + 4 + 3 + 3 + 3) * 4)
    expect(tally.liftCases).toBe(tally.cases * 3)
    expect(tally.nonEmpty).toBeGreaterThan(tally.liftCases / 2)
    expect(tally.mismatches).toBe(0)
    // The Coach was compared to the screen on every cell it can be, and was excluded where the screen is in a deload, baseline or test.
    expect(tally.coachCompared).toBeGreaterThan(0)
    expect(tally.coachExcluded).toBeGreaterThan(0)
    console.info(`[#4019 grid] cases run: ${tally.cases} (${tally.liftCases} lift comparisons), mismatches: ${tally.mismatches}; Coach compared on ${tally.coachCompared} lifts, excluded on ${tally.coachExcluded}`)
  })

  it('an AI-driven accessory with no plan driving shows the accessory target-effort load the screen shows (was 80 vs 75)', async () => {
    setUp('ai no plan', 'normal', { range: false, hold: false })
    const { lifts } = await onCard()
    const acc = lifts.find(l => l.name === ACCESSORY)!
    const screen = (await onScreen()).find(l => l.name === ACCESSORY)!
    expect(acc.sets).toEqual(screen.sets)
    // Not the stored 60 % style: the goal's target effort at 12 reps.
    expect(acc.sets[0].weightKg).not.toBe(prescribedBar(100, 60, ['barbell']))
  })

  it('a baseline previews no sets rather than a number the screen will not show', async () => {
    setUp('ai driving', 'baseline', { range: false, hold: false })
    const { lifts, body } = await onCard()
    expect(lifts.every(l => l.sets.length === 0)).toBe(true)
    expect(body.source).toBe('pending')
  })

  it('the response keeps its shape', async () => {
    setUp('ai driving', 'normal', { range: false, hold: false })
    const { lifts, body } = await onCard()
    expect(Object.keys(body).sort()).toEqual(['exercises', 'isRestDay', 'prescriptionSource', 'sessionName', 'source'])
    expect(body.source).toBe('driving')
    for (const ex of lifts) {
      expect(Object.keys(ex).sort()).toEqual(['exerciseType', 'name', 'sessionExerciseId', 'sets'])
      for (const s of ex.sets) expect(Object.keys(s).sort()).toEqual(['reps', 'restSec', 'weightKg'])
    }
  })
})

