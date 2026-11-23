// #4061: the lifter's tapped "how did it feel?" answer takes rated RPE's place as the effort signal.
//
// IDENTITY. A person with no tapped answer must get the plans and prompts `main` gave, byte for byte:
// with no answer at all, and with only `default` (untouched "As expected") answers. The golden file
// (fixtures/effort-answer-identity-4061.golden.json, one SHA-256 of the output per case) was written
// by this test on `main` (d71663e0d) BEFORE the answer was read. Each case runs the real signal layer (`aggregateSignals`) and the real
// generator over one fake repository, so the read, the signals, the prompt, autoregulation, the
// rules fallback and the stored plan are all on the path. The static program path is covered too.
//
// EQUIVALENCE. On the same grid, a tapped Harder gives the plan a rated RPE running exactly
// `TAPPED_HARDER_RPE_DELTA` high gives, and a tapped Easier the plan of one running
// `TAPPED_EASIER_RPE_DELTA` low: every number, every set, every rep, every load.
//
// #4079 (note only). For a tapped Harder, Easier or As expected, the plan WITHOUT its notes must hash
// as `main`'s did (effort-answer-note-4079.golden.json, recorded on `main` 19345a8ee, before the note
// existed), the prompt too, and a lift's note may differ only by gaining the sentence where `main`
// had none. A person with no tapped answer is the 4061 golden above, untouched.
//
// 0 real model calls: the model is a mock that records the prompt it was sent.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import type { AiPrescription } from '@trainingai/shared/types/ai-periodization'
import type { WorkoutRepository } from '@/lib/data/repository'
import { expectedRpe } from '../expected-rpe'
import { buildWorkoutExercises } from '../../workout/session-data'
import { STATIC_SESSION, staticCtx } from './fixtures/lift-preference-scenarios'

// The golden file is committed; a test may not write tracked source (LB-194). To re-record it on a
// tree you have checked is `main`, run with EFFORT_4061_RECORD=1: the outputs go to the gitignored
// `__check_fixture__/` beside this file, to be copied over the golden by hand.
const GOLDEN = join(__dirname, 'fixtures', 'effort-answer-identity-4061.golden.json')
const golden: Record<string, string> = existsSync(GOLDEN) ? JSON.parse(readFileSync(GOLDEN, 'utf8')) : {}
const recorded: Record<string, string> = {}
const counts = { identity: 0, identityDiffered: 0, equivalence: 0, equivalenceDiffered: 0 }
/** Each case's output as its SHA-256: byte-exact, without a megabyte of JSON in the tree. */
function matchesMain(key: string, value: unknown) {
  const text = createHash('sha256').update(JSON.stringify(value, null, 2)).digest('hex')
  recorded[key] = text
  if (process.env.EFFORT_4061_RECORD) {
    const dir = join(__dirname, '__check_fixture__')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'effort-answer-identity-4061.golden.json'), JSON.stringify(recorded, null, 2) + '\n')
    return
  }
  counts.identity++
  if (text !== golden[key]) counts.identityDiffered++
  expect(golden[key], `no golden output recorded for ${key}`).toBeDefined()
  expect(text).toBe(golden[key])
}

const mocks = vi.hoisted(() => ({
  model: null as Record<string, unknown> | null,
  prompts: [] as Array<{ system: string; prompt: string }>,
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

// ── The grid ──────────────────────────────────────────────────────────────────────────────────
// Made-up numbers; no real lift, person or health value.

const NOW = new Date('2026-11-21T02:00:00Z') // local midday, Brisbane
const DAY = 86_400_000
const SESSION_ID = 'ps-4061'
const LIFTS = [
  { id: 'se-p', name: 'Lift p', role: 'primary', muscle: 'quadriceps', style: 'heavy', pct: 80, reps: 5 },
  { id: 'se-s', name: 'Lift s', role: 'secondary', muscle: 'back', style: 'medium', pct: 72.5, reps: 8 },
  { id: 'se-a', name: 'Lift a', role: 'accessory', muscle: 'biceps', style: 'light', pct: 65, reps: 10 },
] as const
const STYLES = LIFTS.map(l => ({
  id: l.style, userId: 'u', name: `Style ${l.style}`,
  sets: [1, 2, 3].map(n => ({ id: `${l.style}-${n}`, styleId: l.style, setNumber: n, pct: l.pct, reps: l.reps, restSec: 150, useFor1rm: true })),
}))

/** What the last three sessions of this type logged for every lift. */
type History =
  | 'none' // never trained
  | 'expected' // every set untouched (the pre-filled value), reps met
  | 'expected-missed' // untouched sets, the latest session a rep short on each set
  | 'expected-down' // untouched sets, reps met, the 1RM slipping
  | 'rated-high-missed' // rated sets running high (+2 vs expected), a rep short
  | 'rated-low-met' // rated sets running low (-2 vs expected), reps met
  | `rated-delta:${number}:${'missed' | 'met' | 'down'}` // rated at exactly this delta (equivalence)
/** The answer on each lift's latest log. */
type Answer = 'none' | 'default' | 'tapped-as-expected' | 'tapped-harder' | 'tapped-easier'

interface Case {
  goal: string; phase: string; budget: number; model: boolean; history: History; answer: Answer
}

const GOALS = ['strength', 'hypertrophy', 'powerbuilding']
const PHASES = ['accumulation', 'intensification', 'realisation', 'deload']
const BUDGETS = [90, 40]
const HISTORIES: History[] = ['none', 'expected', 'expected-missed', 'expected-down', 'rated-high-missed', 'rated-low-met']

function setLogs(history: History, sessionIds: string[]) {
  if (history === 'none') return []
  const out: Array<{ workoutSessionId: string; exerciseName: string; setNumber: number; rpe: number; reps: number; intensityPct: number; setTimeSec: number; rpeSource: 'expected' | 'rated'; plannedReps: number }> = []
  const [kind, deltaText, shape] = history.split(':')
  for (const [i, ws] of sessionIds.entries()) {
    for (const l of LIFTS) {
      for (const n of [1, 2, 3]) {
        const missed = i === 0 && (history.endsWith('missed') || shape === 'missed')
        const reps = missed ? l.reps - 1 : l.reps
        const exp = expectedRpe(l.pct, reps)
        const rated = kind.startsWith('rated')
        const delta = kind === 'rated-delta' ? Number(deltaText) : history === 'rated-high-missed' ? 2 : -2
        out.push({
          workoutSessionId: ws, exerciseName: l.name, setNumber: n,
          // An untouched set carries the rounded pre-fill, as a phone sends it.
          rpe: rated ? exp + delta : Math.min(10, Math.max(6, Math.round(exp))),
          reps, intensityPct: l.pct, setTimeSec: 40, rpeSource: rated ? 'rated' : 'expected', plannedReps: l.reps,
        })
      }
    }
  }
  return out
}

function answers(answer: Answer): Map<string, { vsPlan: number | null; source: string | null }> {
  const pair = {
    'none': null, 'default': { vsPlan: 0, source: 'default' }, 'tapped-as-expected': { vsPlan: 0, source: 'tapped' },
    'tapped-harder': { vsPlan: 1, source: 'tapped' }, 'tapped-easier': { vsPlan: -1, source: 'tapped' },
  }[answer]
  return new Map(pair ? LIFTS.map(l => [l.name, pair] as const) : [])
}

const modelAnswer = (phase: string) => ({
  phase: phase === 'baseline' ? 'accumulation' : phase, phase_action: 'stay', deload: false, reasoning: 'test plan',
  exercises: LIFTS.map(l => ({ session_exercise_id: l.id, name: l.name, sets: 3, reps: l.reps, pct: l.pct, rest_sec: 150 })),
})

/** One repository that answers both the signal layer and the generator. */
function repoFor(c: Case, stored: AiPrescription[]): WorkoutRepository {
  const sessionIds = c.history === 'none' ? [] : ['ws-3', 'ws-2', 'ws-1']
  const sessions = sessionIds.map((id, i) => ({
    id, startedAt: new Date(NOW.getTime() - (i + 1) * 3 * DAY), completedAt: new Date(NOW.getTime() - (i + 1) * 3 * DAY + 3_600_000),
    sessionName: 'Session A', pausedSec: null,
  }))
  const down = c.history === 'expected-down' || c.history.endsWith(':down')
  const program = {
    id: 'prog-4061', createdAt: new Date(NOW.getTime() - 60 * DAY), trainingGoal: c.goal, autoApplyPrescriptions: false,
    sessions: [{
      id: SESSION_ID, programId: 'prog-4061', name: 'Session A', position: 0, timeBudgetMinutes: c.budget,
      exercises: LIFTS.map((l, i) => ({ id: l.id, sessionId: SESSION_ID, exerciseName: l.name, styleId: l.style, muscleGroups: [l.muscle], position: i, exerciseRole: l.role })),
    }],
  }
  const state = {
    phase: c.phase, baselineComplete: true, sessionsInPhase: 2, phaseStartedAt: new Date(NOW.getTime() - 20 * DAY),
    baseline1rm: {}, lastSessionRanPrescription: true,
    prescription: null, prescriptionStatus: 'consumed', prescriptionExpiresAt: null, prescriptionGeneratedAt: null,
  }
  const logs = setLogs(c.history, sessionIds)
  const effort = answers(c.answer)
  const known: Record<string, unknown> = {
    getActiveProgramWithStructureStamp: async () => ({ program, structure: 'stamp' }),
    getActiveProgram: async () => program,
    ensureSessionPeriodization: async () => state,
    reconcileSessionsInPhase: async () => undefined,
    getSessionPeriodization: async () => state,
    listSessionPeriodizationForProgram: async () => [{ ...state, programSessionId: SESSION_ID }],
    listProgramCompletions: async () => [],
    listModelPhaseAnswers: async () => [],
    setProgramPhase: async () => true,
    setProgramPendingTransition: async () => undefined,
    realignProgramPhase: async () => undefined,
    voidSessionPrescription: async () => undefined,
    getSessionReadLogs: async () => [],
    storePrescription: async (_u: string, _s: string, p: AiPrescription) => { stored.push(p); return true },
    listProgressionStyles: async () => STYLES,
    listPersonalRecords: async () => new Map(LIFTS.map(l => [l.name, 100])),
    listRecent1rm: async () => new Map(LIFTS.map(l => [l.name, down ? { latest: 92, previous: 100 } : { latest: 100, previous: 100 }])),
    listVolumeTargets: async () => LIFTS.map(l => ({ muscleGroup: l.muscle, targetSetsPerWeek: 12 })),
    getRecentSessionsOfType: async () => sessions,
    getSetLogsForSessions: async (ids: string[]) => logs.filter(x => ids.includes(x.workoutSessionId)),
    getTimingAuditData: async () => ({ sets: [], exercises: [], sessions: [] }),
    getOuraCloudSwitchDay: async () => null,
    getMoodLog: async () => null,
    getDayCheckin: async () => null,
    getWeeklySetsByMuscleGroup: async () => ({}),
    getExerciseMuscleAssignments: async () => ({}),
    getExerciseEquipment: async () => ({}),
    getExerciseTypes: async () => ({}),
    getExercise1rmHistory: async () => ({}),
    // The answer on each lift's latest log (#4061). On `main` nothing calls it.
    getLatestExerciseEfforts: async (_u: string, ids: string[], names: string[]) =>
      new Map([...effort].filter(([name]) => ids.length > 0 && names.includes(name))),
  }
  return new Proxy({}, { get: (_t, prop: string) => known[prop] ?? (async () => []) }) as WorkoutRepository
}

let n = 0
async function generate(c: Case) {
  mocks.model = c.model ? modelAnswer(c.phase) : null
  mocks.prompts = []
  const stored: AiPrescription[] = []
  const result = await generatePrescriptionForSession(`user-4061-${++n}`, SESSION_ID, repoFor(c, stored), 'Australia/Brisbane')
  return { ok: result.ok, stored: stored[0] ?? null, prompt: mocks.prompts[0]?.prompt ?? null }
}

const grid: Omit<Case, 'answer'>[] = []
for (const goal of GOALS) for (const phase of PHASES) for (const budget of BUDGETS) for (const model of [true, false])
  for (const history of HISTORIES) grid.push({ goal, phase, budget, model, history })
const label = (c: Omit<Case, 'answer'>) => `${c.goal}/${c.phase}/${c.budget}min/${c.model ? 'model' : 'model-fails'}/${c.history}`

describe('a person with no tapped answer gets main\'s plan and prompt (#4061)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })
  afterEach(() => { vi.useRealTimers() })

  it(`no answer and default-only answers, ${grid.length} cases each, every path that sets a load`, async () => {
    for (const c of grid) {
      const none = await generate({ ...c, answer: 'none' })
      expect(none.ok, label(c)).toBe(true)
      matchesMain(`${label(c)}`, none)
      // The golden has one entry per case: a default answer must give exactly the no-answer output.
      matchesMain(`${label(c)}`, await generate({ ...c, answer: 'default' }))
    }
  }, 120_000)

  it('the static program path is unchanged (it reads no effort)', () => {
    for (const mode of ['automatic', 'ai_dynamic'] as const) {
      matchesMain(`static:${mode}`, buildWorkoutExercises(STATIC_SESSION, staticCtx(mode)))
    }
  })
})

// ── Equivalence (the PR head only: on `main` nothing reads the answer) ──────────────────────────

const figures = (p: AiPrescription | null) => p && {
  phase: p.phase, phaseAction: p.phaseAction, deload: p.deload,
  exercises: p.exercises.map(e => ({ ...e, autoregNote: undefined, reasoning: undefined })),
}
const equivalenceGrid = grid.filter(c => c.model && c.history === 'none')
const moved: Record<string, number> = {}

describe.skipIf(!!process.env.EFFORT_4061_RECORD)('a tapped answer gives the plan its declared rated RPE gives (#4061)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })
  afterEach(() => { vi.useRealTimers() })

  it.each([
    ['Harder', 'tapped-harder', 'missed'],
    ['Harder', 'tapped-harder', 'met'],
    ['Harder', 'tapped-harder', 'down'],
    ['Easier', 'tapped-easier', 'met'],
    ['Easier', 'tapped-easier', 'missed'],
  ] as const)('tapped %s (%s), reps %s: the same figures as the rated delta', async (_name, answer, shape) => {
    const { TAPPED_HARDER_RPE_DELTA, TAPPED_EASIER_RPE_DELTA } = await import('../autoregulation')
    const delta = answer === 'tapped-harder' ? TAPPED_HARDER_RPE_DELTA : TAPPED_EASIER_RPE_DELTA
    const untouched: History = shape === 'missed' ? 'expected-missed' : shape === 'down' ? 'expected-down' : 'expected'
    for (const base of equivalenceGrid) {
      const tapped = await generate({ ...base, history: untouched, answer })
      const rated = await generate({ ...base, history: `rated-delta:${delta}:${shape}`, answer: 'none' })
      counts.equivalence++
      if (JSON.stringify(figures(tapped.stored)) !== JSON.stringify(figures(rated.stored))) counts.equivalenceDiffered++
      expect(figures(tapped.stored), label(base)).toEqual(figures(rated.stored))
      // And the answer is not ignored: the plan differs from the untouched one wherever the rule acts.
      const plain = await generate({ ...base, history: untouched, answer: 'none' })
      if (JSON.stringify(figures(tapped.stored)) !== JSON.stringify(figures(plain.stored))) moved[`${answer}:${shape}`] = (moved[`${answer}:${shape}`] ?? 0) + 1
    }
  }, 60_000)

  it('a tapped As expected on the latest log cancels a rated delta on the same log', async () => {
    // Rated sets running +2 high with a rep short would cut the load. The same log with a tapped
    // As expected reads as no signal, so the plan is the one for untouched sets with the same miss.
    let cut = 0
    for (const base of equivalenceGrid) {
      const rated = await generate({ ...base, history: 'rated-high-missed', answer: 'none' })
      const cancelled = await generate({ ...base, history: 'rated-high-missed', answer: 'tapped-as-expected' })
      const noSignal = await generate({ ...base, history: 'expected-missed', answer: 'none' })
      expect(figures(cancelled.stored), label(base)).toEqual(figures(noSignal.stored))
      if (JSON.stringify(figures(rated.stored)) !== JSON.stringify(figures(cancelled.stored))) cut++
    }
    expect(cut, 'the rated delta alone must have moved some plans, or this proves nothing').toBeGreaterThan(0)
  }, 60_000)

  it('the answer moves the plan exactly where the rule acts', () => {
    // Harder with a miss or a falling 1RM cuts; Easier with reps met bumps (not in a realisation
    // block, which takes no rep push). Harder alone, and Easier with a miss, move nothing. Deload
    // phases take no adjustment at all. Per goal and budget: 3 goals × 2 budgets = 6 cases a phase.
    // Hypertrophy accumulation's zone clamp, applied after autoregulation, lifts this fixture's cut
    // back to the zone floor, for a rated RPE exactly as for a tap (the equivalence above holds
    // there): 3 phases × 6 − 2.
    expect(moved).toEqual({
      'tapped-harder:missed': 16,
      'tapped-harder:down': 16,
      'tapped-easier:met': 12, // accumulation, intensification
    })
  })

  it('reports the counts', () => {
    console.info(`[4061] identity: ${counts.identity} compared, ${counts.identityDiffered} differed; equivalence: ${counts.equivalence} compared, ${counts.equivalenceDiffered} differed`)
    expect(counts.identityDiffered).toBe(0)
    expect(counts.equivalenceDiffered).toBe(0)
  })
})


// ── #4079: a tapped answer the rule did not act on is said in the note, and nothing else moves ────

const GOLDEN_NOTES = join(__dirname, 'fixtures', 'effort-answer-note-4079.golden.json')
interface NoteGolden { hash: string; notes: Record<string, string> }
const goldenNotes: Record<string, NoteGolden> = existsSync(GOLDEN_NOTES) ? JSON.parse(readFileSync(GOLDEN_NOTES, 'utf8')) : {}
const recordedNotes: Record<string, NoteGolden> = {}
const noteCounts = { compared: 0, planDiffered: 0, gainedNote: 0, kept: 0, silent: 0 }
const SAID = /^You said it felt (harder|easier)[.,]/

/** The plan and the prompt with every lift's note removed, as one hash, plus the notes by lift. */
function stripNotes(r: Awaited<ReturnType<typeof generate>>): NoteGolden {
  const notes: Record<string, string> = {}
  const stored = r.stored && {
    ...r.stored,
    exercises: r.stored.exercises.map(e => {
      if (e.autoregNote !== undefined) notes[e.sessionExerciseId] = e.autoregNote
      const { autoregNote: _note, ...rest } = e
      return rest
    }),
  }
  const hash = createHash('sha256').update(JSON.stringify({ ok: r.ok, stored, prompt: r.prompt }, null, 2)).digest('hex')
  return { hash, notes }
}

describe.skipIf(!!process.env.EFFORT_4061_RECORD)('a tapped answer the rule did not act on gains a note and moves nothing (#4079)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })
  afterEach(() => { vi.useRealTimers() })

  it(`${grid.length} cases × 3 tapped answers: the plan without its notes is main's`, async () => {
    for (const c of grid) {
      for (const answer of ['tapped-harder', 'tapped-easier', 'tapped-as-expected'] as const) {
        const key = `${label(c)}/${answer}`
        const now = stripNotes(await generate({ ...c, answer }))
        if (process.env.EFFORT_4079_RECORD) { recordedNotes[key] = now; continue }
        const main = goldenNotes[key]
        expect(main, `no golden recorded for ${key}`).toBeDefined()
        noteCounts.compared++
        if (now.hash !== main.hash) noteCounts.planDiffered++
        expect(now.hash, `${key}: a value, the prompt or the stored plan moved`).toBe(main.hash)
        for (const id of LIFTS.map(l => l.id)) {
          const before = main.notes[id]
          const after = now.notes[id]
          if (before !== undefined) {
            // A rule that acted keeps its note word for word; the sentence is never added over it.
            expect(after, key).toBe(before)
            noteCounts.kept++
          } else if (after !== undefined) {
            noteCounts.gainedNote++
            expect(answer, `${key}: a note without a Harder or Easier tap`).not.toBe('tapped-as-expected')
            expect(after, key).toMatch(SAID)
            expect(after.endsWith('.'), key).toBe(true)
          } else noteCounts.silent++
        }
      }
    }
    if (process.env.EFFORT_4079_RECORD) {
      const dir = join(__dirname, '__check_fixture__')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'effort-answer-note-4079.golden.json'), JSON.stringify(recordedNotes, null, 1) + '\n')
    } else {
      console.info(`[4079] ${noteCounts.compared} cases compared, ${noteCounts.planDiffered} plans (without notes) differed; lift notes: ${noteCounts.gainedNote} gained, ${noteCounts.kept} kept as main had them, ${noteCounts.silent} silent`)
      expect(noteCounts.planDiffered).toBe(0)
      // Pinned, so a rule change that adds or drops a note shows up here and is looked at. Silent lifts are
      // As expected taps, the rules fallback (which never runs autoregulation, so never read the tap),
      // and a lift with no history (nothing logged, nothing to read).
      expect({ compared: noteCounts.compared, gainedNote: noteCounts.gainedNote, kept: noteCounts.kept, silent: noteCounts.silent })
        .toEqual({ compared: 864, gainedNote: 494, kept: 226, silent: 1872 })
    }
  }, 300_000)
})
