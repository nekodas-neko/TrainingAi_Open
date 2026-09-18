/**
 * RV-51 — builder-chat was relying on the same accident generate-program was.
 *
 * A merged duplicate is not a separate exercise. This route filtered on `equipmentEligible` alone,
 * so a merged row was excluded only when its equipment list happened to be empty. Handing the model
 * both names invites a swap between two rows that are the same movement.
 *
 * The merged fixture row carries equipment on purpose: an unlabelled one passes against the unfixed
 * route and proves nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const USER_ID = '00000000-0000-4000-8000-0000000051a2'

let capturedPrompt = ''

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: USER_ID, timezone: 'Australia/Brisbane' } })),
}))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))
vi.mock('ai', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  generateObject: vi.fn(async (args: { prompt: string; system: string }) => {
    capturedPrompt = args.prompt
    return { object: { response: 'ok', program: { name: 'p', sessions: [] } } }
  }),
}))
vi.mock('@/lib/ai/instrument', () => ({
  aiModel: () => ({}),
  loggedGenerateObject: async (_meta: unknown, run: () => Promise<unknown>) => run(),
}))

const LIBRARY = [
  { id: 'c1', name: 'Cable Pulldown', muscles: [{ muscle: 'Lats', role: 'main' }], equipment: ['cable'] },
  { id: 'd1', name: 'Straight Arm Pulldown', muscles: [{ muscle: 'Lats', role: 'main' }], equipment: ['cable'], mergedInto: 'c1' },
  { id: 'd2', name: 'Cable Lat Pulldown', muscles: [{ muscle: 'Lats', role: 'main' }], equipment: [], mergedInto: 'c1' },
  { id: 'c2', name: 'Barbell Row', muscles: [{ muscle: 'Lats', role: 'main' }], equipment: ['barbell'] },
]

vi.mock('@/lib/data', () => ({
  getRepository: async () => ({
    listExerciseLibrary: async () => LIBRARY,
    listProgressionStyles: async () => [{ id: 's', name: 'Standard' }],
    listInjuries: async () => [],
  }),
}))

async function post() {
  const { POST } = await import('@/app/api/builder-chat/route')
  return POST(new Request('http://localhost/api/builder-chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message: 'swap something',
      program: {
        name: 'p',
        sessions: [{
          name: 'Pull', icon: 'dumbbell',
          exercises: [{ name: 'Barbell Row', exerciseRole: 'accessory', mainMuscles: ['Lats'], secondaryMuscles: [] }],
        }],
      },
      chatHistory: [],
      equipment: ['barbell', 'cable'],
    }),
  }))
}

describe('builder-chat excludes merged duplicates (RV-51)', () => {
  beforeEach(() => { capturedPrompt = '' })

  it('does not offer a merged duplicate that is equipment-eligible', async () => {
    await post()
    expect(capturedPrompt).not.toContain('Straight Arm Pulldown')
  })

  it('still offers the canonical row it was merged into', async () => {
    await post()
    expect(capturedPrompt).toContain('Cable Pulldown')
  })

  // Deliberately equivalent control: already excluded by equipment, must stay excluded.
  it('keeps excluding a merged duplicate that has no equipment', async () => {
    await post()
    expect(capturedPrompt).not.toContain('Cable Lat Pulldown')
  })

  // Over-filtering guard: an ordinary exercise must survive, or the case above is true for the
  // wrong reason.
  it('still offers an ordinary exercise', async () => {
    await post()
    expect(capturedPrompt).toContain('Barbell Row')
  })
})
