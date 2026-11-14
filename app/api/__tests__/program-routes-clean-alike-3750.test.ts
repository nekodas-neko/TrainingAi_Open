// #3750. `/api/generate-program` and `/api/builder-chat` each cleaned the model's program by hand,
// and the chat kept an exercise only on an exact name match. Both now call `cleanModelProgram`.
// This gives the two routes the SAME model answer and requires the same sessions back.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GOAL_STYLE_RULES } from '@trainingai/shared/workout/known-styles'

const USER_ID = '00000000-0000-4000-8000-000000003750'
const RULES = GOAL_STYLE_RULES.hypertrophy

/** The same sessions, as either route's model call would return them. */
const MODEL_SESSIONS = [{
  name: 'Push',
  icon: '🫸',
  exercises: [
    // Paraphrases the resolver accepts: case, then punctuation and word order, then a plural.
    { name: 'bench press', exerciseRole: 'primary', progressionStyleName: 'Invented' },
    { name: 'Press, Overhead', exerciseRole: 'primary', progressionStyleName: 'Invented' },
    { name: 'Triceps Pushdowns', exerciseRole: 'accessory', progressionStyleName: 'Custom' },
    { name: 'Cable Fly', exerciseRole: 'accessory', progressionStyleName: 'Invented' },
    // Not in the library at all.
    { name: 'Unicorn Press', exerciseRole: 'accessory', progressionStyleName: 'Custom' },
    // An added word is not a paraphrase to the resolver (LA-43), for either route.
    { name: 'Barbell Bench Press', exerciseRole: 'secondary', progressionStyleName: 'Custom' },
  ],
}]

const reported: string[] = []
let modelObject: unknown = null

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: USER_ID, timezone: 'Australia/Brisbane' } })),
}))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))
vi.mock('@/lib/observability', () => ({
  reportServerError: (err: unknown) => { reported.push(err instanceof Error ? err.message : String(err)) },
}))
vi.mock('ai', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  generateObject: vi.fn(async () => ({ object: modelObject })),
}))
vi.mock('@/lib/ai/instrument', () => ({
  aiModel: () => ({}),
  loggedGenerateObject: async (_meta: unknown, run: () => Promise<unknown>) => run(),
}))

const LIBRARY = [
  { id: 'e1', name: 'Bench Press', muscles: [{ muscle: 'Chest', role: 'main' }, { muscle: 'Triceps', role: 'secondary' }], equipment: ['barbell'] },
  { id: 'e2', name: 'Overhead Press', muscles: [{ muscle: 'Shoulders', role: 'main' }], equipment: ['barbell'] },
  { id: 'e3', name: 'Triceps Pushdown', muscles: [{ muscle: 'Triceps', role: 'main' }], equipment: ['cable'] },
  { id: 'e4', name: 'Cable Fly', muscles: [{ muscle: 'Chest', role: 'main' }], equipment: ['cable'] },
]
const STYLES = [
  { id: 'style-primary', name: RULES.primary },
  { id: 'style-accessory', name: RULES.accessory },
  { id: 'style-custom', name: 'Custom' },
]

vi.mock('@/lib/data', () => ({
  getRepository: async () => ({
    listExerciseLibrary: async () => LIBRARY,
    listProgressionStyles: async () => STYLES,
    listInjuries: async () => [],
    listPrograms: async () => [],
  }),
}))

const json = (url: string, body: unknown) => new Request(url, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
})

async function generate() {
  modelObject = { name: 'Test', sessions: MODEL_SESSIONS, reasoning: 'because' }
  const { POST } = await import('@/app/api/generate-program/route')
  const res = await POST(json('http://localhost/api/generate-program', {
    programName: 'Test', equipment: ['barbell', 'cable'], sessionsPerWeek: 3, timePerSessionMinutes: 60,
    musclesToFocus: ['Chest', 'Shoulders', 'Triceps'], goal: 'hypertrophy', progressionMode: 'linear',
    totalWeeks: 12, scheduleType: 'weekly', weeklyDays: [0, 2, 4],
  }))
  expect(res.status).toBe(200)
  return (await res.json()) as { program: { sessions: Session[] } }
}

async function chat() {
  modelObject = { response: 'Done.', program: { name: 'Test', sessions: MODEL_SESSIONS } }
  const { POST } = await import('@/app/api/builder-chat/route')
  const res = await POST(json('http://localhost/api/builder-chat', {
    message: 'add a chest accessory',
    program: {
      name: 'Test',
      sessions: [{
        name: 'Push', icon: '🫸',
        exercises: [{ name: 'Bench Press', exerciseRole: 'primary', mainMuscles: ['Chest'], secondaryMuscles: ['Triceps'] }],
      }],
    },
    chatHistory: [],
    equipment: ['barbell', 'cable'],
    goal: 'hypertrophy',
  }))
  expect(res.status).toBe(200)
  return (await res.json()) as { response: string; program: { sessions: Session[] } }
}

interface Session {
  name: string
  icon: string
  exercises: { name: string; exerciseRole: string; progressionStyleName?: string; progressionStyleId?: string; mainMuscles: string[]; secondaryMuscles: string[] }[]
}

describe('#3750 both program routes clean the same model answer the same way', () => {
  beforeEach(() => { reported.length = 0 })

  it('both keep a paraphrased name, under the library spelling and with its muscles', async () => {
    for (const body of [await generate(), await chat()]) {
      const [bench, press] = body.program.sessions[0].exercises
      expect(bench).toMatchObject({ name: 'Bench Press', mainMuscles: ['Chest'], secondaryMuscles: ['Triceps'] })
      expect(press).toMatchObject({ name: 'Overhead Press', mainMuscles: ['Shoulders'], secondaryMuscles: [] })
    }
  })

  it('both drop a name the library does not hold', async () => {
    for (const body of [await generate(), await chat()]) {
      const names = body.program.sessions[0].exercises.map(e => e.name)
      expect(names).toEqual(['Bench Press', 'Overhead Press', 'Triceps Pushdown', 'Cable Fly'])
    }
  })

  it('the chat still counts what it removed, and the generator still reports it', async () => {
    const chatBody = await chat()
    expect(chatBody.response).toBe('Done.\n\n(Removed 2 exercises not in the exercise library.)')
    await generate()
    expect(reported.some(m => m.includes('dropped 2 unresolvable') && m.includes('Unicorn Press'))).toBe(true)
  })

  it('styles and the primary cap come out the same from both', async () => {
    const generated = await generate()
    const chatted = await chat()
    expect(chatted.program.sessions).toEqual(generated.program.sessions)
    // And they are the expected ones, so "equal" cannot mean "equally wrong".
    expect(generated.program.sessions[0].exercises.map(e => [e.exerciseRole, e.progressionStyleName, e.progressionStyleId])).toEqual([
      ['primary', RULES.primary, 'style-primary'],
      ['secondary', RULES.secondary, STYLES.find(s => s.name === RULES.secondary)?.id],
      ['accessory', 'Custom', 'style-custom'],
      ['accessory', RULES.accessory, 'style-accessory'],
    ])
  })
})
