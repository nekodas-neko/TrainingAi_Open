// LA-47 — the scope's whole claim is that it withholds rather than instructs, and the only place
// that is observable is the tool set and schemas actually handed to the model. A unit test on the
// scope record would pass just as well if the route ignored it.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const USER_ID = '00000000-0000-4000-8000-0000000047a1'

let captured: { tools: Record<string, { inputSchema?: unknown }>; system: string } | null = null

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: USER_ID, timezone: 'Australia/Brisbane' } })),
}))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))
vi.mock('@/lib/data', () => ({ getRepositoryAsync: async () => ({}) }))
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

/** Whether a tool's schema accepts a payload. Asserted by PARSING rather than by reading Zod's
 *  internals: the mechanism being tested is that the SDK validates the model's arguments and
 *  retries on a mismatch, so acceptance is the behaviour, and an introspection helper would also
 *  have to be rewritten every time Zod moves a private field. */
function accepts(schema: unknown, payload: unknown): boolean {
  return (schema as { safeParse: (v: unknown) => { success: boolean } }).safeParse(payload).success
}

const CHOICE = (source: string) => ({ kind: 'choice_list', prompt: 'Pick one', source })
// `from` is type-checked per field by `PatchChangeSchema`'s discriminated union, so these two
// fixtures carry the right kind of value — otherwise a rejection would prove nothing about the
// domain, which is the only thing being tested.
const EXERCISE_PATCH = {
  kind: 'change_preview',
  title: 'Swap',
  patch: {
    domain: 'session_exercise',
    targetId: '00000000-0000-4000-8000-000000000001',
    changes: [{ id: 'c1', field: 'exerciseName', from: 'Deadlift', to: 'Romanian Deadlift' }],
  },
}
const CALORIE_PATCH = {
  kind: 'change_preview',
  title: 'Calories',
  patch: {
    domain: 'nutrition_targets',
    targetId: null,
    changes: [{ id: 'c1', field: 'calories', from: 2000, to: 2200 }],
  },
}

describe('the coach route scopes by withholding (LA-47)', () => {
  beforeEach(() => { captured = null })

  it('an unscoped request is unchanged — every tool, no extra prompt section', async () => {
    const { tools, system } = await post()
    expect(Object.keys(tools)).toContain('getWorkoutsByExercise')
    expect(Object.keys(tools)).toContain('getProgramStructure')
    expect(Object.keys(tools)).toContain('proposeChange')
    expect(system).not.toContain('This conversation is about food')
  })

  // The tool it never receives is the boundary. A prompt line asking it not to look would be a
  // request; this is not one.
  it('the nutrition scope does not hand over the training read tools', async () => {
    const { tools } = await post('nutrition')
    expect(Object.keys(tools)).not.toContain('getWorkoutsByExercise')
    expect(Object.keys(tools)).not.toContain('getTrainingLoadRisk')
    expect(Object.keys(tools)).not.toContain('getProgramStructure')
    expect(Object.keys(tools)).toContain('getMealPlan')
    expect(Object.keys(tools)).toContain('getEnergyBalance')
  })

  it('and narrows the schemas of the ones it does hand over', async () => {
    const nutrition = await post('nutrition')
    expect(accepts(nutrition.tools.renderChoiceList.inputSchema, CHOICE('proteins'))).toBe(true)
    expect(accepts(nutrition.tools.renderChoiceList.inputSchema, CHOICE('sessions'))).toBe(false)
    expect(accepts(nutrition.tools.proposeChange.inputSchema, CALORIE_PATCH)).toBe(true)
    expect(accepts(nutrition.tools.proposeChange.inputSchema, EXERCISE_PATCH)).toBe(false)
  })

  // The narrowing must not have leaked into the default: every one of these is accepted today, and
  // a scope record that quietly restricted the unscoped route would break every live conversation.
  it('leaves the unscoped schemas accepting everything they did', async () => {
    const general = await post()
    for (const source of ['sessions', 'exercises', 'swap_candidates', 'proteins', 'grocery_stores']) {
      expect(accepts(general.tools.renderChoiceList.inputSchema, CHOICE(source)), source).toBe(true)
    }
    expect(accepts(general.tools.proposeChange.inputSchema, EXERCISE_PATCH)).toBe(true)
    expect(accepts(general.tools.proposeChange.inputSchema, CALORIE_PATCH)).toBe(true)
  })

  it('appends the scope section rather than replacing the prompt', async () => {
    const { system } = await post('nutrition')
    expect(system).toContain('This conversation is about food')
    expect(system).toContain('You are AI Coach in a personal training app')
  })

  // A client on a newer build must get a working Coach, not a 400 — and must not be handed
  // `Object.prototype.toString` as a scope, which `in` would have allowed.
  it('an unknown or prototype-shaped scope widens to general', async () => {
    for (const bad of ['workouts', 'toString', 'constructor']) {
      const { tools } = await post(bad)
      expect(Object.keys(tools), bad).toContain('getWorkoutsByExercise')
    }
  })
})
