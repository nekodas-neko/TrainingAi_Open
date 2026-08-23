// Q-483: the route's catch returned `errorLog(error, …)` as the JSON body. `errorLog` builds
// `[ERROR]: ${error}`, and for a Drizzle failure that string is the whole failing statement — so a
// malformed id published every column of `workout_sessions` to the client:
//
//   GET /api/workout-sessions/not-a-uuid/recap → 500
//   {"error":"[ERROR]: Error: Failed query: select \"id\", \"user_id\", \"session_id\", …
//
// The control (a valid-but-missing UUID) returns a clean 404, so this was specific to the malformed
// id reaching the driver as 22P02.
//
// **Q-482 then removed the trigger.** A malformed id is now rejected by `invalidUuidResponse` before
// the repository is called at all, so `not-a-uuid` answers **400** and never reaches Drizzle. Both
// halves are still worth testing and they test different things: the guard proves the driver is not
// reached, and the redaction proves that when something else DOES throw — which is the case the
// guard cannot cover — the statement still does not reach the client. Deleting the second because
// the first exists would drop the only test of the redaction.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { getWorkoutSessionDetail, reportServerError } = vi.hoisted(() => ({
  getWorkoutSessionDetail: vi.fn(),
  reportServerError: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: async () => ({ user: { id: 'u1', timezone: 'Australia/Brisbane' } }) }))
vi.mock('@/lib/data', () => ({ getRepository: async () => ({ getWorkoutSessionDetail }) }))
vi.mock('@/lib/observability', () => ({ reportServerError }))

import { GET } from '../route'

const VALID_ID = '11111111-2222-4333-8444-555555555555'

const call = (id: string) =>
  GET(new Request(`http://localhost/api/workout-sessions/${id}/recap`) as never,
      { params: Promise.resolve({ id }) } as never)

// The Drizzle shape the route used to publish: a message that IS the failing statement.
const failingQuery = () => Object.assign(
  new Error('Failed query: select "id", "user_id", "session_id", "session_name", "started_at" from "workout_sessions"'),
  { cause: Object.assign(new Error('invalid input syntax for type uuid: "not-a-uuid"'), { code: '22P02' }) },
)

beforeEach(() => { getWorkoutSessionDetail.mockReset(); reportServerError.mockReset() })

describe('GET /api/workout-sessions/[id]/recap — malformed id (Q-482)', () => {
  it('answers 400 without calling the repository at all', async () => {
    const res = await call('not-a-uuid')

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid id' })
    // The point of the guard: the driver is never reached, so there is no 22P02 to redact.
    expect(getWorkoutSessionDetail).not.toHaveBeenCalled()
    expect(reportServerError).not.toHaveBeenCalled()
  })
})

describe('GET /api/workout-sessions/[id]/recap — error body (Q-483)', () => {
  it('does not put the failing SQL in the response when the driver rejects a well-formed id', async () => {
    // A well-formed id, so it passes the Q-482 guard and reaches the repository — which is the only
    // way a driver error can still happen on this route.
    getWorkoutSessionDetail.mockRejectedValue(failingQuery())

    const res = await call(VALID_ID)
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

    await call(VALID_ID)

    expect(reportServerError).toHaveBeenCalledTimes(1)
    expect(String((reportServerError.mock.calls[0][0] as Error).message)).toContain('Failed query')
  })
})
