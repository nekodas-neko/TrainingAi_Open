import { describe, it, expect } from 'vitest'
import { isRetryableWriteError } from '../retryable-error'

// The two wrapper shapes below are transcribed from a real run against a stopped local Postgres
// (`pg_ctl -m fast stop`), not composed from the pg docs. Drizzle wraps every driver error, so the
// signal is one level down `cause` — a classifier that only looked at the top level would answer
// "not retryable" for both, which is the bug.
const drizzleWrap = (cause: unknown) =>
  Object.assign(new Error('Failed query: insert into "body_metrics" ("id", "user_id", …)'), { cause })

describe('isRetryableWriteError — measured outage shapes', () => {
  it('the connection was killed mid-flight: DrizzleQueryError → DatabaseError 57P01', () => {
    expect(isRetryableWriteError(drizzleWrap(
      Object.assign(new Error('terminating connection due to administrator command'), { code: '57P01' }),
    ))).toBe(true)
  })

  it('the pool could not reconnect over TCP: DrizzleQueryError → Error ECONNREFUSED', () => {
    expect(isRetryableWriteError(drizzleWrap(
      Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5433'), { code: 'ECONNREFUSED', syscall: 'connect' }),
    ))).toBe(true)
  })

  // Found by a live `pnpm dev` push with the database stopped, after every unit test passed. The
  // dev DATABASE_URL is the Unix-socket form, and a socket to a dead server is simply missing —
  // so the errno is ENOENT, and the first version of this classifier called a real outage
  // permanent. Production is TCP, which is why nothing but the rehearsal would have caught it.
  it('the pool could not reconnect over a Unix socket: ENOENT with syscall connect', () => {
    expect(isRetryableWriteError(drizzleWrap(
      Object.assign(new Error('connect ENOENT /tmp/.s.PGSQL.5433'), { code: 'ENOENT', syscall: 'connect' }),
    ))).toBe(true)
  })

  it('a bare ENOENT with no failed connect behind it stays non-retryable', () => {
    expect(isRetryableWriteError(
      Object.assign(new Error('ENOENT: no such file or directory, open \'x.json\''), { code: 'ENOENT', syscall: 'open' }),
    )).toBe(false)
  })
})

describe('isRetryableWriteError — SQLSTATE classes', () => {
  it.each([
    ['08006', 'connection_failure'],
    ['08003', 'connection_does_not_exist'],
    ['53100', 'disk_full — the 2026-08-17 incident'],
    ['53300', 'too_many_connections — the session-165 pool incident'],
    ['57P03', 'cannot_connect_now'],
    ['40P01', 'deadlock_detected'],
    ['57014', 'query_canceled by statement_timeout'],
  ])('%s (%s) is retryable', (code) => {
    expect(isRetryableWriteError(Object.assign(new Error('x'), { code }))).toBe(true)
  })

  it.each([
    ['23505', 'unique_violation'],
    ['23503', 'foreign_key_violation'],
    ['22P02', 'invalid_text_representation'],
    ['42703', 'undefined_column'],
    ['23502', 'not_null_violation'],
  ])('%s (%s) is NOT retryable — retrying cannot help, and the row must dead-letter', (code) => {
    expect(isRetryableWriteError(Object.assign(new Error('x'), { code }))).toBe(false)
  })
})

describe('isRetryableWriteError — conservative by construction', () => {
  it('an ordinary validation error is not retryable', () => {
    expect(isRetryableWriteError(new Error('Invalid plan_meal_answers payload: missing planMealId'))).toBe(false)
  })

  it('a plain string, null and undefined are not retryable', () => {
    expect(isRetryableWriteError('Failed query: …')).toBe(false)
    expect(isRetryableWriteError(null)).toBe(false)
    expect(isRetryableWriteError(undefined)).toBe(false)
  })

  it('a self-referencing cause chain terminates instead of spinning', () => {
    const e: { cause?: unknown } = {}
    e.cause = e
    expect(isRetryableWriteError(e)).toBe(false)
  })

  it('finds the signal several wrappers deep, but not past the depth cap', () => {
    const deep = (n: number): unknown =>
      n === 0 ? Object.assign(new Error('gone'), { code: 'ECONNREFUSED' }) : { cause: deep(n - 1) }
    expect(isRetryableWriteError(deep(4))).toBe(true)
    expect(isRetryableWriteError(deep(9))).toBe(false)
  })

  it('recognises the pg pool messages that carry no code at all', () => {
    expect(isRetryableWriteError(new Error('Connection terminated unexpectedly'))).toBe(true)
    expect(isRetryableWriteError(new Error('timeout exceeded when trying to connect'))).toBe(true)
    expect(isRetryableWriteError(new Error('the database system is starting up'))).toBe(true)
  })
})
