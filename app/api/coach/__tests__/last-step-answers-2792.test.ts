// #2792. A question that chains read tools used to spend all six steps reading and end with no
// answer — measured on pnpm dev with real Gemini, 2026-10-11: "Which of my sessions has the most
// volume?" ended on a read tool in 3 of 3 runs, a bench-vs-squat comparison in 1 of 3. With the last
// step answering, 8 of 8 ended in a chart (which the client's "shown" result continues from) or prose.
// Withholding every tool with `toolChoice: 'none'` alone did not hold — Gemini still emitted a call,
// which failed as unknown — so the final step also keeps the chart and carries a note.
import { describe, it, expect, vi } from 'vitest'

const USER_ID = '00000000-0000-4000-8000-000000279201'

type PrepareStep = (o: { stepNumber: number }) => { activeTools?: string[]; system?: string; toolChoice?: unknown } | undefined
let captured: { tools: Record<string, unknown>; system: string; prepareStep: PrepareStep; stopWhen: unknown } | null = null

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: USER_ID, timezone: 'Australia/Brisbane' } })),
}))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))
const injuryRows: unknown[] = []
const listInjuries = vi.fn(async (_userId: string) => injuryRows)
vi.mock('@/lib/data', () => ({ getRepositoryAsync: async () => ({ listInjuries }) }))
vi.mock('@ai-sdk/google', () => ({ google: { tools: { googleSearch: () => ({}) } } }))
vi.mock('@/lib/ai/instrument', () => ({
  COACH_MODEL_ID: 'test',
  coachModel: () => ({}),
  loggedStreamText: (_meta: unknown, args: { tools: Record<string, unknown>; system: string }) => {
    captured = args as never
    return { toUIMessageStreamResponse: () => new Response('ok') }
  },
}))
vi.mock('ai', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  convertToModelMessages: async () => [],
}))

async function post(scope?: string) {
  const { POST } = await import('@/app/api/coach/route')
  const res = await POST(new Request('http://localhost/api/coach', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', parts: [{ type: 'text', text: 'hi' }] }], scope }),
  }))
  expect(res.status).toBe(200)
  return captured!
}


describe('the Coach answers on its last step (#2792)', () => {
  it('reads freely before the last step', async () => {
    const { COACH_MAX_STEPS } = await import('@/lib/coach/step-limit')
    const args = await post()
    for (let n = 0; n < COACH_MAX_STEPS - 1; n++) expect(args.prepareStep({ stepNumber: n })).toBeUndefined()
  })

  it('on the last step keeps only the chart and tells the model to answer', async () => {
    const { COACH_MAX_STEPS } = await import('@/lib/coach/step-limit')
    const args = await post()
    const last = args.prepareStep({ stepNumber: COACH_MAX_STEPS - 1 })!
    expect(last.activeTools).toEqual(['renderChart'])
    expect(last.system).toContain(args.system)
    expect(last.system).toMatch(/Answer the user now/)
    expect(Object.keys(args.tools)).toContain('renderChart')
  })
})
