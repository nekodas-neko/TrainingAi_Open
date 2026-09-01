// BF-68: `injur` appeared zero times in the whole builder path, so a logged lower-back injury could
// not reach program generation and the owner had no field to type it into.
//
// The assertion is on the PROMPT the model receives, not on a helper in isolation: the fix has to be
// that an injured-muscle exercise is not offerable, and only the prompt shows whether that is true.
// An instruction not to program deadlifts would pass any test written against the helper and still
// let the model return one.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const USER_ID = '00000000-0000-4000-8000-0000000068a1'

let captured = ''
let injuries: unknown[] = []

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: USER_ID, timezone: 'Australia/Brisbane' } })),
}))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))
vi.mock('ai', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  generateObject: vi.fn(async (args: { prompt: string }) => {
    captured = args.prompt
    return { object: { programName: 'x', phaseStructureName: 'Linear Progression', sessions: [] } }
  }),
}))
vi.mock('@/lib/ai/instrument', () => ({
  aiModel: () => ({}),
  loggedGenerateObject: async (_meta: unknown, run: () => Promise<unknown>) => run(),
}))

const LIBRARY = [
  { id: '1', name: 'Deadlift', muscles: [{ muscle: 'Lower Back', role: 'main' }, { muscle: 'Hamstrings', role: 'secondary' }], equipment: ['barbell'] },
  { id: '2', name: 'Good Morning', muscles: [{ muscle: 'Hamstrings', role: 'main' }, { muscle: 'Lower Back', role: 'secondary' }], equipment: ['barbell'] },
  { id: '3', name: 'Leg Curl', muscles: [{ muscle: 'Hamstrings', role: 'main' }], equipment: ['machine'] },
]

vi.mock('@/lib/data', () => ({
  getRepository: async () => ({
    listExerciseLibrary: async () => LIBRARY,
    listProgressionStyles: async () => [],
    listInjuries: async () => injuries,
    listPrograms: async () => [],
  }),
}))

const BODY = {
  programName: 'Test',
  equipment: ['barbell', 'machine'],
  sessionsPerWeek: 3,
  timePerSessionMinutes: 60,
  musclesToFocus: ['Hamstrings', 'Lower Back'],
  goal: 'hypertrophy' as const,
  progressionMode: 'linear' as const,
  totalWeeks: 12,
  scheduleType: 'weekly' as const,
  weeklyDays: [0, 2, 4],
}

async function post(body: unknown = BODY) {
  const { POST } = await import('@/app/api/generate-program/route')
  return POST(new Request('http://localhost/api/generate-program', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

describe('generate-program excludes injured-muscle exercises (BF-68)', () => {
  beforeEach(() => { captured = ''; injuries = [] })

  it('offers every exercise when nothing is injured', async () => {
    await post()
    expect(captured).toContain('Deadlift')
    expect(captured).toContain('Good Morning')
    expect(captured).toContain('Leg Curl')
    expect(captured).not.toContain('ACTIVE INJURIES')
  })

  it('removes them from the list the model picks from, not just from the instructions', async () => {
    injuries = [{ muscleName: 'Lower Back', severity: 'moderate', startedDate: '2026-08-20', resolvedDate: null, notes: 'sore when hinging' }]
    await post()
    expect(captured).not.toContain('Deadlift')
    // The one a prompt instruction misses: a hamstring exercise by name, loading the injured back.
    expect(captured).not.toContain('Good Morning')
    expect(captured).toContain('Leg Curl')
  })

  it('states the injury so the coach can say what it worked around', async () => {
    injuries = [{ muscleName: 'Lower Back', severity: 'moderate', startedDate: '2026-08-20', resolvedDate: null, notes: 'sore when hinging' }]
    await post()
    expect(captured).toContain('ACTIVE INJURIES')
    expect(captured).toContain('Lower Back (moderate,')
    expect(captured).toContain('sore when hinging')
  })

  it('a resolved injury constrains nothing', async () => {
    injuries = [{ muscleName: 'Lower Back', severity: 'moderate', startedDate: '2026-01-01', resolvedDate: '2026-02-01', notes: null }]
    await post()
    expect(captured).toContain('Deadlift')
    expect(captured).not.toContain('ACTIVE INJURIES')
  })

  // Programming through the injury and silently dropping the constraint are both worse than saying
  // the two requests cannot both be honoured.
  it('refuses rather than generating when every candidate is injured', async () => {
    injuries = [
      { muscleName: 'Lower Back', severity: 'moderate', startedDate: '2026-08-20', resolvedDate: null, notes: null },
      { muscleName: 'Hamstrings', severity: 'mild', startedDate: '2026-08-25', resolvedDate: null, notes: null },
    ]
    const res = await post()
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('injured')
    expect(captured).toBe('')
  })
})
