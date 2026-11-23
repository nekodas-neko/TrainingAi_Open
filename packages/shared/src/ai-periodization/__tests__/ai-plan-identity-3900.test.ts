// #3900: on an `ai_dynamic` program every generated plan applies by itself. Nothing else may move.
//
// IDENTITY. For every program kind that is NOT the AI plan (`automatic`, `manual`, and a program with
// no phase mode), the plan, its status, what was stored (with its expiry), every phase move and the
// prompt the model was sent must be byte-identical to `main`. One generation per case, the model
// mocked (0 real calls), over one in-memory repository with the adapter's compare-and-set. The grid
// is 3 kinds × 3 goals × 4 phases × 6 model answers (a stay, an earned move, a deload, a rest day, a
// swap, an out-of-zone stay) × 4 program states (under the window cap, at it, carried by the vote,
// waiting for the switch-over) × 3 switch/confidence pairs × 2 signal sets (plain; a lift preference,
// a check-in hold and an effort answer) × 2 session lengths, plus the emergency, soreness and
// model-down paths: 10,800 cases.
//
// THE GOLDEN FILE (fixtures/ai-plan-identity-3900.golden.json) holds one SHA-256 per (kind, goal,
// phase, answer) group, over the JSON of every case in it in order. It was recorded from
// `origin/main` at 979385103 (#4081), BEFORE #3900, like this:
//
//   git worktree add /tmp/main-3900 979385103
//   ln -s "$PWD/node_modules" /tmp/main-3900/node_modules
//   ln -s "$PWD/packages/shared/node_modules" /tmp/main-3900/packages/shared/node_modules
//   cp packages/shared/src/ai-periodization/__tests__/ai-plan-identity-3900.test.ts \
//      /tmp/main-3900/packages/shared/src/ai-periodization/__tests__/
//   (cd /tmp/main-3900 && AI_PLAN_3900_RECORD=1 npx vitest run \
//      packages/shared/src/ai-periodization/__tests__/ai-plan-identity-3900.test.ts)
//   cp /tmp/main-3900/packages/shared/src/ai-periodization/__tests__/__check_fixture__/ai-plan-identity-3900.golden.json \
//      packages/shared/src/ai-periodization/__tests__/fixtures/
//   git worktree remove --force /tmp/main-3900
//
// This file imports only modules that exist on `main`, so it runs unchanged there. A test may not
// write tracked source (LB-194): the record step writes the gitignored `__check_fixture__/` only.
//
// THE DIFFERENTIAL. `AI_PLAN_3900_DUMP=<file>` also runs the `ai_dynamic` cases and writes each one's
// output as a JSON line, for comparing two trees by hand (the PR body says how it was used). The
// committed test never compares `ai_dynamic`: its plans changed on purpose.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import type { AiPrescription, PeriodizationPhase, PrescriptionStatus } from '@trainingai/shared/types/ai-periodization'
import type { PrescriptionSignals } from '../signals'
import type { WorkoutRepository } from '@/lib/data/repository'
import { dateStrMidnightInTz, shiftDateStr } from '@trainingai/shared/date-utils'
import { programMoveMark } from '../program-phase'
import { intensityZoneForRole } from '../prompt'

const GOLDEN = join(__dirname, 'fixtures', 'ai-plan-identity-3900.golden.json')
const RECORD = !!process.env.AI_PLAN_3900_RECORD
const DUMP = process.env.AI_PLAN_3900_DUMP
const golden: Record<string, string> = existsSync(GOLDEN) ? JSON.parse(readFileSync(GOLDEN, 'utf8')) : {}

const mocks = vi.hoisted(() => ({ signals: null as unknown, answer: null as unknown, fail: false, prompts: [] as string[] }))
vi.mock('../signals', async importOriginal => ({
  ...(await importOriginal<typeof import('../signals')>()),
  aggregateSignals: async () => structuredClone(mocks.signals),
}))
vi.mock('ai', async importOriginal => ({
  ...(await importOriginal<typeof import('ai')>()),
  generateObject: async (args: { system: string; prompt: string }) => {
    mocks.prompts.push(`${args.system}\n----\n${args.prompt}`)
    if (mocks.fail) throw new Error('model unavailable in this test')
    return { object: structuredClone(mocks.answer) }
  },
}))
vi.mock('@/lib/ai/instrument', () => ({
  loggedGenerateObject: async (_meta: unknown, run: (s: undefined, settings: object) => Promise<unknown>) => run(undefined, {}),
}))
const { generatePrescriptionForSession } = await import('../generate-prescription')

// Made-up lifts and numbers; no real person.
const TZ = 'Australia/Brisbane'
const NOW = new Date('2026-11-25T12:00:00+10:00') // Wednesday, local midday
const DAY = 86_400_000
const PHASES = ['accumulation', 'intensification', 'realisation', 'deload'] as const
const CAP: Record<string, number> = { accumulation: 6, intensification: 5, realisation: 2, deload: 1 }
const NEXT: Record<string, PeriodizationPhase> = {
  accumulation: 'intensification', intensification: 'realisation', realisation: 'deload', deload: 'accumulation',
}
const GOALS = ['strength', 'hypertrophy', 'power'] as const
const KINDS = ['automatic', 'manual', 'none'] as const
const ANSWERS = ['stay', 'earned', 'deload', 'rest', 'swap', 'extreme'] as const
const STATES = ['under-cap', 'at-cap', 'vote', 'waiting'] as const
const SWITCHES = [[false, 0.9], [true, 0.9], [true, 0.4]] as const
const SIGNAL_SETS = ['plain', 'extras'] as const
const BUDGETS = [90, 45] as const

type Ex = PrescriptionSignals['exercises'][number]
const exercise = (id: string, role: string, muscle: string, over: Partial<Ex> = {}): Ex => ({
  sessionExerciseId: id, name: `Lift ${id}`, role, muscleGroups: [muscle],
  muscleAssignments: [{ muscle, role: 'main' }], baseline1rm: 100, current1rm: 100, latest1rm: 100,
  exerciseType: null, rm1Trend: 'flat', rm1ChangeKg: 0, avgSetDurationSec: 45, timeProfile: null,
  equipment: role === 'primary' ? ['barbell'] : ['cable'], transitionSec: 240, plateau: false,
  rpeDelta: null, repCompletionRate: null,
  baseSets: [{ pct: 75, reps: 6, restSec: 150 }, { pct: 75, reps: 6, restSec: 150 }, { pct: 75, reps: 6, restSec: 150 }],
  ...over,
} as Ex)

function signalsFor(goal: string, phase: string, set: string, autoApply: boolean, confidence: number, budget: number, over: Partial<PrescriptionSignals> = {}) {
  const extras = set === 'extras'
  return {
    trainingGoal: goal, autoApplyPrescriptions: autoApply, effectiveTimeBudgetMin: budget,
    exercises: [
      exercise('p', 'primary', 'quadriceps', extras ? {
        rpeDelta: 1.5, effortAnswer: 1, rm1Trend: 'down',
        liftPreference: { preference: { repRange: null, restSec: null, oneShot: null, checkinHold: { weekStart: '2026-11-23', barKg: 60 } }, basisKg: 100 },
      } as Partial<Ex> : {}),
      exercise('s', 'secondary', 'back', extras ? {
        liftPreference: { preference: { repRange: { min: 8, max: 10 }, restSec: 100, oneShot: null }, basisKg: 90 },
      } as Partial<Ex> : {}),
      exercise('a', 'accessory', 'biceps'),
    ],
    phase, sessionsInPhase: 2, hoursSinceLastSession: 48, consecutiveSessionDaysOfThisType: 0,
    soreMusclesInSession: [], recentlyTrainedMusclesInSession: [], soreMusclesOutOfSession: [],
    sorenessLogDate: 'none', activeInjuredMusclesInSession: [], morningCheckin: null, rpeTrend: null,
    repCompletionRate: null, weeklyTargets: {}, weeklyLogged: {}, volumeBudgetPerMuscleGroup: {}, acwr: null,
    sleepTrend: null, hrvTrend: null, spo2Trend: null, illness: null, externalReadiness: null,
    confidenceTier: 1, confidence, confidenceReasons: ['Test reason'], selfReportedSick: false, sleepScoreTrend: null,
    tempZ: null, trainingLoadOts: null, trainingLoadHigh: null, resilienceLevel: null,
    ...over,
  } as unknown as PrescriptionSignals
}

/** The model's answer, its compound rows in the middle of the phase's zone (an in-zone answer). */
function answerFor(goal: string, phase: string, kind: typeof ANSWERS[number]) {
  const mid = (role: string, p: string) => {
    const z = intensityZoneForRole(goal, p, role)
    return { pct: (z.pctMin + z.pctMax) / 2, reps: Math.round((z.repMin + z.repMax) / 2), sets: z.setsMax }
  }
  const target = kind === 'earned' ? NEXT[phase] : kind === 'deload' ? 'deload' : phase
  const p = mid('primary', target), sec = mid('secondary', target)
  const action = { stay: 'stay', earned: 'transition_recommended', deload: 'deload_recommended', rest: 'rest_day_recommended', swap: 'session_swap_recommended', extreme: 'stay' }[kind]
  const extreme = kind === 'extreme'
  return {
    phase: target, phase_action: action, deload: kind === 'deload', reasoning: 'Model says.',
    exercises: [
      { session_exercise_id: 'p', name: 'Lift p', sets: extreme ? 10 : p.sets, reps: extreme ? 30 : p.reps, pct: p.pct, rest_sec: extreme ? 600 : 180 },
      { session_exercise_id: 's', name: 'Lift s', sets: extreme ? 10 : sec.sets, reps: extreme ? 30 : sec.reps, pct: sec.pct, rest_sec: extreme ? 600 : 150 },
      { session_exercise_id: 'a', name: 'Lift a', sets: 3, reps: 12, pct: 60, rest_sec: 90 },
    ],
  }
}

interface Row {
  programSessionId: string; phase: PeriodizationPhase; phaseStartedAt: Date; sessionsInPhase: number
  baselineComplete: boolean; pendingTransition: ReturnType<typeof programMoveMark> | null
  prescription: AiPrescription | null; prescriptionStatus: PrescriptionStatus
  prescriptionExpiresAt: Date | null; prescriptionGeneratedAt: Date | null; preEmergencyDeloadPhase: null
}

let users = 0
/** Three session types (push planned), one phase begun `weeksDone` local weeks before this one. */
function program(opts: { kind: string; goal: string; phase: PeriodizationPhase; weeksDone: number; voters: boolean; waiting: boolean; budget: number }) {
  const { phase } = opts
  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(NOW)
  const weekday = (new Date(`${todayStr}T12:00:00Z`).getUTCDay() + 6) % 7
  const thisMonday = shiftDateStr(todayStr, -weekday)
  const startDay = shiftDateStr(thisMonday, -7 * opts.weeksDone)
  const start = dateStrMidnightInTz(startDay, TZ)
  const completions = Array.from({ length: opts.weeksDone }, (_, i) =>
    ({ programSessionId: 'legs', completedAt: new Date(dateStrMidnightInTz(shiftDateStr(startDay, 7 * i + 2), TZ).getTime() + 12 * 3_600_000) }))
  const voteAnswers: Array<{ programSessionId: string; phase: string; phaseAction: string; createdAt: Date }> = []
  if (opts.voters) {
    for (const [i, id] of ['legs', 'pull'].entries()) {
      const trainedAt = new Date(dateStrMidnightInTz(thisMonday, TZ).getTime() + i * DAY + 12 * 3_600_000)
      completions.push({ programSessionId: id, completedAt: trainedAt })
      voteAnswers.push({ programSessionId: id, phase: NEXT[phase], phaseAction: 'transition_recommended', createdAt: new Date(trainedAt.getTime() - 4 * 3_600_000) })
    }
  }
  const base = (id: string): Row => ({
    programSessionId: id, phase, phaseStartedAt: start, sessionsInPhase: 2, baselineComplete: true,
    pendingTransition: opts.waiting ? null : programMoveMark(phase),
    prescription: null, prescriptionStatus: 'consumed', prescriptionExpiresAt: null, prescriptionGeneratedAt: null,
    preEmergencyDeloadPhase: null,
  })
  const db = new Map<string, Row>(['push', 'legs', 'pull'].map(id => [id, base(id)]))
  if (opts.waiting) Object.assign(db.get('pull')!, { phase: phase === 'accumulation' ? 'intensification' : 'accumulation', phaseStartedAt: new Date(start.getTime() - 21 * DAY) })
  const log = { stores: [] as unknown[], moves: [] as unknown[], typeMoves: [] as unknown[], exits: [] as unknown[] }
  const known: Record<string, unknown> = {
    getActiveProgramWithStructureStamp: async () => ({
      program: {
        id: 'prog', ...(opts.kind !== 'none' && { phaseMode: opts.kind }), trainingGoal: opts.goal,
        sessions: ['push', 'legs', 'pull'].map(id => ({ id, timeBudgetMinutes: opts.budget, exercises: [] })),
      },
      structure: 'stamp',
    }),
    getCheckinSessionBudgetMin: async () => null,
    ensureSessionPeriodization: async (_u: string, id: string) => ({ ...db.get(id)! }),
    getSessionPeriodization: async (_u: string, id: string) => ({ ...db.get(id)! }),
    reconcileSessionsInPhase: async () => undefined,
    listSessionPeriodizationForProgram: async () => [...db.values()].map(r => ({ ...r })),
    listProgramCompletions: async () => completions,
    listModelPhaseAnswers: async () => voteAnswers,
    setProgramPhase: async () => true,
    setProgramPendingTransition: async () => undefined,
    realignProgramPhase: async () => undefined,
    voidSessionPrescription: async () => undefined,
    recordPrescriptionShadow: async () => undefined,
    getDaySessionSummaries: async () => [],
    listUnfinishedLoggedSessions: async () => [],
    exitDeload: async (_u: string, id: string, newPhase: PeriodizationPhase) => {
      Object.assign(db.get(id)!, { phase: newPhase, phaseStartedAt: new Date(), sessionsInPhase: 0, prescriptionStatus: 'consumed' })
      log.exits.push(newPhase)
      return true
    },
    advanceProgramPhase: async (_u: string, id: string, newPhase: PeriodizationPhase, expected?: { phase: string; phaseStartedAt: Date }) => {
      const all = [...db.values()]
      if (expected && !all.every(r => r.phase === expected.phase && r.phaseStartedAt.getTime() === expected.phaseStartedAt.getTime())) return null
      const at = new Date()
      for (const r of all) Object.assign(r, { phase: newPhase, phaseStartedAt: at, sessionsInPhase: 0, prescriptionStatus: 'consumed', pendingTransition: programMoveMark(newPhase) })
      log.moves.push([expected?.phase ?? '?', newPhase])
      return { ...db.get(id)! }
    },
    advancePhase: async (_u: string, _id: string, p: string) => { log.typeMoves.push(p) },
    storePrescription: async (_u: string, id: string, prescription: AiPrescription, expiresAt: Date, status: PrescriptionStatus, generatedFor: { phase: string; phaseStartedAt: Date }) => {
      const r = db.get(id)!
      if (r.phase !== generatedFor.phase || r.phaseStartedAt.getTime() !== generatedFor.phaseStartedAt.getTime()) return false
      Object.assign(r, { prescription, prescriptionStatus: status, prescriptionExpiresAt: expiresAt, prescriptionGeneratedAt: new Date() })
      log.stores.push({ prescription, status, expiresAt, generatedFor })
      return true
    },
  }
  const repo = new Proxy({}, { get: (_t, prop: string) => known[prop] ?? (async () => undefined) }) as WorkoutRepository
  const user = `u-3900-id-${++users}`
  return { run: () => generatePrescriptionForSession(user, 'push', repo, TZ, 'ws-done'), log, db }
}

interface Case { key: string; group: string; kind: string; label: string; setup: () => void; opts: Parameters<typeof program>[0] }

function grid(kinds: readonly string[]): Case[] {
  const cases: Case[] = []
  for (const kind of kinds) for (const goal of GOALS) for (const phase of PHASES) for (const ans of ANSWERS) {
    const group = `${kind}|${goal}|${phase}|${ans}`
    for (const st of STATES) for (const [autoApply, conf] of SWITCHES) for (const set of SIGNAL_SETS) for (const budget of BUDGETS) {
      cases.push({
        key: `${group}|${st}|${autoApply}|${conf}|${set}|${budget}`, group, kind, label: ans,
        setup: () => {
          mocks.signals = signalsFor(goal, phase, set, autoApply, conf, budget)
          mocks.answer = answerFor(goal, phase, ans)
          mocks.fail = false
        },
        opts: {
          kind, goal, phase, budget,
          weeksDone: st === 'at-cap' ? CAP[phase] : st === 'under-cap' ? Math.max(0, CAP[phase] - 2) : 0,
          voters: st === 'vote', waiting: st === 'waiting',
        },
      })
    }
    // The paths with no model answer: an emergency deload, the whole-session soreness deload, the model down.
  }
  for (const kind of kinds) for (const goal of GOALS) for (const phase of PHASES) for (const [autoApply, conf] of SWITCHES) {
    for (const path of ['emergency-sick', 'emergency-load', 'soreness', 'model-down'] as const) {
      const group = `${kind}|${goal}|${phase}|${path}`
      cases.push({
        key: `${group}|${autoApply}|${conf}`, group, kind, label: path,
        setup: () => {
          const over: Partial<PrescriptionSignals> = path === 'emergency-sick' ? { selfReportedSick: true, hoursSinceLastSession: 20 }
            : path === 'emergency-load' ? { acwr: 1.8 }
            : path === 'soreness' ? { soreMusclesInSession: ['quadriceps', 'back', 'biceps'], sorenessLogDate: 'today', hoursSinceLastSession: 60 } as Partial<PrescriptionSignals>
            : {}
          mocks.signals = signalsFor(goal, phase, 'plain', autoApply, conf, 90, over)
          mocks.answer = answerFor(goal, phase, 'stay')
          mocks.fail = path === 'model-down'
        },
        opts: { kind, goal, phase, budget: 90, weeksDone: 1, voters: false, waiting: false },
      })
    }
  }
  return cases
}

async function runCase(c: Case) {
  c.setup()
  mocks.prompts = []
  const h = program(c.opts)
  const result = await h.run()
  return {
    result,
    stores: h.log.stores, moves: h.log.moves, typeMoves: h.log.typeMoves, exits: h.log.exits,
    rows: [...h.db.values()].map(r => ({ id: r.programSessionId, phase: r.phase, status: r.prescriptionStatus, expiresAt: r.prescriptionExpiresAt })),
    prompts: mocks.prompts.map(p => createHash('sha256').update(p).digest('hex')),
  }
}

const sha = (text: string) => createHash('sha256').update(text).digest('hex')

describe('#3900: plans, statuses, moves and prompts outside the AI plan are byte-identical to main', () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })
  afterAll(() => vi.useRealTimers())

  it('every case, grouped, hashes as main recorded it', async () => {
    const cases = grid(KINDS)
    const byGroup = new Map<string, string[]>()
    for (const c of cases) {
      vi.setSystemTime(NOW)
      const out = await runCase(c)
      byGroup.set(c.group, [...(byGroup.get(c.group) ?? []), `${c.key}\n${JSON.stringify(out)}`])
    }
    const hashes = Object.fromEntries([...byGroup].map(([g, outs]) => [g, sha(outs.join('\n'))]))
    if (RECORD) {
      const dir = join(__dirname, '__check_fixture__')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'ai-plan-identity-3900.golden.json'), JSON.stringify({ cases: cases.length, ...hashes }, null, 2) + '\n')
      return
    }
    expect(cases.length).toBe(Number(golden.cases))
    const differed = Object.keys(hashes).filter(g => hashes[g] !== golden[g])
    expect(differed, `groups that differ from main: ${differed.join(', ')}`).toEqual([])
  }, 300_000)

  it.runIf(!!DUMP)('the AI plan cases, written out for the differential', async () => {
    writeFileSync(DUMP!, '')
    for (const c of grid(['ai_dynamic'])) {
      vi.setSystemTime(NOW)
      appendFileSync(DUMP!, JSON.stringify({ key: c.key, label: c.label, out: await runCase(c) }) + '\n')
    }
  }, 300_000)
})
