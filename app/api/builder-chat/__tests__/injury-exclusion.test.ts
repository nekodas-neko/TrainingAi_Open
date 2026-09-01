// BF-68's trap: `builder-chat` DOES take free text, so telling it about a sore lower back would
// often produce a sensible-looking swap — from luck, because the model was handed no injury record
// and no instruction to treat one as a hard constraint. These assert the record now reaches it and
// that the exercises it could pick are filtered, so the swap is a rule rather than a coin flip.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const USER_ID = '00000000-0000-4000-8000-0000000068a2'

let capturedPrompt = ''
let capturedSystem = ''
let injuries: unknown[] = []

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: USER_ID, timezone: 'Australia/Brisbane' } })),
}))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))
vi.mock('ai', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  generateObject: vi.fn(async (args: { prompt: string; system: string }) => {
    capturedPrompt = args.prompt
    capturedSystem = args.system
    return { object: { response: 'ok', program: { name: 'p', sessions: [] } } } // shape is irrelevant; the prompt is what is asserted
  }),
}))
vi.mock('@/lib/ai/instrument', () => ({
  aiModel: () => ({}),
  loggedGenerateObject: async (_meta: unknown, run: () => Promise<unknown>) => run(),
}))

const LIBRARY = [
  { id: '1', name: 'Deadlift', muscles: [{ muscle: 'Lower Back', role: 'main' }], equipment: ['barbell'] },
  { id: '2', name: 'Good Morning', muscles: [{ muscle: 'Hamstrings', role: 'main' }, { muscle: 'Lower Back', role: 'secondary' }], equipment: ['barbell'] },
  { id: '3', name: 'Leg Curl', muscles: [{ muscle: 'Hamstrings', role: 'main' }], equipment: ['machine'] },
]

vi.mock('@/lib/data', () => ({
  getRepository: async () => ({
    listExerciseLibrary: async () => LIBRARY,
    listProgressionStyles: async () => [{ id: 's', name: 'Standard' }],
    listInjuries: async () => injuries,
  }),
}))

async function post(message = 'swap something') {
  const { POST } = await import('@/app/api/builder-chat/route')
  return POST(new Request('http://localhost/api/builder-chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message,
      program: {
        name: 'p',
        sessions: [{
          name: 'Pull', icon: 'dumbbell',
          exercises: [{ name: 'Leg Curl', exerciseRole: 'accessory', mainMuscles: ['Hamstrings'], secondaryMuscles: [] }],
        }],
      },
      chatHistory: [],
      equipment: ['barbell', 'machine'],
    }),
  }))
}

describe('builder-chat honours logged injuries (BF-68)', () => {
  beforeEach(() => { capturedPrompt = ''; capturedSystem = ''; injuries = [] })

  it('offers every exercise when nothing is injured', async () => {
    await post()
    expect(capturedPrompt).toContain('Deadlift')
    expect(capturedPrompt).toContain('Good Morning')
  })

  it('cannot offer an injured-muscle exercise, in any role', async () => {
    injuries = [{ muscleName: 'Lower Back', severity: 'severe', startedDate: '2026-08-20', resolvedDate: null, notes: null }]
    await post('my lower back is sore')
    expect(capturedPrompt).not.toContain('Deadlift')
    expect(capturedPrompt).not.toContain('Good Morning')
    expect(capturedPrompt).toContain('Leg Curl')
    expect(capturedSystem).toContain('Lower Back (severe,')
  })

  // The constraint dying at save is the entry's actual complaint: a swap agreed in this
  // conversation does not reach the daily prescription, which reads `injuries`.
  it('tells an un-injured user to log one rather than leaving it in the chat', async () => {
    await post('my lower back is sore')
    expect(capturedSystem).toContain('Health → Injuries')
    expect(capturedSystem).not.toContain('ACTIVE INJURIES')
  })

  it('drops that instruction once an injury is on record', async () => {
    injuries = [{ muscleName: 'Lower Back', severity: 'mild', startedDate: '2026-08-20', resolvedDate: null, notes: null }]
    await post()
    expect(capturedSystem).not.toContain('Health → Injuries')
    expect(capturedSystem).toContain('ACTIVE INJURIES')
  })
})
