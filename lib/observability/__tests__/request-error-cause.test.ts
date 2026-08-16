// Q-142: `onRequestError` — the path covering the 80 route files with no `catch` of their own —
// used to record a `DrizzleQueryError`'s own message and nothing else. That message is only
// `Failed query: <sql>`; the Postgres error saying *why* sits on `cause`. #1150 fixed the sibling
// path (`reportServerError`); this proves the fix reaches the DB on this one too.
//
// End-to-end against the real table on purpose, per CLAUDE.md: a wrong field name reads as
// `undefined` and fails silently, so the bar is a non-null value landing in the column.
//
// Runs only against a real local dev Postgres — skips cleanly in CI (no DATABASE_URL).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { recordRequestError, resetRequestErrorDedupe } from '@/lib/observability/request-error'

const canRun = !!process.env.DATABASE_URL

/** Shaped like what Drizzle throws: wrapper message, real pg error on `cause`. */
function drizzleError(cause: unknown): Error {
  const err = new Error('Failed query: select "id" from "mood_logs" where "user_id" = $1')
  ;(err as Error & { cause?: unknown }).cause = cause
  return err
}

describe.skipIf(!canRun)('recordRequestError captures the Postgres cause', () => {
  let pool: import('pg').Pool

  const rowFor = async (path: string) => {
    const { rows } = await pool.query(
      `SELECT message, stack FROM error_events WHERE url = $1 ORDER BY created_at DESC LIMIT 1`,
      [path],
    )
    return rows[0] as { message: string; stack: string | null } | undefined
  }

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    await pool.query(`DELETE FROM error_events WHERE url LIKE 'GET /api/__q142%'`)
  })

  beforeEach(() => resetRequestErrorDedupe())

  afterAll(async () => {
    await pool.query(`DELETE FROM error_events WHERE url LIKE 'GET /api/__q142%'`)
  })

  it('puts the pg code in the message prefix, where a left(message,120) read can see it', async () => {
    // The prefix placement is the whole point: the standing session-start query groups by
    // left(message,120), and a `Failed query:` message runs past that, so a suffix is invisible
    // in exactly the read that matters.
    await recordRequestError(
      drizzleError({ code: '57014', severity: 'ERROR', message: 'canceling statement due to statement timeout' }),
      { path: '/api/__q142-code', method: 'GET' },
    )

    const row = await rowFor('GET /api/__q142-code')
    expect(row).toBeDefined()
    expect(row!.message.startsWith('[pg 57014] ')).toBe(true)
    expect(row!.message.slice(0, 120)).toContain('57014')
    expect(row!.stack).toContain('canceling statement due to statement timeout')
  })

  it('falls back to the cause message when there is no code — the pool-timeout shape', async () => {
    // A connection-acquisition timeout arrives with no `code` at all. That case is precisely the
    // one needed to tell pool exhaustion from a statement timeout, so it must not record blank.
    await recordRequestError(
      drizzleError({ message: 'timeout exceeded when trying to connect' }),
      { path: '/api/__q142-nocode', method: 'GET' },
    )

    const row = await rowFor('GET /api/__q142-nocode')
    expect(row!.message.startsWith('[cause: timeout exceeded when trying to connect]')).toBe(true)
  })

  it('records a plain error unchanged', async () => {
    await recordRequestError(new Error('boom'), { path: '/api/__q142-plain', method: 'GET' })

    const row = await rowFor('GET /api/__q142-plain')
    expect(row!.message).toBe('boom')
    expect(row!.stack ?? '').not.toContain('cause:')
  })

  it('dedupes on the base message, so a varying cause cannot defeat the window', async () => {
    // Two failures of the same query, one with a code and one without, are the same fault for
    // dedup purposes. Keying on the prefixed message would let a varying cause write a row per
    // occurrence — the exact hot-loop-fills-the-DB case the window exists to prevent.
    await recordRequestError(drizzleError({ code: '57014' }), { path: '/api/__q142-dedup', method: 'GET' })
    await recordRequestError(drizzleError({ message: 'a different cause' }), { path: '/api/__q142-dedup', method: 'GET' })

    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM error_events WHERE url = $1`,
      ['GET /api/__q142-dedup'],
    )
    expect(rows[0].n).toBe(1)
  })
})
