// #3751: typing an exercise the library already has costs no model call; when the model is called,
// the name's prefix equipment is listed first by code. Mocks only.
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>
const listExerciseLibrary = vi.fn(async () => [] as Row[])
const generateObject = vi.fn(async (..._a: unknown[]) => ({ object: {} }) as Row)

vi.mock('@/auth', () => ({ auth: async () => ({ user: { id: 'u-3751' } }) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))
vi.mock('@/lib/observability', () => ({ reportServerError: () => undefined }))
vi.mock('ai', () => ({ generateObject: (...a: unknown[]) => generateObject(...a) }))
vi.mock('@/lib/ai/instrument', () => ({
  aiModel: () => 'test-model',
  loggedGenerateObject: (_meta: unknown, run: () => Promise<unknown>) => run(),
}))
vi.mock('@/lib/data', () => ({ getRepository: async () => ({ listExerciseLibrary }) }))

import { POST } from '@/app/api/exercises/generate/route'

const generate = (name: string) =>
  POST(new Request('http://localhost/api/exercises/generate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
  }) as never)

const BENCH = {
  id: 'ex-bench', name: 'Bench Press', instructions: 'Lie on the bench.',
  muscles: [{ muscle: 'Chest', role: 'main' }], equipment: ['barbell'], exerciseType: 'weighted',
}

beforeEach(() => {
  vi.clearAllMocks()
  listExerciseLibrary.mockResolvedValue([BENCH])
})

describe('/api/exercises/generate looks in the library first', () => {
  it('returns the library exercise for a name it holds, with no model call', async () => {
    const res = await generate('bench press')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      normalizedName: 'Bench Press',
      instructions: 'Lie on the bench.',
      muscles: [{ muscle: 'Chest', role: 'main' }],
      equipment: ['barbell'],
      libraryId: 'ex-bench',
    })
    expect(generateObject).toHaveBeenCalledTimes(0)
  })

  it('does not offer a merged duplicate as the existing exercise', async () => {
    listExerciseLibrary.mockResolvedValue([{ ...BENCH, mergedInto: 'ex-other' }])
    generateObject.mockResolvedValue({ object: {
      normalizedName: 'Barbell Bench Press', instructions: '…',
      muscles: [{ muscle: 'Chest', role: 'main' }], equipment: ['barbell'],
    } })
    await generate('Bench Press')
    expect(generateObject).toHaveBeenCalledTimes(1)
  })

  it('a name the library does not hold goes to the model, and the prefix equipment is listed first', async () => {
    generateObject.mockResolvedValue({ object: {
      normalizedName: 'Kettlebell Goblet Squat', instructions: '…',
      muscles: [{ muscle: 'Quads', role: 'main' }], equipment: ['dumbbell', 'kettlebell'],
    } })
    const res = await generate('goblet squat')
    expect(generateObject).toHaveBeenCalledTimes(1)
    expect((await res.json()).equipment).toEqual(['kettlebell', 'dumbbell'])
  })
})
