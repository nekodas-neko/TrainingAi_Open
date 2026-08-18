// Q-483: the route's catch returned `errorLog(error, …)` as the JSON body. `errorLog` builds
// `[ERROR]: ${error}`, and for a Drizzle failure that string is the whole failing statement — so a
// malformed id published every column of `workout_sessions` to the client:
//
//   GET /api/workout-sessions/not-a-uuid/recap → 500
//   {"error":"[ERROR]: Error: Failed query: select \"id\", \"user_id\", \"session_id\", …
//
// The control (a valid-but-missing UUID) returns a clean 404, so this was specific to the malformed
// id reaching the driver as 22P02.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { getWorkoutSessionDetail, reportServerError } = vi.hoisted(() => ({
  getWorkoutSessionDetail: vi.fn(),
  reportServerError: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: async () => ({ user: { id: 'u1', timezone: 'Australia/Brisbane' } }) }))
vi.mock('@/lib/data', () => ({ getRepository: async () => ({ getWorkoutSessionDetail }) }))
vi.mock('@/lib/observability', () => ({ reportServerError }))

import { GET } from '../route'

const call = (id: string) =>
  GET(new Request(`http://localhost/api/workout-sessions/${id}/recap`) as never,
      { params: Promise.resolve({ id }) } as never)

beforeEach(() => { getWorkoutSessionDetail.mockReset(); reportServerError.mockReset() })

describe('GET /api/workout-sessions/[id]/recap — error body', () => {
  it('does not put the failing SQL in the response when the driver rejects the id', async () => {
    // The real shape: Postgres 22P02 wrapped by Drizzle, whose message is the whole statement.
    getWorkoutSessionDetail.mockRejectedValue(Object.assign(
      new Error('Failed query: select "id", "user_id", "session_id", "session_name", "started_at" from "workout_sessions"'),
      { cause: Object.assign(new Error('invalid input syntax for type uuid: "not-a-uuid"'), { code: '22P02' }) },
    ))

    const res = await call('not-a-uuid')
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.error).toBe('Internal error')
    // The specific disclosure, named rather than implied.
    expect(JSON.stringify(body)).not.toContain('Failed query')
    expect(JSON.stringify(body)).not.toContain('user_id')
    expect(JSON.stringify(body)).not.toContain('workout_sessions')
  })

  it('still reports the full error server-side, so redacting costs no diagnostics', async () => {
    getWorkoutSessionDetail.mockRejectedValue(new Error('Failed query: select "id" from "workout_sessions"'))

    await call('not-a-uuid')

    expect(reportServerError).toHaveBeenCalledTimes(1)
    expect(String((reportServerError.mock.calls[0][0] as Error).message)).toContain('Failed query')
  })
})
