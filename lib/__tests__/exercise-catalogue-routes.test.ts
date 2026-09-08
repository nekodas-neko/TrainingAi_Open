/**
 * PS-39 — the exercise catalogue: `exercise-library`, `activity-types` and `exercises/generate`.
 *
 * The catalogue's media route (`exercise-gif`) is covered against real rows in
 * `lib/data/postgres/__tests__/exercise-gif-route.test.ts`, because its logic is entirely SQL —
 * which table it prefers, what it skips, and what it writes back. These three own theirs in
 * TypeScript.
 *
 * The two list reads are thin on purpose and what matters is what they are NOT: unscoped catalogue
 * reads, so no `userId` reaches them, and they still refuse an anonymous caller. `generate` is the
 * one that writes nothing and costs money:
 *
 *   · **Structured output, never `JSON.parse` of model text** — the schema is what makes a
 *     hallucinated muscle name a failure rather than a stored row.
 *   · **A generation failure is reported and answered as a 500**, not surfaced raw.
 *   · **Rate-limited at creation**, like every AI route.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>

const listExerciseLibrary = vi.fn(async () => [] as Row[])
const listActivityTypes = vi.fn(async () => [] as Row[])
const loggedGenerateObject = vi.fn(async (_meta: unknown, run: () => Promise<unknown>) => run())
const generateObject = vi.fn(async (..._a: unknown[]) => ({ object: {} }) as Row)
const reportServerError = vi.fn((..._a: unknown[]) => undefined)

let sessionUser: { id: string } | null = { id: 'u-1' }
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))
vi.mock('@/lib/observability', () => ({ reportServerError: (...a: unknown[]) => reportServerError(...a) }))
vi.mock('ai', () => ({ generateObject: (...a: unknown[]) => generateObject(...a) }))
vi.mock('@/lib/ai/instrument', () => ({
  aiModel: () => 'test-model',
  loggedGenerateObject: (meta: unknown, run: () => Promise<unknown>) => loggedGenerateObject(meta, run),
}))
vi.mock('@/lib/data', () => {
  // Built inside the factory: `vi.mock` is hoisted above the consts above.
  const repo = async () => ({ listExerciseLibrary, listActivityTypes })
  return { getRepository: repo, getRepositoryAsync: repo }
})

import { GET as getLibrary } from '@/app/api/exercise-library/route'
import { GET as getActivityTypes } from '@/app/api/activity-types/route'
import { POST as postGenerate } from '@/app/api/exercises/generate/route'

const generate = (body: unknown) =>
  postGenerate(Object.assign(new Request('http://localhost/api/exercises/generate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), { nextUrl: new URL('http://localhost/api/exercises/generate') }) as never)

const GENERATED = {
  normalizedName: 'Barbell Hip Thrust',
  instructions: 'Sit against a bench…',
  muscles: [{ muscle: 'Glutes', role: 'main' }],
  equipment: ['barbell'],
}

let seq = 0
const freshUser = () => { sessionUser = { id: `u-${++seq}` } }

beforeEach(() => {
  vi.clearAllMocks()
  freshUser()
  listExerciseLibrary.mockResolvedValue([])
  listActivityTypes.mockResolvedValue([])
  loggedGenerateObject.mockImplementation(async (_meta, run) => run())
  generateObject.mockResolvedValue({ object: GENERATED })
})

describe('the two catalogue lists', () => {
  it('refuse an anonymous caller, even though the catalogue is not user-scoped', async () => {
    sessionUser = null
    expect((await getLibrary()).status).toBe(401)
    expect((await getActivityTypes()).status).toBe(401)
    expect(listExerciseLibrary).not.toHaveBeenCalled()
    expect(listActivityTypes).not.toHaveBeenCalled()
  })

  // Shared catalogues: taking a userId would imply a per-user list that does not exist, and the
  // repository signature says so by not having one.
  it('read the shared catalogue without a user', async () => {
    await getLibrary()
    await getActivityTypes()
    expect(listExerciseLibrary).toHaveBeenCalledWith()
    expect(listActivityTypes).toHaveBeenCalledWith()
  })

  it('answer under a key rather than as a bare array, uncacheable', async () => {
    listExerciseLibrary.mockResolvedValue([{ name: 'Bench Press' }])
    listActivityTypes.mockResolvedValue([{ name: 'Run' }])

    const lib = await getLibrary()
    expect(await lib.json()).toEqual({ exercises: [{ name: 'Bench Press' }] })
    expect(lib.headers.get('Cache-Control')).toBe('private, no-store')

    const types = await getActivityTypes()
    expect(await types.json()).toEqual({ activityTypes: [{ name: 'Run' }] })
    expect(types.headers.get('Cache-Control')).toBe('private, no-store')
  })
})

describe('/api/exercises/generate', () => {
  it('refuses without a session', async () => {
    sessionUser = null
    expect((await generate({ name: 'Hip Thrust' })).status).toBe(401)
    expect(generateObject).not.toHaveBeenCalled()
  })

  // Each of these is a well-formed request in every respect but the field it names.
  it('bounds the name and refuses a key it does not know', async () => {
    for (const bad of [{ name: '' }, { name: 'x'.repeat(121) }, { name: 42 }, {}, { name: 'Squat', userId: 'someone-else' }]) {
      expect((await generate(bad)).status).toBe(400)
    }
    expect(generateObject).not.toHaveBeenCalled()
  })

  it('refuses an oversized body before the schema sees it', async () => {
    const res = await generate({ name: 'Squat', pad: 'x'.repeat(8 * 1024) })
    expect(res.status).toBe(413)   // 413, not the 400 an unknown key would earn
    expect(generateObject).not.toHaveBeenCalled()
  })

  // Structured output, never `JSON.parse` of model text: the schema is what makes a hallucinated
  // muscle a failure rather than a stored row.
  it('asks for a schema-checked object and answers it', async () => {
    const res = await generate({ name: 'Hip Thrust' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(GENERATED)

    const call = generateObject.mock.calls[0][0] as Row
    expect(call.schema).toBeDefined()
    expect(call.prompt).toContain('Hip Thrust')
  })

  // The call is instrumented under its own section, with the name as the fingerprint — that is what
  // makes a spend spike attributable to a route rather than to "AI".
  it('logs the call under its own section, fingerprinted by the name', async () => {
    await generate({ name: 'Hip Thrust' })
    expect(loggedGenerateObject.mock.calls[0][0]).toMatchObject({
      section: 'exercises-generate', userId: sessionUser!.id, fingerprint: 'Hip Thrust',
    })
  })

  it('reports a generation failure and answers a plain 500', async () => {
    generateObject.mockRejectedValue(new Error('model refused'))
    const res = await generate({ name: 'Hip Thrust' })

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Generation failed' })
    expect(reportServerError).toHaveBeenCalled()
  })

  it('rate-limits the twenty-first generation in the minute', async () => {
    for (let i = 0; i < 20; i++) expect((await generate({ name: 'Hip Thrust' })).status).toBe(200)
    expect((await generate({ name: 'Hip Thrust' })).status).toBe(429)
  })
})
