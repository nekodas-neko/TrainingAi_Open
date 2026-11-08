// #3673 item 1: `error_events` stored a Drizzle query error's message and stack verbatim, and
// Drizzle writes the bound parameters into both (`Failed query: <sql>\nparams: <values>`). On a
// failed password change that was the password hash; on a failed push, the food, weight or sleep
// values. Every agent reads that table. The Sentry path already dropped them.
//
// End-to-end against the real table for both writers, so the bar is what lands in the column.
// Runs only against a real local dev Postgres — skips cleanly in CI's "Tests" job.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { DrizzleQueryError } from 'drizzle-orm/errors'
import { scrubBoundParams, scrubBoundParamsInStack } from '../scrub-params'

const canRun = !!process.env.DATABASE_URL
const HASH = '$2b$12$abcdefghijklmnopqrstuv'
const VALUES = [HASH, '00000000-0000-4000-8000-00000000abcd', 81.37, 'Rolled oats, 2 cups']

function passwordUpdateError(): Error {
  return new DrizzleQueryError(
    'update "users" set "password_hash" = $1 where "users"."id" = $2 returning $3, $4',
    VALUES,
    Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014', severity: 'ERROR' }),
  )
}

function expectNoValues(text: string | null | undefined) {
  expect(text).toBeTruthy()
  for (const v of VALUES) expect(text!, String(v)).not.toContain(String(v))
}

describe('scrubBoundParams / scrubBoundParamsInStack', () => {
  it('drops the params line from a message and keeps the SQL', () => {
    const out = scrubBoundParams(passwordUpdateError().message)
    expect(out).toContain('Failed query: update "users" set "password_hash" = $1')
    expect(out.endsWith('params: [scrubbed]')).toBe(true)
    expectNoValues(out)
  })

  it('drops the params from a stack and keeps the frames', () => {
    const err = passwordUpdateError()
    const out = scrubBoundParamsInStack(err.stack!)
    expectNoValues(out)
    expect(out).toContain('params: [scrubbed]')
    expect(out).toMatch(/\n\s+at /)
  })

  it('cuts a params value that itself contains a newline', () => {
    const err = new DrizzleQueryError('insert into "food_logs" values ($1)', ['line one\nsecret line two'], undefined)
    expect(scrubBoundParams(err.message)).not.toContain('secret')
    expect(scrubBoundParamsInStack(err.stack!)).not.toContain('secret')
  })

  it('leaves a message without params alone', () => {
    expect(scrubBoundParams('Cannot read properties of undefined')).toBe('Cannot read properties of undefined')
  })
})

describe.skipIf(!canRun)('no bound parameter reaches error_events (#3673)', () => {
  let pool: import('pg').Pool
  const URL_PREFIX = '/api/__3673'

  const rowFor = async (url: string) =>
    (await pool.query(`SELECT message, stack FROM error_events WHERE url = $1 ORDER BY created_at DESC LIMIT 1`, [url]))
      .rows[0] as { message: string; stack: string | null } | undefined

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    await pool.query(`DELETE FROM error_events WHERE url LIKE $1`, [`%${URL_PREFIX}%`])
  })
  beforeEach(async () => { (await import('../request-error')).resetRequestErrorDedupe() })
  afterAll(async () => { if (canRun) await pool.query(`DELETE FROM error_events WHERE url LIKE $1`, [`%${URL_PREFIX}%`]) })

  it('onRequestError (the routes with no catch, such as PATCH /api/user/password)', async () => {
    const { recordRequestError } = await import('../request-error')
    await recordRequestError(passwordUpdateError(), { path: `${URL_PREFIX}-request`, method: 'PATCH' })
    const row = await rowFor(`PATCH ${URL_PREFIX}-request`)
    expect(row).toBeDefined()
    expectNoValues(row!.message)
    expectNoValues(row!.stack)
    expect(row!.message).toContain('[pg 57014]')
    expect(row!.message).toContain('Failed query: update "users"')
  })

  it('reportServerError, including a message that quotes a failed push error', async () => {
    const { reportServerError, flushPendingReports } = await import('@/lib/observability')
    reportServerError(passwordUpdateError(), { url: `${URL_PREFIX}-server` })
    // The sync push route's shape: `first: ${retryable[0].error}` inside its own message.
    reportServerError(new Error(`sync/push: 1 of 1 mutation(s) failed — first: ${String(passwordUpdateError())}`), { url: `${URL_PREFIX}-push` })
    await flushPendingReports()
    for (const url of [`${URL_PREFIX}-server`, `${URL_PREFIX}-push`]) {
      const row = await rowFor(url)
      expect(row, url).toBeDefined()
      expectNoValues(row!.message)
      expectNoValues(row!.stack)
    }
  })
})
