// #3896 steps 6-7 — a Coach button's intent on /api/coach. Mocks only: no model is called. An intent
// is an enum the server turns into its own instruction, and it is refused (400, before any read or
// model call) unless it fits the context and what the client renders.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GENERAL_CHIPS, LIFT_CHIPS, NUTRITION_CHIPS, chipsFor, intentAllowed, COACH_INTENTS } from '@trainingai/shared/coach/chips'
import { intentBlock } from '@/lib/coach/intents'

const USER_ID = '00000000-0000-4000-8000-000000389621'
const EX = '00000000-0000-4000-8000-000000389622'

const streamed = vi.hoisted(() => ({ calls: [] as { system: string }[] }))
const resolveCoachContext = vi.hoisted(() => vi.fn())
const whyThisWeightFor = vi.hoisted(() => vi.fn())

vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: USER_ID, timezone: 'Australia/Brisbane' } })) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))
vi.mock('@/lib/data', () => ({ getRepositoryAsync: async () => ({ listInjuries: async () => [] }) }))
vi.mock('@/lib/data/postgres/client', () => ({ getDb: () => ({}), ensureSchema: async () => {} }))
vi.mock('@/lib/coach/context', async (orig) => ({ ...(await orig<Record<string, unknown>>()), resolveCoachContext }))
vi.mock('@/lib/coach/about', () => ({ whyThisWeightFor }))
vi.mock('@ai-sdk/google', () => ({ google: { tools: { googleSearch: () => ({}) } } }))
vi.mock('@/lib/ai/instrument', () => ({
  loggedStreamText: (_meta: unknown, args: { system: string }) => {
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
/** The second request of a swap exchange: the button's turn, the choice list it drew, and the pick. */
const SWAP_CONTINUATION = [
  { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'I want to swap this lift for another.' }] },
  {
    id: 'a1', role: 'assistant', parts: [{
      type: 'tool-renderChoiceList', toolCallId: 'c1', state: 'output-available',
      input: { source: 'swap_candidates', sourceId: EX }, output: { status: 'chose', value: 'Seated row' },
    }],
  },
]
const lift = { origin: 'exercise', sessionExerciseId: EX }
const DOMAINS = ['lift_preference']

beforeEach(() => {
  streamed.calls = []
  resolveCoachContext.mockReset()
  resolveCoachContext.mockResolvedValue({ ok: true, block: '## Where the user opened you\n- Exercise: "Row"' })
  whyThisWeightFor.mockReset()
})

describe('the buttons (#3896 steps 6-7)', () => {
  it('the labels are the design\'s, six for a lift and four without one', () => {
    expect(LIFT_CHIPS.map(c => c.label)).toEqual(['Too heavy', 'Too light', 'More reps, less weight', 'Swap this', 'It hurt', 'Why this weight?'])
    expect(GENERAL_CHIPS.map(c => c.label)).toEqual(['Change an exercise', 'This felt too heavy / too light', 'Something hurts', 'What’s lagging?'])
    expect(NUTRITION_CHIPS.map(c => c.label)).toEqual(['What can I eat instead of rice'])
    expect(chipsFor({ scope: 'general', lift: true, liftPreference: true })).toEqual(LIFT_CHIPS)
    expect(chipsFor({ scope: 'general', lift: false, liftPreference: true })).toEqual(GENERAL_CHIPS)
    expect(chipsFor({ scope: 'nutrition', lift: true, liftPreference: true })).toEqual(NUTRITION_CHIPS)
    // A client that cannot show the lift card is not offered a button that proposes one.
    expect(chipsFor({ scope: 'general', lift: true, liftPreference: false }).map(c => c.id)).toEqual(['swap', 'hurt', 'why_weight'])
  })

  it('every button sends a fixed message, and its intent stands for a fixed instruction', () => {
    const messages = new Map([...LIFT_CHIPS, ...GENERAL_CHIPS].map(c => [c.id, [c.message, c.intent]]))
    expect(messages.get('too_heavy')).toEqual(['This lift feels too heavy.', 'lift_too_heavy'])
    expect(messages.get('too_light')).toEqual(['This lift feels too light.', 'lift_too_light'])
    expect(messages.get('more_reps')).toEqual(['I want more reps and less weight on this lift.', 'lift_more_reps'])
    expect(messages.get('swap')).toEqual(['I want to swap this lift for another.', 'lift_swap'])
    expect(messages.get('hurt')).toEqual(['This lift hurt.', 'lift_hurt'])
    expect(messages.get('why_weight')).toEqual(['Why is this the weight for this lift?', 'lift_why_weight'])
    expect(messages.get('lagging')).toEqual(['What’s lagging?', null])
    // What each one asks of the model, in code.
    expect(intentBlock('lift_too_heavy')).toMatch(/"lift_preference" domain[\s\S]*"nextLoadStep", `to` "lighter"/)
    expect(intentBlock('lift_too_light')).toMatch(/"nextLoadStep", `to` "heavier"/)
    expect(intentBlock('lift_more_reps')).toMatch(/"repRange", `to` "more_reps"/)
    expect(intentBlock('lift_swap')).toMatch(/source "swap_candidates"/)
    expect(intentBlock('lift_hurt')).toMatch(/Do not propose any change/)
    expect(intentBlock('lift_why_weight')).toMatch(/The app answers this itself[\s\S]*Do not state any number/)
    // #3896 review: no model sentence about the last log; the card carries the numbers.
    for (const intent of ['lift_too_heavy', 'lift_too_light'] as const) {
      expect(intentBlock(intent)).toMatch(/Do not describe the\s+last log and do not name any number/)
      expect(intentBlock(intent)).not.toMatch(/what its last log shows/)
    }
    for (const intent of COACH_INTENTS) expect(intentBlock(intent)).not.toMatch(/\d+ ?kg/)
  })

  it('a lift button with its lift carries its instruction to the model, after the context block', async () => {
    const res = await post({ context: lift, patchDomains: DOMAINS, intent: 'lift_more_reps' })
    expect(res.status).toBe(200)
    const system = streamed.calls[0].system
    expect(system).toContain(intentBlock('lift_more_reps'))
    expect(system.indexOf('## Where the user opened you')).toBeLessThan(system.indexOf('## The button the user tapped'))
  })

  it('a general button from the tab is accepted with no context', async () => {
    expect((await post({ patchDomains: DOMAINS, intent: 'change_exercise' })).status).toBe(200)
    expect(streamed.calls[0].system).toContain(intentBlock('change_exercise'))
  })

  it('a message with no intent has no instruction (as today)', async () => {
    await post({ context: lift, patchDomains: DOMAINS })
    expect(streamed.calls[0].system).not.toContain('## The button the user tapped')
  })

  it.each([
    ['a lift button with no lift', { patchDomains: DOMAINS, intent: 'lift_too_heavy' }],
    ['a lift button from a session', { context: { origin: 'session', programSessionId: EX }, patchDomains: DOMAINS, intent: 'lift_too_heavy' }],
    ['a general button about a lift', { context: lift, patchDomains: DOMAINS, intent: 'change_exercise' }],
    ['a lift-card button from a client that does not render the card', { context: lift, intent: 'lift_more_reps' }],
    ['a training button in the nutrition scope', { scope: 'nutrition', intent: 'something_hurts' }],
    ['an unknown intent', { context: lift, patchDomains: DOMAINS, intent: 'apply_now' }],
  ])('400s %s, before reading the context or calling the model', async (_label, body) => {
    expect((await post(body)).status).toBe(400)
    expect(resolveCoachContext).not.toHaveBeenCalled()
    expect(streamed.calls).toHaveLength(0)
  })

  it('a foreign lift id behind a valid button is still a 404 with no model call', async () => {
    resolveCoachContext.mockResolvedValue({ ok: false })
    const res = await post({ context: lift, patchDomains: DOMAINS, intent: 'lift_why_weight' })
    expect(res.status).toBe(404)
    expect(streamed.calls).toHaveLength(0)
  })

  it('intentAllowed is the one rule', () => {
    expect(intentAllowed('lift_swap', { lift: true, liftPreference: false, training: true })).toBe(true)
    expect(intentAllowed('felt_heavy_or_light', { lift: false, liftPreference: false, training: true })).toBe(false)
  })

  it('"Why this weight?" is answered by code: its text comes back as an assistant message and the model is called 0 times (#3896 review)', async () => {
    whyThisWeightFor.mockResolvedValue('Your program sets this weight: Row at 3 × 8 @ 60 kg next time.')
    const res = await post({ context: lift, patchDomains: DOMAINS, intent: 'lift_why_weight' })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    const chunks = (await res.text()).split('\n').filter(l => l.startsWith('data: ') && l !== 'data: [DONE]').map(l => JSON.parse(l.slice(6)))
    expect(chunks.map(c => c.type)).toEqual(['start', 'text-start', 'text-delta', 'text-end', 'finish'])
    expect(chunks[2].delta).toBe('Your program sets this weight: Row at 3 × 8 @ 60 kg next time.')
    expect(whyThisWeightFor).toHaveBeenCalledWith(expect.anything(), expect.anything(), USER_ID, EX, 'Australia/Brisbane', expect.any(String))
    expect(streamed.calls).toHaveLength(0)
  })

  it('"Why this weight?" for a slot that is not the user\'s is a 404 with no model call', async () => {
    whyThisWeightFor.mockResolvedValue(null)
    expect((await post({ context: lift, patchDomains: DOMAINS, intent: 'lift_why_weight' })).status).toBe(404)
    expect(streamed.calls).toHaveLength(0)
  })

  it('the second request of a swap exchange (a tool result, no new user text) still carries and applies the intent (#3896 review)', async () => {
    const { POST } = await import('@/app/api/coach/route')
    const res = await POST(new Request('http://localhost/api/coach', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: SWAP_CONTINUATION, context: lift, patchDomains: DOMAINS, intent: 'lift_swap' }),
    }))
    expect(res.status).toBe(200)
    expect(streamed.calls[0].system).toContain(intentBlock('lift_swap'))
    expect(intentBlock('lift_swap')).toMatch(/on a later turn, carry on from the step it\s+reached/)
    // And it is checked on that request as on the first: the same intent without its lift is a 400.
    const refused = await POST(new Request('http://localhost/api/coach', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: SWAP_CONTINUATION, patchDomains: DOMAINS, intent: 'lift_swap' }),
    }))
    expect(refused.status).toBe(400)
    expect(streamed.calls).toHaveLength(1)
  })
})

describe('the editor\'s clear is the apply schema\'s only (#3896 review)', () => {
  it('the model-facing schema with lift_preference declared refuses program_default; the apply schema accepts it', async () => {
    const { patchChangeSchemaFor, PatchChangeSchema } = await import('@trainingai/shared/coach/patch')
    const change = { id: 'e1', field: 'repRange', from: '10-12', to: 'program_default' }
    expect(patchChangeSchemaFor(true).safeParse(change).success).toBe(false)
    expect(patchChangeSchemaFor(false).safeParse(change).success).toBe(false)
    expect(PatchChangeSchema.safeParse(change).success).toBe(true)
    // The model may still name a range or ask for more reps.
    expect(patchChangeSchemaFor(true).safeParse({ ...change, to: '12-15' }).success).toBe(true)
    expect(patchChangeSchemaFor(true).safeParse({ ...change, to: 'more_reps' }).success).toBe(true)
  })
})
