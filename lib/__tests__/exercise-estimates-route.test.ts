/**
 * PS-39 — `exercise-estimates`, the strength-side route that goes through the repository rather
 * than raw SQL. Its SQL-shaped siblings (`strength-trend`, `muscle-tonnage-trend`) are covered
 * against real rows in `lib/data/postgres/__tests__/trend-sql-routes.test.ts`, because everything
 * those two own lives inside a hand-written query. This one owns its logic in TypeScript.
 *
 * `workout-load-history` was the other half of this file until LB-24 deleted the route: its only
 * renderer went with Q-112a's day-review sheet, and the trends phase re-homed neither.
 *
 *   · **A typed starting 1RM is not an earned record** (Q-5). These land in `exercise_estimates`;
 *     writing them to `personal_records` conflated an estimate with an achievement and overwrote
 *     real PRs every time a program was reviewed.
 *
 * One thing deliberately not pinned: `exerciseName.trim()` in the estimates route is a second trim
 * over a value `z.string().trim()` has already trimmed, so removing it changes no response. The
 * schema's is the load-bearing one, and a test could only claim the redundant one exists.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const upsertExerciseEstimate = vi.fn(async (..._a: unknown[]) => undefined)

let sessionUser: { id: string; timezone?: string } | null = { id: 'u-1', timezone: 'Australia/Brisbane' }
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))
vi.mock('@/lib/data', () => {
  // Built inside the factory: `vi.mock` is hoisted above the consts above.
  const repo = async () => ({ upsertExerciseEstimate })
  return { getRepository: repo, getRepositoryAsync: repo }
})

import { POST as postEstimates } from '@/app/api/exercise-estimates/route'

const estimates = (body: unknown) =>
  postEstimates(new Request('http://localhost/api/exercise-estimates', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }))

let seq = 0
const freshUser = () => {
  sessionUser = { id: `u-${++seq}`, timezone: 'Australia/Brisbane' }
}

beforeEach(() => {
  vi.clearAllMocks()
  freshUser()
})

describe('/api/exercise-estimates', () => {
  const body = (entries: unknown) => ({ entries })

  it('refuses without a session', async () => {
    sessionUser = null
    expect((await estimates(body([{ exerciseName: 'Press', estimated1rm: 100 }]))).status).toBe(401)
  })

  // Q-5: these are typed guesses, and writing them to `personal_records` overwrote earned records
  // every time a program was reviewed. They land in their own table.
  it('writes each entry to the estimates store under the caller', async () => {
    await estimates(body([
      { exerciseName: '  Press  ', estimated1rm: 100 },
      { exerciseName: 'Row', estimated1rm: 80.5 },
    ]))
    expect(upsertExerciseEstimate).toHaveBeenCalledWith(sessionUser!.id, 'Press', 100)
    expect(upsertExerciseEstimate).toHaveBeenCalledWith(sessionUser!.id, 'Row', 80.5)
  })

  it('accepts an empty list without writing anything', async () => {
    const res = await estimates(body([]))
    expect(res.status).toBe(200)
    expect(upsertExerciseEstimate).not.toHaveBeenCalled()
  })

  it('bounds the name, the number and the list', async () => {
    for (const bad of [
      [{ exerciseName: '', estimated1rm: 100 }],
      [{ exerciseName: '   ', estimated1rm: 100 }],
      [{ exerciseName: 'x'.repeat(201), estimated1rm: 100 }],
      [{ exerciseName: 'Press', estimated1rm: 0 }],
      [{ exerciseName: 'Press', estimated1rm: -5 }],
      [{ exerciseName: 'Press', estimated1rm: 1001 }],
      [{ exerciseName: 'Press', estimated1rm: Number.POSITIVE_INFINITY }],
      [{ exerciseName: 'Press', estimated1rm: 100, userId: 'someone-else' }],
      new Array(401).fill({ exerciseName: 'Press', estimated1rm: 100 }),
      'not-a-list',
    ]) {
      expect((await estimates(body(bad))).status).toBe(400)
    }
    expect((await estimates({ userId: 'someone-else', entries: [] })).status).toBe(400)
    expect(upsertExerciseEstimate).not.toHaveBeenCalled()
  })

  it('refuses an oversized body before the schema sees it', async () => {
    const res = await estimates({ entries: [], pad: 'y'.repeat(300 * 1024) })
    expect(res.status).toBe(413)   // 413, not the 400 an unknown key would earn
    expect(upsertExerciseEstimate).not.toHaveBeenCalled()
  })
})
