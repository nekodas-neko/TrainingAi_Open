// #3840: the admin exercise editor can still refresh an existing entry with the model. `refresh: true`
// skips the library lookup, and only an active admin may send it. Mocks only.
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>
const listExerciseLibrary = vi.fn(async () => [] as Row[])
const getUserById = vi.fn(async (_id: string) => null as Row | null)
const generateObject = vi.fn(async (..._a: unknown[]) => ({ object: {} }) as Row)
let allowed = true

vi.mock('@/auth', () => ({ auth: async () => ({ user: { id: 'u-3840' } }) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => allowed }))
vi.mock('@/lib/observability', () => ({ reportServerError: () => undefined }))
vi.mock('ai', () => ({ generateObject: (...a: unknown[]) => generateObject(...a) }))
vi.mock('@/lib/ai/instrument', () => ({
  loggedGenerateObject: (_meta: unknown, run: () => Promise<unknown>) => run(),
}))
vi.mock('@/lib/data', () => ({ getRepository: async () => ({ listExerciseLibrary, getUserById }) }))

import { POST } from '@/app/api/exercises/generate/route'

const generate = (body: unknown) =>
  POST(new Request('http://localhost/api/exercises/generate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }) as never)

const BENCH = {
  id: 'ex-bench', name: 'Bench Press', instructions: 'Old text.',
  muscles: [{ muscle: 'Chest', role: 'main' }], equipment: ['barbell'], exerciseType: 'weighted',
}
const FRESH = {
  normalizedName: 'Barbell Bench Press', instructions: 'New text.',
  muscles: [{ muscle: 'Chest', role: 'main' }, { muscle: 'Triceps', role: 'secondary' }], equipment: ['barbell'],
}

beforeEach(() => {
  vi.clearAllMocks()
  allowed = true
  listExerciseLibrary.mockResolvedValue([BENCH])
  generateObject.mockResolvedValue({ object: FRESH })
  getUserById.mockResolvedValue({ id: 'u-3840', isActive: true, isAdmin: true })
})

describe('/api/exercises/generate refresh', () => {
  it('an admin refresh asks the model for a name the library already holds', async () => {
    const res = await generate({ name: 'Bench Press', refresh: true })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.instructions).toBe('New text.')
    expect(body.libraryId).toBeUndefined()
    expect(generateObject).toHaveBeenCalledTimes(1)
    expect(listExerciseLibrary).not.toHaveBeenCalled()
  })

  it('without refresh the same admin gets the library entry and no model call', async () => {
    const res = await generate({ name: 'Bench Press' })
    expect((await res.json()).libraryId).toBe('ex-bench')
    expect(generateObject).not.toHaveBeenCalled()
  })

  it('a non-admin refresh is refused before any model call', async () => {
    getUserById.mockResolvedValue({ id: 'u-3840', isActive: true, isAdmin: false })
    const res = await generate({ name: 'Bench Press', refresh: true })
    expect(res.status).toBe(403)
    expect(generateObject).not.toHaveBeenCalled()
  })

  it('an inactive admin refresh is refused', async () => {
    getUserById.mockResolvedValue({ id: 'u-3840', isActive: false, isAdmin: true })
    expect((await generate({ name: 'Bench Press', refresh: true })).status).toBe(403)
    expect(generateObject).not.toHaveBeenCalled()
  })

  it('refresh must be exactly true, and the schema stays strict', async () => {
    for (const bad of [{ name: 'Bench Press', refresh: false }, { name: 'Bench Press', refresh: 'yes' }, { name: 'Bench Press', refresh: true, extra: 1 }]) {
      expect((await generate(bad)).status).toBe(400)
    }
    expect(generateObject).not.toHaveBeenCalled()
  })

  it('a refresh is still rate limited', async () => {
    allowed = false
    expect((await generate({ name: 'Bench Press', refresh: true })).status).toBe(429)
    expect(getUserById).not.toHaveBeenCalled()
  })
})
