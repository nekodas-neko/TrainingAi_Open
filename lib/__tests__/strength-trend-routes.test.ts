/**
 * PS-39 — `workout-load-history` and `exercise-estimates`, the two strength-side routes that go
 * through the repository rather than raw SQL.
 *
 * Their SQL-shaped siblings (`strength-trend`, `muscle-tonnage-trend`) are covered against real rows
 * in `lib/data/postgres/__tests__/trend-sql-routes.test.ts`, because everything those two own lives
 * inside a hand-written query. These two own their logic in TypeScript, so it is testable here.
 *
 *   · **Match by the program session's stable id, fall back to its name.** A name match breaks the
 *     moment a session is renamed — session identity is the DB id (CLAUDE.md), and the name path
 *     exists only for callers that do not have an id yet.
 *   · **The window is anchored at a local midnight**, not `Date.now() − N × 86_400_000`, which
 *     starts mid-day in the user's timezone and straddles two local days at its far edge.
 *   · **A typed starting 1RM is not an earned record** (Q-5). These land in `exercise_estimates`;
 *     writing them to `personal_records` conflated an estimate with an achievement and overwrote
 *     real PRs every time a program was reviewed.
 *   · **Only the last five comparable sessions**, and only the most recent one is "today".
 *
 * One thing deliberately not pinned: `exerciseName.trim()` in the estimates route is a second trim
 * over a value `z.string().trim()` has already trimmed, so removing it changes no response. The
 * schema's is the load-bearing one, and a test could only claim the redundant one exists.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>

const getWorkoutSessionsFrom = vi.fn(async (..._a: unknown[]) => [] as Row[])
const upsertExerciseEstimate = vi.fn(async (..._a: unknown[]) => undefined)

let sessionUser: { id: string; timezone?: string } | null = { id: 'u-1', timezone: 'Australia/Brisbane' }
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))
vi.mock('@/lib/data', () => {
  // Built inside the factory: `vi.mock` is hoisted above the consts above.
  const repo = async () => ({ getWorkoutSessionsFrom, upsertExerciseEstimate })
  return { getRepository: repo, getRepositoryAsync: repo }
})

import { GET as getLoadHistory } from '@/app/api/workout-load-history/route'
import { POST as postEstimates } from '@/app/api/exercise-estimates/route'

const SESSION_ID = '00000000-0000-4000-8000-0000000000f6'

const workout = (over: Row = {}) => ({
  id: 'ws-1', sessionId: SESSION_ID, sessionName: 'Upper',
  startedAt: new Date('2026-09-01T02:00:00Z'), completedAt: null,
  exercises: [{ exerciseName: 'Press', volume: 1000 }], ...over,
})

const loadHistory = (query: string) =>
  getLoadHistory(new Request(`http://localhost/api/workout-load-history${query}`))

const estimates = (body: unknown) =>
  postEstimates(new Request('http://localhost/api/exercise-estimates', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }))

let seq = 0
const freshUser = (over: { timezone?: string } = {}) => {
  sessionUser = { id: `u-${++seq}`, timezone: 'Australia/Brisbane', ...over }
}

beforeEach(() => {
  vi.clearAllMocks()
  freshUser()
  getWorkoutSessionsFrom.mockResolvedValue([])
})

describe('/api/workout-load-history', () => {
  it('refuses without a session', async () => {
    sessionUser = null
    expect((await loadHistory(`?sessionId=${SESSION_ID}`)).status).toBe(401)
  })

  it('needs something to compare, and says which', async () => {
    const res = await loadHistory('')
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('sessionId or sessionName')
    expect(getWorkoutSessionsFrom).not.toHaveBeenCalled()
  })

  // Session identity is the DB id. A name match breaks the moment the session is renamed, taking
  // the history with it — which is the whole point of preferring the id.
  it('matches on the stable id, ignoring what the session was called', async () => {
    getWorkoutSessionsFrom.mockResolvedValue([
      workout({ id: 'a', sessionName: 'Upper', startedAt: new Date('2026-09-01T02:00:00Z') }),
      workout({ id: 'b', sessionName: 'Upper Body (renamed)', startedAt: new Date('2026-09-03T02:00:00Z') }),
      workout({ id: 'c', sessionId: 'other-session', sessionName: 'Upper', startedAt: new Date('2026-09-02T02:00:00Z') }),
    ])
    const body = await (await loadHistory(`?sessionId=${SESSION_ID}`)).json()
    expect(body).toHaveLength(2)
    expect(body.map((e: Row) => e.date)).toEqual(['2026-09-01', '2026-09-03'])
  })

  it('falls back to the name for a caller with no id', async () => {
    getWorkoutSessionsFrom.mockResolvedValue([
      workout({ id: 'a', sessionId: 'x', sessionName: 'Upper' }),
      workout({ id: 'b', sessionId: 'y', sessionName: 'Lower' }),
    ])
    const body = await (await loadHistory('?sessionName=Upper')).json()
    expect(body).toHaveLength(1)
  })

  it('skips a session with nothing logged', async () => {
    getWorkoutSessionsFrom.mockResolvedValue([
      workout({ id: 'a' }),
      workout({ id: 'b', exercises: [], startedAt: new Date('2026-09-02T02:00:00Z') }),
    ])
    expect(await (await loadHistory(`?sessionId=${SESSION_ID}`)).json()).toHaveLength(1)
  })

  // Five, oldest first, and only the newest is today's — the chart draws the current session
  // against its own recent history.
  it('keeps the five most recent and marks only the last as today', async () => {
    // Shuffled on purpose: the repository's order is not the chart's, and a fixture already in
    // ascending order cannot tell whether the route sorts or merely slices.
    const order = [3, 7, 1, 5, 0, 6, 2, 4]
    getWorkoutSessionsFrom.mockResolvedValue(
      order.map(i => workout({ id: `w${i}`, startedAt: new Date(`2026-09-0${i + 1}T02:00:00Z`) })),
    )
    const body = await (await loadHistory(`?sessionId=${SESSION_ID}`)).json()
    expect(body).toHaveLength(5)
    expect(body.map((e: Row) => e.date)).toEqual(['2026-09-04', '2026-09-05', '2026-09-06', '2026-09-07', '2026-09-08'])
    expect(body.filter((e: Row) => e.isToday)).toHaveLength(1)
    expect(body[4].isToday).toBe(true)
  })

  it('sums the volume and reports a duration only when the session was completed', async () => {
    const startedAt = new Date('2026-09-01T02:00:00Z')
    getWorkoutSessionsFrom.mockResolvedValue([
      workout({ id: 'a', startedAt, exercises: [{ volume: 1000.4 }, { volume: 500.1 }] }),
      workout({ id: 'b', startedAt: new Date('2026-09-02T02:00:00Z'),
        completedAt: new Date('2026-09-02T03:00:00Z') }),
    ])
    const body = await (await loadHistory(`?sessionId=${SESSION_ID}`)).json()
    expect(body[0]).toMatchObject({ volumeKg: 1501, durationMin: null })
    expect(body[1].durationMin).toBe(60)
  })

  // The banned `Date.now() − N × 86_400_000` starts mid-day in the user's zone; this must be a
  // local midnight, and it must be the CALLER's.
  it('anchors ninety days at the caller\'s local midnight', async () => {
    const fromFor = async (timezone: string) => {
      getWorkoutSessionsFrom.mockClear()
      freshUser({ timezone })
      await loadHistory(`?sessionId=${SESSION_ID}`)
      return getWorkoutSessionsFrom.mock.calls[0][1] as Date
    }
    const ahead = await fromFor('Etc/GMT-14')
    const behind = await fromFor('Etc/GMT+12')
    expect(ahead.getTime()).not.toBe(behind.getTime())

    // Midnight in that zone, so a whole number of hours off UTC with no minutes or seconds.
    for (const d of [ahead, behind]) {
      expect(d.getUTCMinutes()).toBe(0)
      expect(d.getUTCSeconds()).toBe(0)
    }
  })

  it('answers no-store', async () => {
    expect((await loadHistory(`?sessionId=${SESSION_ID}`)).headers.get('Cache-Control')).toBe('private, no-store')
  })
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
