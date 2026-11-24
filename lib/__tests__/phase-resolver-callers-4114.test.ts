// #4114 items 2, 3 and 6: the daily digest and the workout screen's `?tab=meta` take each session's automatic
// phase status from the shared resolver (`resolveSessionPhase`) and read phases and counts through
// `getProgramPhaseState`, where each used to run `buildAutomaticPhaseStatus` itself (the digest also read
// phases and counts with two calls, 5 statements). The output must be identical: both routes run for real
// over program kind × how far through the phases × a confirmed early-deload week on/off, and are compared
// with the steps they used to run inline, written out below as the oracle. Made-up names and numbers.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { buildAutomaticPhaseStatus } from '@trainingai/shared/phase-engine'
import { getScheduledSessionsPerWeek } from '@trainingai/shared/schedule-utils'
import { buildDailyDigestText } from '@trainingai/shared/health/daily-digest-text'
import { todayInTz } from '@trainingai/shared/date-utils'

const resolver = vi.hoisted(() => ({ calls: 0 }))
vi.mock('@trainingai/shared/workout/read-session', async importOriginal => {
  const real = await importOriginal<typeof import('@trainingai/shared/workout/read-session')>()
  return { ...real, resolveSessionPhase: (...a: Parameters<typeof real.resolveSessionPhase>) => { resolver.calls++; return real.resolveSessionPhase(...a) } }
})

type Row = Record<string, unknown>
const TZ = 'Australia/Brisbane'
const today = todayInTz(TZ)
const state = { program: null as Row | null, counts: new Map<string, number>(), phases: [] as Row[] }
const reads = { phaseState: 0, oldPhases: 0, oldCounts: 0 }
const repo = {
  getActiveProgram: vi.fn(async () => state.program),
  listProgressionStyles: vi.fn(async () => []),
  listExerciseLibrary: vi.fn(async () => []),
  getProgramPhaseState: vi.fn(async () => { reads.phaseState++; return { phases: state.phases, sessionCounts: state.counts } }),
  listProgramPhases: vi.fn(async () => { reads.oldPhases++; return state.phases }),
  countAllSessionsSinceStart: vi.fn(async () => { reads.oldCounts++; return state.counts }),
  getDaySessionSummaries: vi.fn(async () => [{ sessionName: 'Pull', startedAt: new Date() }]),
  listRecentPersonalRecords: vi.fn(async () => []),
  listFoodLogs: vi.fn(async () => []),
  getNutritionTargets: vi.fn(async () => null),
  getDayCheckin: vi.fn(async () => ({ physicalTiredness: 2, soreMuscles: [] })),
  getUserGoals: vi.fn(async () => ({})),
  listBodyMetrics: vi.fn(async () => []),
  listFoodLogsSummary: vi.fn(async () => []),
  getWorkoutSessionsFrom: vi.fn(async () => []),
}
let seq = 0
vi.mock('@/auth', () => ({ auth: async () => ({ user: { id: `u-${++seq}`, timezone: TZ } }) }))
vi.mock('@/lib/data', () => ({ getRepository: async () => repo }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))

import { POST as digest } from '@/app/api/daily-digest/route'
import { GET as workoutData } from '@/app/api/workout-data/route'

const SESSIONS = [
  { id: 'ps-1', name: 'Push', position: 0, exercises: [] },
  { id: 'ps-2', name: 'Pull', position: 1, exercises: [] },
  { id: 'ps-3', name: 'Legs', position: 2, exercises: [] },
]
const PHASES = (['normal', 'deload', 'baseline', 'testing'] as const).map((phaseType, position) => ({
  id: `ph-${phaseType}`, phaseSetId: 'set-1', position, name: `Block ${position + 1}`, durationCycles: 2, phaseType,
}))
const KINDS = ['manual', 'automatic', 'automatic, no phases', 'ai_dynamic'] as const
const EARLY = { off: undefined, on: today } as const

function setUp(kind: typeof KINDS[number], early: string | undefined, counts: number[]) {
  state.program = {
    id: 'prog-1', phaseMode: kind === 'manual' ? 'manual' : kind === 'ai_dynamic' ? 'ai_dynamic' : 'automatic',
    trainingGoal: 'strength', sessions: SESSIONS, earlyDeloadWeekStart: early,
    schedule: { days: [{ dayOfWeek: 1, sessionId: 'ps-1' }, { dayOfWeek: 3, sessionId: 'ps-2' }, { dayOfWeek: 5, sessionId: 'ps-3' }] },
  }
  state.phases = kind === 'automatic' ? PHASES : []
  state.counts = kind === 'automatic' ? new Map(SESSIONS.map((s, i) => [s.id, counts[i]])) : new Map()
}

// How far each of the three sessions is through the phases (2 cycles each, 8 in all, then past the end).
const COUNT_SETS = [[0, 0, 0], [1, 2, 3], [3, 4, 5], [5, 6, 7], [8, 9, 12], [2, 0, 7]]
const tally = { digest: 0, meta: 0, differences: 0 }

beforeEach(() => { vi.clearAllMocks(); resolver.calls = 0; reads.phaseState = 0; reads.oldPhases = 0; reads.oldCounts = 0 })

/** The digest's phase line as the route built it before: its own two reads and `buildAutomaticPhaseStatus`. */
function oldDigestPhaseSentence(): string | null {
  const program = state.program as never as { sessions: typeof SESSIONS; earlyDeloadWeekStart?: string; phaseMode: string }
  if (program.phaseMode !== 'automatic' || state.phases.length === 0) return null
  const programSession = program.sessions.find(s => s.name === 'Pull')!
  const perWeek = getScheduledSessionsPerWeek(program as never) / Math.max(1, program.sessions.length)
  const st = buildAutomaticPhaseStatus(state.phases as never, state.counts.get(programSession.id) ?? 0, program, today, perWeek)
  const text = buildDailyDigestText({ training: null, prs: [], nutrition: null, steps: null, checkin: null,
    phase: { name: st.phase.name, cycleInPhase: st.cycleInPhase, totalPhaseCycles: st.totalPhaseCycles } })
  return text.replace('Today was a rest day, with no training logged. ', '')
}

describe('the daily digest reads one phase state and the shared resolver (#4114 item 3)', () => {
  for (const kind of KINDS) for (const [earlyLabel, early] of Object.entries(EARLY)) for (const counts of COUNT_SETS) {
    it(`${kind} · early deload ${earlyLabel} · counts ${counts.join('/')}`, async () => {
      setUp(kind, early, counts)
      const body = await (await digest(new Request('http://localhost/api/daily-digest', { method: 'POST' }) as never)).json() as { digest: string }
      const expected = oldDigestPhaseSentence()
      tally.digest++
      if (expected == null) {
        if (/in the .* phase|last session of the/.test(body.digest)) tally.differences++
        expect(body.digest).not.toMatch(/in the .* phase|last session of the/)
      } else {
        if (!body.digest.includes(expected)) tally.differences++
        expect(body.digest).toContain(expected)
      }
      // One read for phases and counts, not two; and the resolver made the status.
      expect(reads.oldPhases).toBe(0)
      expect(reads.oldCounts).toBe(0)
      expect(reads.phaseState).toBe(kind === 'manual' || kind === 'ai_dynamic' ? 0 : 1)
      expect(resolver.calls).toBe(kind === 'manual' || kind === 'ai_dynamic' ? 0 : 1)
    })
  }
})

describe('?tab=meta takes each session\'s phase status from the shared resolver (#4114 item 4)', () => {
  for (const kind of KINDS) for (const [earlyLabel, early] of Object.entries(EARLY)) for (const counts of COUNT_SETS) {
    it(`${kind} · early deload ${earlyLabel} · counts ${counts.join('/')}`, async () => {
      setUp(kind, early, counts)
      const body = await (await workoutData(new NextRequest('http://localhost/api/workout-data?tab=meta'))).json() as {
        phaseStatus: unknown; perSessionPhaseStatus: unknown[]
      }
      // The oracle: the loop the route ran itself, and its leader.
      const program = state.program as never as { sessions: typeof SESSIONS; earlyDeloadWeekStart?: string }
      let oldPer: Array<{ sessionId: string; sessionName: string; phaseStatus: ReturnType<typeof buildAutomaticPhaseStatus> }> = []
      let oldLeader: unknown = null
      if ((state.program as Row).phaseMode === 'automatic' && state.phases.length > 0) {
        const perWeek = getScheduledSessionsPerWeek(program as never) / Math.max(1, program.sessions.length)
        oldPer = program.sessions.map(s => ({ sessionId: s.id, sessionName: s.name,
          phaseStatus: buildAutomaticPhaseStatus(state.phases as never, state.counts.get(s.id) ?? 0, program, today, perWeek) }))
        oldLeader = oldPer.reduce((best, curr) => curr.phaseStatus.completedCycles > best.phaseStatus.completedCycles ? curr : best).phaseStatus
      }
      const same = JSON.stringify(body.perSessionPhaseStatus) === JSON.stringify(JSON.parse(JSON.stringify(oldPer)))
        && JSON.stringify(body.phaseStatus) === JSON.stringify(JSON.parse(JSON.stringify(oldLeader)))
      tally.meta++
      if (!same) tally.differences++
      expect(body.perSessionPhaseStatus).toEqual(JSON.parse(JSON.stringify(oldPer)))
      expect(body.phaseStatus).toEqual(JSON.parse(JSON.stringify(oldLeader)))
      expect(resolver.calls).toBe(oldPer.length)
      expect(reads.oldPhases + reads.oldCounts).toBe(0)
    })
  }
})

it('the differential was not vacuous: every cell ran and none differed', () => {
  expect(tally.digest).toBe(KINDS.length * 2 * COUNT_SETS.length)
  expect(tally.meta).toBe(KINDS.length * 2 * COUNT_SETS.length)
  expect(tally.differences).toBe(0)
  console.info(`[#4114 items 3-4] digest ${tally.digest} cells, meta ${tally.meta} cells, ${tally.differences} differences`)
})

describe('NO_PHASE_STATE is declared once (#4114 item 6)', () => {
  it('is exported beside the phase-state read, empty, and the two routes import it', async () => {
    const mod = await import('@/lib/data/repository')
    expect(mod.NO_PHASE_STATE.phases).toEqual([])
    expect(mod.NO_PHASE_STATE.sessionCounts.size).toBe(0)
    const { readFileSync } = await import('node:fs')
    for (const f of ['app/api/workout-data/route.ts', 'app/api/next-session/prescription/route.ts']) {
      const src = readFileSync(f, 'utf8')
      expect(src, f).not.toMatch(/const NO_PHASE_STATE\s*=/)
      expect(src, f).toMatch(/import \{ NO_PHASE_STATE \} from "@\/lib\/data\/repository"/)
    }
  })
})
