// #3673 follow-up: the first fix scrubbed an error's own message and stack, but three paths still
// carried a Drizzle error's `params:` tail into text that is stored or answered:
//   1. an error whose `cause` is a Drizzle error (summariseCause copied the cause message into the
//      prefix and the block of the stored row);
//   2. the repository's `insertErrorEvent`, the sink every other caller shares;
//   3. the retention-prune writer and the stress-backfill job row.
// Every value below is obviously fake.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { DrizzleQueryError } from 'drizzle-orm/errors'
import { summariseCause } from '../pg-cause'
import { safeErrorText, scrubErrorText, scrubErrorStack } from '../scrub-params'

const canRun = !!process.env.DATABASE_URL
const FAKE_HASH = '$2b$12$FAKEFAKEFAKEFAKEFAKEfa'
const FAKE_HEALTH = 'FAKE-FOOD-Oats 81.37kg'
const VALUES = [FAKE_HASH, FAKE_HEALTH, '00000000-0000-4000-8000-00000000fa4e']

const pgError = () =>
  Object.assign(new Error('duplicate key value violates unique constraint "users_email_key"'), {
    code: '23505', severity: 'ERROR', constraint: 'users_email_key', table: 'users',
    detail: `Key (email)=(${FAKE_HEALTH}) already exists.`,
  })
const drizzleError = () =>
  new DrizzleQueryError('update "users" set "password_hash" = $1, "note" = $2 where "id" = $3', VALUES, pgError())
const wrapped = () => new Error('could not save the profile', { cause: drizzleError() })
const wrappedNoPgCause = () =>
  new Error('could not save the profile', {
    cause: new DrizzleQueryError('update "users" set "password_hash" = $1, "note" = $2 where "id" = $3', VALUES, new Error('connection terminated')),
  })

function expectNoValues(text: string | null | undefined) {
  expect(text).toBeTruthy()
  for (const v of [...VALUES, FAKE_HASH.slice(0, 12)]) expect(text!, v).not.toContain(v)
}

describe('summariseCause on an error whose cause is a Drizzle error', () => {
  it('keeps the pg code and constraint and no value', () => {
    const { prefix, block } = summariseCause(wrapped())
    expectNoValues(prefix + (block ?? ''))
    expect(prefix).toContain('[pg 23505]')
    expect(block).toContain('constraint: users_email_key')
  })
  it('drops the params when the Drizzle error has no pg error under it', () => {
    const { prefix, block } = summariseCause(wrappedNoPgCause())
    expectNoValues(prefix + (block ?? ''))
    expect(block).toContain('Failed query: update "users"')
  })
})

describe('safeErrorText / scrubErrorText / scrubErrorStack', () => {
  it('never returns a Drizzle error\'s values, from the error or from its stringified form', () => {
    expectNoValues(safeErrorText(drizzleError()))
    expectNoValues(scrubErrorText(String(drizzleError())))
    expectNoValues(scrubErrorStack(String(drizzleError().stack)))
    expect(safeErrorText(drizzleError())).toContain('Failed query: update "users"')
  })
  it('keeps an unrelated error as it was', () => {
    expect(safeErrorText(new Error('Image generation failed: quota'))).toBe('Image generation failed: quota')
    expect(safeErrorText('plain')).toBe('plain')
  })
})

describe.skipIf(!canRun)('the shared sinks write no value (#3673)', () => {
  let pool: import('pg').Pool
  const TAG = '/api/__chaincause'
  const rowFor = async (url: string) =>
    (await pool.query(`SELECT message, stack FROM error_events WHERE url = $1 ORDER BY created_at DESC LIMIT 1`, [url])).rows[0] as { message: string; stack: string | null } | undefined

  beforeAll(async () => {
    pool = (await import('@/lib/data/postgres/client')).getPool()
    await pool.query(`DELETE FROM error_events WHERE url LIKE $1`, [`%${TAG}%`])
  })
  beforeEach(async () => { (await import('../request-error')).resetRequestErrorDedupe() })
  afterAll(async () => { if (canRun) await pool.query(`DELETE FROM error_events WHERE url LIKE $1 OR url = 'prune:__3673b'`, [`%${TAG}%`]) })

  it('reportServerError and onRequestError, for a Drizzle error on `cause`', async () => {
    const { reportServerError, flushPendingReports } = await import('@/lib/observability')
    const { recordRequestError } = await import('../request-error')
    reportServerError(wrapped(), { url: `${TAG}-server` })
    reportServerError(wrappedNoPgCause(), { url: `${TAG}-server2` })
    await flushPendingReports()
    await recordRequestError(wrapped(), { path: `${TAG}-request`, method: 'PATCH' })
    for (const url of [`${TAG}-server`, `${TAG}-server2`, `PATCH ${TAG}-request`]) {
      const row = await rowFor(url)
      expect(row, url).toBeDefined()
      expectNoValues(row!.message)
      expectNoValues(row!.stack)
    }
  })

  it('insertErrorEvent, whichever caller built the message', async () => {
    const { getRepositoryAsync } = await import('@/lib/data')
    const repo = await getRepositoryAsync()
    const bad = drizzleError()
    await repo.insertErrorEvent({ userId: null, source: 'server', message: `[job] failed: ${String(bad)}`, stack: String(bad.stack), url: `${TAG}-sink` })
    const row = await rowFor(`${TAG}-sink`)
    expect(row).toBeDefined()
    expectNoValues(row!.message)
    expectNoValues(row!.stack)
  })

  it('the retention-prune failure writer', async () => {
    const { recordPruneFailure } = await import('@/lib/data/postgres/slices/oura')
    const { getDb } = await import('@/lib/data/postgres/client')
    recordPruneFailure(getDb(), `__3673b`, drizzleError())
    const { flushPendingWrites } = await import('../pending-writes')
    await flushPendingWrites()
    const row = await rowFor('prune:__3673b')
    expect(row).toBeDefined()
    expectNoValues(row!.message)
    expectNoValues(row!.stack)
  })
})
