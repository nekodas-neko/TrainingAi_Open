// #3751 at the route: the split and the names are code's, and the check's trims and notes reach the
// response. Mocks only — the model's answer is a fixture.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const USER_ID = '00000000-0000-4000-8000-000000003751'

let captured = ''
let modelSessions: unknown[] = []
const generateObject = vi.fn(async (args: { prompt: string }) => {
  captured = args.prompt
  return { object: { name: 'Test', reasoning: 'Built.', sessions: modelSessions } }
})

vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: USER_ID, timezone: 'Australia/Brisbane' } })) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))
vi.mock('ai', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  generateObject: (args: { prompt: string }) => generateObject(args),
}))
vi.mock('@/lib/ai/instrument', () => ({
  loggedGenerateObject: async (_meta: unknown, run: () => Promise<unknown>) => run(),
}))

const LIBRARY = [
  { id: '1', name: 'Bench Press', muscles: [{ muscle: 'Chest', role: 'main' }], equipment: ['barbell'] },
  { id: '2', name: 'Barbell Row', muscles: [{ muscle: 'Lats', role: 'main' }], equipment: ['barbell'] },
  { id: '3', name: 'Squat', muscles: [{ muscle: 'Quads', role: 'main' }], equipment: ['barbell'] },
  { id: '4', name: 'Lateral Raise', muscles: [{ muscle: 'Shoulders', role: 'main' }], equipment: ['dumbbell'] },
  { id: '5', name: 'Dumbbell Curl', muscles: [{ muscle: 'Biceps', role: 'main' }], equipment: ['dumbbell'] },
  { id: '6', name: 'Triceps Pushdown', muscles: [{ muscle: 'Triceps', role: 'main' }], equipment: ['cable'] },
]
const set = (reps: number, restSec: number) => ({ reps, restSec })
const STYLES = [
  { id: 'st-g4', name: 'General 4-set', sets: Array(4).fill(set(12, 60)) },
  { id: 'st-g', name: 'General', sets: Array(3).fill(set(12, 60)) },
]

vi.mock('@/lib/data', () => ({
  getRepository: async () => ({
    listExerciseLibrary: async () => LIBRARY,
    listProgressionStyles: async () => STYLES,
    listInjuries: async () => [],
    listPrograms: async () => [],
  }),
}))

const BODY = {
  programName: 'Test',
  equipment: ['full_gym'],
  sessionsPerWeek: 3,
  timePerSessionMinutes: 30,
  musclesToFocus: ['Chest', 'Lats', 'Quads', 'Shoulders', 'Biceps', 'Triceps'],
  goal: 'hypertrophy' as const,
  progressionMode: 'linear' as const,
  totalWeeks: 12,
  scheduleType: 'rotation' as const,
  rotationRestAfterN: 3,
}

async function post(body: unknown = BODY) {
  const { POST } = await import('@/app/api/generate-program/route')
  return POST(new Request('http://localhost/api/generate-program', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }))
}

const mex = (name: string, exerciseRole: string, progressionStyleName = 'General') => ({ name, exerciseRole, progressionStyleName })

describe('generate-program checks the result in code (#3751)', () => {
  beforeEach(() => {
    captured = ''
    generateObject.mockClear()
    modelSessions = [
      { icon: '🫸', exercises: [mex('Bench Press', 'primary'), mex('Lateral Raise', 'accessory'), mex('Dumbbell Curl', 'accessory'), mex('Triceps Pushdown', 'accessory')] },
      { icon: '🫷', exercises: [mex('Barbell Row', 'primary')] },
      { icon: '🦵', exercises: [mex('Squat', 'primary')] },
    ]
  })

  it('names the sessions from the split, and lists them in the prompt instead of a table to copy', async () => {
    const res = await post()
    expect(res.status).toBe(200)
    const { program } = await res.json()
    expect(program.sessions.map((s: { name: string }) => s.name)).toEqual(['Push', 'Pull', 'Legs'])
    expect(captured).toContain('SESSIONS — return exactly 3')
    expect(captured).toContain('1. Push: ')
    expect(captured).not.toContain('RECOMMENDED SPLITS')
    expect(generateObject).toHaveBeenCalledTimes(1)
  })

  it('trims an over-budget session and returns the notes, without asking the model again', async () => {
    // Push: 412 + 3 × (294 + 120) = 1654 s against 26 working minutes (1560 s).
    const res = await post()
    const { program, notes } = await res.json()
    expect(program.sessions[0].exercises.map((e: { name: string }) => e.name))
      .toEqual(['Bench Press', 'Lateral Raise', 'Dumbbell Curl'])
    expect(notes).toContain('Removed Triceps Pushdown from Push to fit the 30-minute session.')
    // One 4-set chest exercise in Push, which a rest after every 3 of 3 sessions runs 1.75 times a
    // week (#3840): 7 sets, under hypertrophy's 8.
    expect(notes).toContain('Chest gets 7 sets a week, under the 8 this goal starts at.')
    expect(generateObject).toHaveBeenCalledTimes(1)
  })

  it('a session the model left out comes back as a failure, not a nameless session', async () => {
    modelSessions = modelSessions.slice(0, 2)
    const res = await post()
    expect(res.status).toBe(502)
    expect((await res.json()).error).toContain('Legs')
  })

  it('a 2-day full-body rotation gets no neighbour-overlap note (#3840)', async () => {
    modelSessions = [
      { icon: '🏋️', exercises: [mex('Bench Press', 'primary'), mex('Squat', 'secondary')] },
      { icon: '🏋️', exercises: [mex('Bench Press', 'primary'), mex('Squat', 'secondary')] },
    ]
    const res = await post({ ...BODY, sessionsPerWeek: 2, timePerSessionMinutes: null })
    expect(res.status).toBe(200)
    const { program, notes } = await res.json()
    expect(program.sessions.map((s: { name: string }) => s.name)).toEqual(['Full Body A', 'Full Body B'])
    expect(notes.some((n: string) => n.includes('consecutive days'))).toBe(false)
  })
})
