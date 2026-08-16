// Q-107: every `Failed query` row in `error_events` was undiagnosable because the reporter
// recorded `err.message` and `err.stack` and dropped `err.cause` — which is exactly where
// DrizzleQueryError puts the real Postgres error (code, severity, detail). Without it there is no
// way to tell a statement timeout (57014) from a pool-acquisition timeout, which is the difference
// between the two competing explanations for the intermittent /api/sync/pull failures.
import { describe, it, expect } from 'vitest'
import { summariseCause } from '../observability'

// The shape drizzle-orm/errors.js constructs: message is the SQL, cause is the driver error.
function drizzleError(cause: unknown) {
  const err = new Error('Failed query: select * from body_metrics where user_id = $1\nparams: abc')
  ;(err as { cause?: unknown }).cause = cause
  return err
}

describe('summariseCause', () => {
  it('lifts the Postgres code into a prefix, where a left(message,120) read can see it', () => {
    const { prefix, block } = summariseCause(drizzleError({
      code: '57014', severity: 'ERROR', message: 'canceling statement due to statement timeout',
    }))
    // A `Failed query:` message runs well past 120 chars, so a suffix would be invisible in the
    // standing grouped query — the whole point of this fix.
    expect(prefix).toBe('[pg 57014] ')
    expect(block).toContain('57014')
    expect(block).toContain('canceling statement due to statement timeout')
  })

  it('falls back to the cause message when there is no code (the pool-timeout case)', () => {
    const { prefix, block } = summariseCause(drizzleError(
      new Error('timeout exceeded when trying to connect'),
    ))
    expect(prefix).toBe('[cause: timeout exceeded when trying to connect] ')
    expect(block).toContain('timeout exceeded when trying to connect')
  })

  it('carries detail, constraint and table when the driver supplies them', () => {
    const { block } = summariseCause(drizzleError({
      code: '23505', severity: 'ERROR', message: 'duplicate key value violates unique constraint',
      detail: 'Key (user_id, date) already exists.', constraint: 'body_metrics_user_date_key',
      table: 'body_metrics',
    }))
    expect(block).toContain('detail: Key (user_id, date) already exists.')
    expect(block).toContain('constraint: body_metrics_user_date_key')
    expect(block).toContain('table: body_metrics')
  })

  it('is a no-op for an error with no cause, and for a non-Error', () => {
    expect(summariseCause(new Error('plain'))).toEqual({ prefix: '', block: null })
    expect(summariseCause('a string')).toEqual({ prefix: '', block: null })
    expect(summariseCause(drizzleError(null))).toEqual({ prefix: '', block: null })
  })
})
