// #3896 step 5 — the lift_preference domain is offered only to a client that says it renders it.
// Mocks only: no model is called. An older Preview build and the web app send no `patchDomains`, so
// the domain is absent from `proposeChange`'s schema and its description is exactly what it was.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const USER_ID = '00000000-0000-4000-8000-000000389651'
const EX = '00000000-0000-4000-8000-000000389652'
const T = '00000000-0000-4000-8000-000000389653'

type Tools = Record<string, { inputSchema: { safeParse: (v: unknown) => { success: boolean } }; description?: string }>
const streamed = vi.hoisted(() => ({ calls: [] as { system: string; tools: Tools }[] }))
const resolveCoachContext = vi.hoisted(() => vi.fn())

vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: USER_ID, timezone: 'Australia/Brisbane' } })) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))
vi.mock('@/lib/data', () => ({ getRepositoryAsync: async () => ({ listInjuries: async () => [] }) }))
vi.mock('@/lib/data/postgres/client', () => ({ getDb: () => ({}), ensureSchema: async () => {} }))
vi.mock('@/lib/coach/context', async (orig) => ({ ...(await orig<Record<string, unknown>>()), resolveCoachContext }))
vi.mock('@ai-sdk/google', () => ({ google: { tools: { googleSearch: () => ({}) } } }))
vi.mock('@/lib/ai/instrument', () => ({
  loggedStreamText: (_meta: unknown, args: { system: string; tools: Tools }) => {
    streamed.calls.push(args)
    return { toUIMessageStreamResponse: () => new Response('ok') }
  },
}))
vi.mock('ai', async (orig) => ({ ...(await orig<Record<string, unknown>>()), convertToModelMessages: async () => [] }))

async function post(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/coach/route')
  return POST(new Request('http://localhost/api/coach', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', parts: [{ type: 'text', text: 'hi' }] }], ...body }),
  }))
}

const liftProposal = {
  kind: 'change_preview', title: 'More reps',
  patch: { domain: 'lift_preference', targetId: T, changes: [{ id: 'c1', field: 'repRange', from: null, to: 'more_reps' }] },
}
const goalProposal = {
  kind: 'change_preview', title: 'Steps',
  patch: { domain: 'user_goals', targetId: null, changes: [{ id: 'g', field: 'stepsGoal', from: 8000, to: 10000 }] },
}

beforeEach(() => { streamed.calls = []; resolveCoachContext.mockReset() })

describe('/api/coach lift_preference gate (#3896 step 5)', () => {
  it('a client that does not name the domain is never offered it, and its prompt is unchanged', async () => {
    expect((await post({})).status).toBe(200)
    const { proposeChange } = streamed.calls[0].tools
    expect(proposeChange.inputSchema.safeParse(liftProposal).success).toBe(false)
    expect(proposeChange.inputSchema.safeParse(goalProposal).success).toBe(true)
    expect(proposeChange.description).not.toContain('lift_preference')
    expect(proposeChange.description).toContain('There is NO field for')
    // Naming an unknown or ungated domain widens nothing.
    await post({ patchDomains: ['made_up', 'user_goals'] })
    expect(streamed.calls[1].tools.proposeChange.inputSchema.safeParse(liftProposal).success).toBe(false)
    expect(streamed.calls[1].tools.proposeChange.description).toBe(proposeChange.description)
  })

  it('a client that names it is offered it, with its description', async () => {
    expect((await post({ patchDomains: ['lift_preference'] })).status).toBe(200)
    const { proposeChange } = streamed.calls[0].tools
    expect(proposeChange.inputSchema.safeParse(liftProposal).success).toBe(true)
    expect(proposeChange.description).toContain('"lift_preference"')
    expect(proposeChange.description).not.toContain('There is NO field for')
  })

  it('the nutrition scope never offers it, declared or not', async () => {
    await post({ scope: 'nutrition', patchDomains: ['lift_preference'] })
    const { proposeChange } = streamed.calls[0].tools
    expect(proposeChange.inputSchema.safeParse(liftProposal).success).toBe(false)
  })

  it('another user\'s lift in the context is refused with 404 and no model call, with the domain declared', async () => {
    resolveCoachContext.mockResolvedValue({ ok: false })
    const res = await post({ patchDomains: ['lift_preference'], context: { origin: 'exercise', sessionExerciseId: EX } })
    expect(res.status).toBe(404)
    expect(streamed.calls).toHaveLength(0)
  })

  it('400s a malformed declaration', async () => {
    expect((await post({ patchDomains: 'lift_preference' })).status).toBe(400)
    expect((await post({ patchDomains: Array(21).fill('x') })).status).toBe(400)
    expect(streamed.calls).toHaveLength(0)
  })
})
