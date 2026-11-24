// #4019 item 5 / #4049 / #4050: the session screen's responses must not change when its phase and
// baseline resolution moves into one resolver (`resolveSessionPhase`) and its phases and counts are read
// in one call. This records every `/api/workout-data` JSON body over a grid and writes them to the file
// named by WORKOUT_DATA_DUMP; it is run once on `origin/main` and once on the branch and the two dumps
// are compared byte for byte. Skipped unless WORKOUT_DATA_DUMP is set (the golden lives in the PR, not in
// the repo: a later intended change to the screen must not have to edit a fixture).
//
// Grid: program kind (manual · automatic in each of normal / deload / baseline / testing · ai_dynamic with
// no stored plan, a driving plan and a consumed one, each in an accumulation, baseline and deload state)
// × a confirmed early-deload week or none × the pre-workout `aiDeload` toggle or none × a stored rep range
// or none; each cell is read as one session, as the `?tab=all` batch and as `?tab=meta`.
// The repository is a mock that answers made-up data; the same data on both sides. No model call.
import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { writeFileSync } from 'node:fs'
import { staticNextExercise } from '@/lib/coach/domains/lift-preference'
import { loadLiftPreferences } from '@trainingai/shared/ai-periodization/lift-preference-read'

const DUMP = process.env.WORKOUT_DATA_DUMP
type Row = Record<string, unknown>

const set = (pct: number, reps: number, restSec = 120) => ({ pct, reps, restSec, useFor1rm: true })
const STYLES = [
  { id: 'style-main', name: 'Main', sets: [set(82.5, 8), set(82.5, 8), set(80, 8)] },
  { id: 'style-acc', name: 'Accessory', sets: [set(60, 12, 90), set(60, 12, 90)] },
  { id: 'style-deload', name: 'Deload', sets: [set(50, 5, 90), set(50, 5, 90)] },
  { id: 'style-test', name: 'Testing', sets: [set(95, 3, 240)] },
]
const LIFTS = [
  { id: 'ex-p', name: 'Bench Press', role: 'primary', type: 'weighted', styleId: 'style-main' },
  { id: 'ex-a', name: 'Cable Fly', role: 'accessory', type: 'weighted', styleId: 'style-acc' },
  { id: 'ex-w', name: 'Pull Up', role: 'secondary', type: 'bodyweight', styleId: 'style-main' },
] as const

const state = { program: null as Row | null, periodization: null as Row | null, phases: [] as Row[], counts: new Map<string, number>(), prefs: new Map<string, Row>() }
const repo = {
  getActiveProgram: vi.fn(async () => state.program),
  listProgressionStyles: vi.fn(async () => STYLES),
  listExerciseLibrary: vi.fn(async () => LIFTS.map(l => ({ id: `lib-${l.id}`, name: l.name, exerciseType: l.type, equipment: l.type === 'bodyweight' ? [] : ['barbell'], muscles: [] }))),
  // Both shapes of the phases-and-counts read, so the same mock serves `origin/main` and the branch.
  listProgramPhases: vi.fn(async () => state.phases),
  countAllSessionsSinceStart: vi.fn(async () => state.counts),
  getProgramPhaseState: vi.fn(async () => ({ phases: state.phases, sessionCounts: state.counts })),
  getLastExerciseLogsBatch: vi.fn(async (_u: string, names: string[]) => new Map(names.map(n => [n, { estimated1rm: 100, loggedAt: new Date('2026-11-20T08:00:00Z'), styleName: 'Main', sets: [{ weightKg: 60, reps: 8 }] }]))),
  getLastRealOneRmBatch: vi.fn(async (_u: string, names: string[]) => new Map(names.map(n => [n, { estimated1rm: 100, target80: 80 }]))),
  listPersonalRecords: vi.fn(async () => new Map()),
  getExerciseEstimates: vi.fn(async () => []),
  getDayExerciseNames: vi.fn(async () => []),
  reconcileSessionsInPhase: vi.fn(async () => {}),
  getSessionPeriodization: vi.fn(async () => state.periodization),
  listExercisePreferences: vi.fn(async (_u: string, names: string[]) => new Map([...state.prefs].filter(([n]) => names.includes(n)))),
  getExerciseEquipment: vi.fn(async (names: string[]) => Object.fromEntries(names.map(n => [n, ['barbell']]))),
  getExerciseTypes: vi.fn(async (names: string[]) => Object.fromEntries(names.map(n => [n, 'weighted']))),
  replacePrescriptionIfUnchanged: vi.fn(async () => true),
  updatePrescriptionExercisesCache: vi.fn(async () => {}),
  updatePrescriptionStatus: vi.fn(async () => {}),
  listSessionPeriodizationForProgram: vi.fn(async () => []),
  listProgramCompletions: vi.fn(async () => []),
  getMoodLog: vi.fn(async () => null),
  getDayCheckin: vi.fn(async () => null),
  listInjuries: vi.fn(async () => []),
  getRecentSessionsOfType: vi.fn(async () => []),
  getExerciseMuscleAssignments: vi.fn(async () => ({})),
  getOuraDailyDerived: vi.fn(async () => []),
}
const calls = { model: 0 }
vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'user-1', timezone: 'Australia/Brisbane' } })) }))
vi.mock('@/lib/data', () => ({ getRepository: async () => repo }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))
vi.mock('@trainingai/shared/ai-periodization/regenerate-in-background', () => ({ regeneratePrescriptionInBackground: () => { calls.model++ } }))
vi.mock('@trainingai/shared/ai-periodization/generate-prescription', () => ({ generatePrescriptionForSession: async () => { calls.model++ } }))

import { GET } from '@/app/api/workout-data/route'

const sess = (id: string, name: string, position: number) => ({
  id, programId: 'prog-1', name, position, timeBudgetMinutes: 60,
  exercises: LIFTS.map((l, i) => ({ id: `${id}-${l.id}`, sessionId: id, exerciseName: l.name, styleId: l.styleId, position: i, exerciseRole: l.role, muscleGroups: ['chest'] })),
})
const plan = (deload: boolean, sid: string) => ({
  phase: deload ? 'deload' : 'accumulation', phaseAction: 'stay', deload, reasoning: '', confidence: 1, source: 'model',
  estimatedSessionDurationMin: 45, weeklyVolumeContribution: {},
  exercises: LIFTS.map((l, i) => ({ sessionExerciseId: `${sid}-${l.id}`, name: l.name, sets: 3, reps: 5 + i, pct: deload ? 55 : 80 - i * 5, restSec: 150 })),
})

type Kind = 'manual' | 'automatic' | 'ai'
const cells: Array<{ label: string; kind: Kind; phase: string; plan: string; early: boolean; toggle: boolean; range: boolean }> = []
for (const early of [false, true]) for (const toggle of [false, true]) for (const range of [false, true]) {
  cells.push({ label: 'manual', kind: 'manual', phase: 'normal', plan: 'none', early, toggle, range })
  for (const phase of ['normal', 'deload', 'baseline', 'testing']) cells.push({ label: `automatic ${phase}`, kind: 'automatic', phase, plan: 'none', early, toggle, range })
  for (const pstate of ['accumulation', 'baseline', 'deload']) for (const p of ['none', 'driving', 'consumed'])
    cells.push({ label: `ai ${pstate} ${p}`, kind: 'ai', phase: pstate, plan: p, early, toggle, range })
}

describe.skipIf(!DUMP)('the session screen answers the same (#4019 item 5)', () => {
  it('records every response over the grid', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-24T02:00:00Z') })
    const today = '2026-11-24'
    const out: Record<string, unknown> = {}
    let requests = 0
    let coachReads = 0
    const sessions = [sess('sess-1', 'Push', 0), sess('sess-2', 'Pull', 1)]
    for (const c of cells) {
      const ai = c.kind === 'ai'
      state.program = {
        id: 'prog-1', userId: 'user-1', phaseMode: ai ? 'ai_dynamic' : c.kind, trainingGoal: 'strength', sessions, autoApplyPrescriptions: true,
        ...(c.early ? { earlyDeloadWeekStart: today } : {}),
        ...(c.kind === 'automatic' ? { phaseSetId: 'set-1', startedAt: '2026-10-01' } : {}),
      }
      state.phases = []; state.counts = new Map()
      if (c.kind === 'automatic') {
        const order = ['normal', 'deload', 'baseline', 'testing']
        state.phases = order.map((p, i) => ({ id: `ph-${p}`, phaseSetId: 'set-1', position: i, name: p, durationCycles: 1, phaseType: p,
          primaryStyleId: p === 'deload' ? 'style-deload' : p === 'testing' ? 'style-test' : 'style-main', secondaryStyleId: p === 'deload' ? 'style-deload' : 'style-main' }))
        state.counts = new Map([['sess-1', order.indexOf(c.phase)], ['sess-2', (order.indexOf(c.phase) + 1) % 4]])
      }
      state.periodization = ai ? {
        id: 'per-1', userId: 'user-1', programSessionId: 'sess-1', phase: c.phase, phaseStartedAt: new Date('2026-11-10T00:00:00Z'), sessionsInPhase: 1,
        baselineComplete: c.phase !== 'baseline', baseline1rm: {}, prescription: c.plan === 'driving' ? plan(c.phase === 'deload', 'sess-1') : null,
        prescriptionGeneratedAt: new Date('2026-11-23T00:00:00Z'), prescriptionExpiresAt: null,
        prescriptionStatus: c.plan === 'driving' ? 'accepted' : c.plan === 'consumed' ? 'consumed' : 'none',
        lastSessionRanPrescription: null, pendingTransition: null, preEmergencyDeloadPhase: null, updatedAt: new Date('2026-11-23T00:00:00Z'),
      } : null
      state.prefs = c.range ? new Map(LIFTS.map(l => [l.name, { repMin: 10, repMax: 12, restSec: null, nextLoadStep: null, setsDelta: null, oneShotSetAt: null }])) : new Map()
      const urls = [
        `session=sess-1&poll=1${c.toggle ? '&aiDeload=1' : ''}`,
        `session=sess-2&poll=1${c.toggle ? '&aiDeload=1' : ''}`,
        'session=all', 'session=meta',
      ]
      for (const q of urls) {
        const res = await GET(new NextRequest(`http://localhost/api/workout-data?${q}`))
        requests++
        out[`${c.label} | early=${c.early} toggle=${c.toggle} range=${c.range} | ${q}`] = { status: res.status, body: await res.json() }
      }
      // The Coach's line for each lift (#4049), the same stored state, as `/api/coach/about` reads it.
      const prefs = await loadLiftPreferences(repo as never, 'user-1', LIFTS.map(l => l.name))
      for (const l of LIFTS) {
        const target = { id: `sess-1-${l.id}`, sessionId: 'sess-1', exerciseName: l.name, exerciseId: null, styleId: l.styleId, position: 0, muscleGroups: [],
          exerciseRole: l.role, sessionName: 'Push', programId: 'prog-1', phaseMode: (state.program as Row).phaseMode, accessoryPhaseStyled: false }
        coachReads++
        out[`coach ${l.name} | ${c.label} | early=${c.early} range=${c.range}`] = await staticNextExercise(repo as never, 'user-1', target as never, today, prefs)
      }
    }
    vi.useRealTimers()
    writeFileSync(DUMP!, JSON.stringify(out, null, 1))
    expect(calls.model).toBe(0)
    console.info(`[#4019 differential] ${cells.length} cells, ${requests} requests, ${coachReads} Coach reads`)
    expect(requests).toBe(cells.length * 4)
  })
})
