/**
 * PS-39 — the workout write path: `log-exercise`, `workout-sessions` (DELETE) and
 * `workout-sessions/day`.
 *
 * Batched because they are the app's core loop — a set is logged, a session is read back, a session
 * is removed — and one of them carries an incident whose fix is invisible from the response body:
 *
 *   · **An ownership refusal is not a server fault (Q-462).** `log-exercise` checks
 *     `isNotFoundError` FIRST, so a cross-user attempt neither answers 5xx to the offline sync path
 *     — which reads 5xx as "retry later" and 4xx as a poison pill to quarantine — nor writes a
 *     stack trace into `error_events`, the one fault signal nobody is watching. It logs a one-line
 *     warning instead, because dropping the log entirely would trade one problem for a blind spot.
 *   · **Deleting a session reconciles the personal records it touched**, or a PR set in a workout
 *     the user just deleted survives it.
 *   · **The day route routes its `date` param through `normalizeDateParam`** before anything reads
 *     it — a raw param reaching date arithmetic is a 500, and the client emits `YYYY/MM/DD`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NotFoundError } from '@trainingai/shared/errors'
import { todayInTz } from '@trainingai/shared/date-utils'

type Row = Record<string, unknown>

const logExerciseFromPayload = vi.fn(async (_u: string, _p: Row, _tz: string) => ({
  workoutSessionId: 'ws-1', exerciseLogId: 'el-1', estimated1rm: 120, target80: 96, isPR: true,
}) as Row)
const deleteWorkoutSession = vi.fn(async (_u: string, _id: string) =>
  ({ deleted: true, exerciseNames: ['Squat', 'Bench Press'] }) as Row)
const reconcilePersonalRecord = vi.fn(async (_u: string, _n: string) => undefined)
const getDaySessionSummaries = vi.fn(async (_u: string, _d: string, _tz: string) => [] as Row[])
const reportServerError = vi.fn()

let sessionUser: { id: string; timezone?: string } | null = { id: 'u-1', timezone: 'Australia/Brisbane' }
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))
vi.mock('@/lib/data', () => {
  // Built inside the returned function: `vi.mock` is hoisted above the consts above.
  const repo = async () => ({ reconcilePersonalRecord, getDaySessionSummaries })
  return { getRepository: repo, getRepositoryAsync: repo }
})
vi.mock('@trainingai/shared/workout/log-exercise', async (orig) => ({
  ...(await orig() as object),
  logExerciseFromPayload: (u: string, p: Row, tz: string) => logExerciseFromPayload(u, p, tz),
}))
vi.mock('@/lib/workout/delete-session', () => ({
  deleteWorkoutSession: (u: string, id: string) => deleteWorkoutSession(u, id),
}))
vi.mock('@/lib/observability', () => ({ reportServerError: (...a: unknown[]) => reportServerError(...a) }))

import { POST as logExercise } from '@/app/api/log-exercise/route'
import { DELETE as deleteSession } from '@/app/api/workout-sessions/route'
import { GET as daySessions } from '@/app/api/workout-sessions/day/route'

const WS = '00000000-0000-4000-8000-0000000000f1'

const payload = (over: Row = {}) => ({
  sessionName: 'Upper', exercise: 'Bench Press',
  weights: [60, 60, 60], sets: 3, reps: [8, 8, 6], ...over,
})

const send = (handler: (req: never) => Promise<Response>, url: string, method: string, body: unknown) =>
  handler(Object.assign(new Request(`http://localhost${url}`, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  }), { nextUrl: new URL(`http://localhost${url}`) }) as never)

const log = (body: unknown) => send(logExercise as never, '/api/log-exercise', 'POST', body)
const del = (body: unknown) => send(deleteSession as never, '/api/workout-sessions', 'DELETE', body)
const day = (query = '') =>
  daySessions(Object.assign(new Request(`http://localhost/api/workout-sessions/day${query}`), {
    nextUrl: new URL(`http://localhost/api/workout-sessions/day${query}`),
  }) as never)

let seq = 0
const freshUser = (over: { timezone?: string } = {}) => {
  sessionUser = { id: `u-${++seq}`, timezone: 'Australia/Brisbane', ...over }
}

beforeEach(() => {
  vi.clearAllMocks()
  freshUser()
  // `clearAllMocks` clears calls, not implementations — a rejection from one case would leak.
  logExerciseFromPayload.mockReset()
  logExerciseFromPayload.mockResolvedValue({
    workoutSessionId: 'ws-1', exerciseLogId: 'el-1', estimated1rm: 120, target80: 96, isPR: true,
  })
  deleteWorkoutSession.mockReset()
  deleteWorkoutSession.mockResolvedValue({ deleted: true, exerciseNames: ['Squat', 'Bench Press'] })
  getDaySessionSummaries.mockResolvedValue([])
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('POST /api/log-exercise', () => {
  it('refuses without a session', async () => {
    sessionUser = null
    expect((await log(payload())).status).toBe(401)
  })

  it('answers 400 to a malformed body, and names what failed', async () => {
    expect((await log('{not json')).status).toBe(400)

    const res = await log(payload({ sets: 99 }))
    expect(res.status).toBe(400)
    expect(await res.json()).toHaveProperty('details')
    expect(logExerciseFromPayload).not.toHaveBeenCalled()
  })

  it('bounds the arrays and the numbers', async () => {
    for (const bad of [
      { weights: [] }, { weights: [999] }, { reps: [] }, { reps: [101] },
      { exercise: '' }, { sessionName: '' }, { sets: 0 },
      { weights: new Array(21).fill(60) },
    ]) {
      expect((await log(payload(bad))).status).toBe(400)
    }
    expect(logExerciseFromPayload).not.toHaveBeenCalled()
  })

  it('refuses an oversized body', async () => {
    expect((await log(payload({ sessionName: 'x'.repeat(128 * 1024) }))).status).toBe(413)
  })

  it('rate-limits the thirty-first log in the minute', async () => {
    for (let i = 0; i < 30; i++) expect((await log(payload())).status).toBe(200)
    expect((await log(payload())).status).toBe(429)
  })

  it('echoes what was logged alongside what was computed', async () => {
    const body = await (await log(payload())).json()
    expect(body).toMatchObject({
      success: true, workoutSessionId: 'ws-1', exerciseLogId: 'el-1',
      exercise: 'Bench Press', weights: [60, 60, 60], sets: 3, reps: [8, 8, 6],
      estimated1rm: 120, target80: 96, isPR: true,
    })
    expect(logExerciseFromPayload.mock.calls[0][0]).toBe(sessionUser!.id)
  })

  it('passes the caller\'s timezone through, not the server one', async () => {
    freshUser({ timezone: 'America/New_York' })
    await log(payload())
    expect(logExerciseFromPayload.mock.calls[0][2]).toBe('America/New_York')
  })

  // Q-462. The sync path reads 5xx as "retry later" and 4xx as a poison pill to quarantine, and
  // `error_events` is the one fault signal nobody is watching — so a refusal must be neither.
  it('treats an ownership refusal as a refusal, not a server fault', async () => {
    logExerciseFromPayload.mockRejectedValue(new NotFoundError('Workout session'))
    const res = await log(payload({ workoutSessionId: WS }))

    expect(res.status).toBe(404)
    expect(res.status).toBeLessThan(500)          // never "retry later" to the sync path
    expect(reportServerError).not.toHaveBeenCalled()  // never a stack trace in error_events
    // Still visible in the server log: dropping it entirely would trade one problem for a blind spot.
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('refused'))
  })

  it('still reports a genuine fault as one', async () => {
    logExerciseFromPayload.mockRejectedValue(new Error('deadlock detected'))
    const res = await log(payload())
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Failed to log exercise' })
    expect(reportServerError).toHaveBeenCalledTimes(1)
    expect(reportServerError.mock.calls[0][1]).toMatchObject({ url: '/api/log-exercise' })
  })

  it('does not leak the driver message on a fault', async () => {
    logExerciseFromPayload.mockRejectedValue(new Error('column "user_id" does not exist'))
    expect(JSON.stringify(await (await log(payload())).json())).not.toContain('user_id')
  })
})

describe('DELETE /api/workout-sessions', () => {
  it('refuses without a session', async () => {
    sessionUser = null
    expect((await del({ workoutSessionId: WS })).status).toBe(401)
  })

  it('requires a uuid and nothing else', async () => {
    // Against a body that would otherwise succeed, so `.strict()` is what refuses it.
    for (const bad of [{}, { workoutSessionId: 'nope' }, { workoutSessionId: WS, userId: 'other' }]) {
      expect((await del(bad)).status).toBe(400)
    }
    expect((await del('{not json')).status).toBe(400)
    expect(deleteWorkoutSession).not.toHaveBeenCalled()
  })

  it('refuses an oversized body', async () => {
    expect((await del({ workoutSessionId: WS, pad: 'x'.repeat(8 * 1024) })).status).toBe(413)
  })

  it('404s a session that is not the caller\'s, without reconciling anything', async () => {
    deleteWorkoutSession.mockResolvedValue({ deleted: false, exerciseNames: [] })
    expect((await del({ workoutSessionId: WS })).status).toBe(404)
    expect(reconcilePersonalRecord).not.toHaveBeenCalled()
  })

  // Otherwise a PR set in the workout the user just deleted survives it.
  it('reconciles the personal record of every exercise the deleted session touched', async () => {
    const res = await del({ workoutSessionId: WS })
    expect(res.status).toBe(200)
    expect(deleteWorkoutSession).toHaveBeenCalledWith(sessionUser!.id, WS)
    expect(reconcilePersonalRecord.mock.calls.map(c => c[1])).toEqual(['Squat', 'Bench Press'])
    expect(reconcilePersonalRecord.mock.calls.every(c => c[0] === sessionUser!.id)).toBe(true)
  })

  it('reports a failed delete as a fault without leaking the driver message', async () => {
    deleteWorkoutSession.mockRejectedValue(new Error('relation "set_logs" does not exist'))
    const res = await del({ workoutSessionId: WS })
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Delete failed' })
    expect(reportServerError).toHaveBeenCalledTimes(1)
  })
})

describe('GET /api/workout-sessions/day', () => {
  it('refuses without a session', async () => {
    sessionUser = null
    expect((await day()).status).toBe(401)
  })

  // A raw date param reaching date arithmetic is a 500; the client emits YYYY/MM/DD.
  it('accepts either separator and answers in dashes', async () => {
    for (const q of ['?date=2026-09-01', '?date=2026/09/01']) {
      getDaySessionSummaries.mockClear()
      const body = await (await day(q)).json()
      expect(getDaySessionSummaries.mock.calls[0][1]).toBe('2026/09/01')
      expect(body.date).toBe('2026-09-01')
    }
  })

  it('400s a date it cannot normalise, rather than 500ing on the arithmetic', async () => {
    for (const q of ['?date=01/09/2026', '?date=not-a-date', '?date=2026-13-45x']) {
      const res = await day(q)
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'Invalid date' })
    }
    expect(getDaySessionSummaries).not.toHaveBeenCalled()
  })

  it('defaults to today in the caller\'s timezone, not the server\'s', async () => {
    const dayFor = async (timezone: string) => {
      freshUser({ timezone }); getDaySessionSummaries.mockClear()
      const body = await (await day()).json()
      return { asked: getDaySessionSummaries.mock.calls[0][1], tz: getDaySessionSummaries.mock.calls[0][2], date: body.date }
    }
    // Two fixed-offset zones 26 hours apart always disagree about what day it is.
    const ahead = await dayFor('Etc/GMT-14')
    const behind = await dayFor('Etc/GMT+12')
    expect(ahead.date).not.toBe(behind.date)
    expect(ahead.date).toBe(todayInTz('Etc/GMT-14'))
    expect(ahead.asked).toBe(todayInTz('Etc/GMT-14').replace(/-/g, '/'))
    expect(ahead.tz).toBe('Etc/GMT-14')
  })

  it('serialises each session, keeping an unfinished one unfinished', async () => {
    const started = new Date('2026-09-01T06:00:00Z')
    const done = new Date('2026-09-01T07:15:00Z')
    getDaySessionSummaries.mockResolvedValue([
      { sessionId: 's1', sessionName: 'Upper', startedAt: started, completedAt: done },
      { sessionId: null, sessionName: 'Ad-hoc', startedAt: started, completedAt: null },
    ])
    const body = await (await day('?date=2026-09-01')).json()
    expect(body.sessions).toEqual([
      { sessionId: 's1', sessionName: 'Upper', startedAt: started.toISOString(), completedAt: done.toISOString() },
      { sessionId: null, sessionName: 'Ad-hoc', startedAt: started.toISOString(), completedAt: null },
    ])
  })

  it('answers no-store, because this app manages its own freshness', async () => {
    expect((await day()).headers.get('Cache-Control')).toBe('private, no-store')
  })
})
