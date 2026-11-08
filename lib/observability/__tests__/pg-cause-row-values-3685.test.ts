// #3685: `error_events` (read by every agent) and Sentry kept the row values Postgres itself echoes
// in an error — a unique violation's `detail` carries the duplicate email, a bad cast's message the
// bad input. #3673 dropped Drizzle's `params:` line; this covers the Postgres side.
//
// Every fixture below is the exact text a local Postgres 16 produced for that violation (captured
// with `pg` against `trainingai_dev`), so the shapes are Postgres's, not written from memory.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const insertErrorEvent = vi.fn(async (_e: { message: string; stack?: string | null }) => {})
vi.mock('@/lib/data', () => ({ getRepositoryAsync: async () => ({ insertErrorEvent }) }))

import { scrubPgDetail, scrubPgMessage } from '../scrub-params'
import { scrubOwnPgMessage, summariseCause } from '../pg-cause'
import { scrubExceptionValue } from '../sentry-scrub'
import { reportServerError, flushPendingReports } from '@/lib/observability'

/** A `pg` DatabaseError as the driver builds it: `name` is `error`, the SQLSTATE on `code`. */
function pgError(fields: Record<string, string>): Error {
  const err = new Error(fields.message)
  err.name = 'error'
  return Object.assign(err, fields)
}

function drizzleError(cause: unknown): Error {
  const err = new Error('Failed query: insert into "users" ("email") values ($1)\nparams: [scrubbed]')
  ;(err as { cause?: unknown }).cause = cause
  return err
}

const uniqueViolation = () => pgError({
  code: '23505', severity: 'ERROR', message: 'duplicate key value violates unique constraint "t_email_key"',
  detail: 'Key (email)=(a@b.c) already exists.', constraint: 't_email_key', schema: 'public', table: 't',
})

describe('scrubPgDetail — the shapes Postgres produces', () => {
  it('unique violation: keeps the key column list, drops the value', () => {
    expect(scrubPgDetail('Key (email)=(a@b.c) already exists.')).toBe('Key (email)=(…) already exists.')
  })

  it('unique violation on a composite key, and on an expression key', () => {
    expect(scrubPgDetail('Key (user_id, date)=(3f0c…, 2026-11-08) already exists.'))
      .toBe('Key (user_id, date)=(…) already exists.')
    expect(scrubPgDetail('Key (lower(email))=(a@b.c) already exists.'))
      .toBe('Key (lower(email))=(…) already exists.')
  })

  it('foreign key on insert keeps the referenced table', () => {
    expect(scrubPgDetail('Key (pid)=(9) is not present in table "p".'))
      .toBe('Key (pid)=(…) is not present in table "p".')
  })

  it('foreign key on delete keeps the referencing table', () => {
    expect(scrubPgDetail('Key (id)=(1) is still referenced from table "t".'))
      .toBe('Key (id)=(…) is still referenced from table "t".')
  })

  it('exclusion constraint drops both values', () => {
    expect(scrubPgDetail('Key (r)=([1,5)) conflicts with existing key (r)=([2,6)).'))
      .toBe('Key (r)=(…) conflicts with existing key (r)=(…).')
  })

  it('not-null and check: the whole failing row goes', () => {
    expect(scrubPgDetail('Failing row contains (4, q@b.c, 1, null, 1).')).toBe('Failing row contains (…).')
    expect(scrubPgDetail('Failing row contains (5, w@b.c, 1, secret name, -5).')).toBe('Failing row contains (…).')
  })

  it('a value that itself contains `)` or the sentence text is swallowed whole', () => {
    const out = scrubPgDetail('Key (name)=(x) already exists. leak) already exists.')
    expect(out).toBe('Key (name)=(…) already exists.')
    expect(out).not.toContain('leak')
  })

  it('an unknown detail fails closed: no value after `=(`, `contains (` or in quotes survives', () => {
    expect(scrubPgDetail('Partition key of the failing row contains (day) = (2026-11-08).'))
      .not.toContain('2026-11-08')
    expect(scrubPgDetail('Token "hunter2" is invalid.')).toBe('Token "…" is invalid.')
  })

  it('a detail with no value passes through unchanged', () => {
    const d = 'MATCH FULL does not allow mixing of null and nonnull key values.'
    expect(scrubPgDetail(d)).toBe(d)
  })
})

describe('scrubPgMessage', () => {
  it('bad cast: the quoted input goes, the type stays', () => {
    expect(scrubPgMessage('invalid input syntax for type uuid: "not-a-uuid"'))
      .toBe('invalid input syntax for type uuid: "…"')
  })

  it('a value containing a quote is dropped whole (Postgres does not escape it)', () => {
    expect(scrubPgMessage('invalid input syntax for type uuid: "a"b c"')).toBe('invalid input syntax for type uuid: "…"')
    expect(scrubPgMessage('invalid input value for enum mood: "great"')).toBe('invalid input value for enum mood: "…"')
  })

  it('messages with no value pass through unchanged — quoted identifiers included', () => {
    for (const m of [
      'canceling statement due to statement timeout',
      'duplicate key value violates unique constraint "t_email_key"',
      'insert or update on table "t" violates foreign key constraint "t_pid_fkey"',
      'null value in column "n" of relation "t" violates not-null constraint',
      'new row for relation "t" violates check constraint "t_v_check"',
      'timeout exceeded when trying to connect',
    ]) expect(scrubPgMessage(m)).toBe(m)
  })
})

describe('summariseCause keeps the diagnosis and drops the values', () => {
  it('unique violation: code, severity, constraint, schema, table and key columns, no email', () => {
    const { prefix, block } = summariseCause(drizzleError(uniqueViolation()))
    expect(prefix).toBe('[pg 23505] ')
    expect(block).not.toContain('a@b.c')
    expect(block).toContain('detail: Key (email)=(…) already exists.')
    expect(block).toContain('ERROR')
    expect(block).toContain('constraint: t_email_key')
    expect(block).toContain('schema: public')
    expect(block).toContain('table: t')
  })

  it('not-null: the column name is kept, the failing row is not', () => {
    const { block } = summariseCause(drizzleError(pgError({
      code: '23502', severity: 'ERROR', message: 'null value in column "n" of relation "t" violates not-null constraint',
      detail: 'Failing row contains (4, q@b.c, 1, null, 1).', table: 't', column: 'n',
    })))
    expect(block).not.toContain('q@b.c')
    expect(block).toContain('column: n')
    expect(block).toContain('Failing row contains (…).')
  })

  it('bad cast with no code (prefix falls back to the message): the value is not in the prefix either', () => {
    const { prefix, block } = summariseCause(drizzleError({ message: 'invalid input syntax for type uuid: "not-a-uuid"' }))
    expect(prefix).toBe('[cause: invalid input syntax for type uuid: "…"] ')
    expect(block).not.toContain('not-a-uuid')
  })
})

describe('every writer drops them', () => {
  beforeEach(() => insertErrorEvent.mockClear())

  it('reportServerError: a Drizzle-wrapped unique violation', async () => {
    reportServerError(drizzleError(uniqueViolation()))
    await flushPendingReports()
    const row = insertErrorEvent.mock.calls[0][0]
    expect(row.message.startsWith('[pg 23505] ')).toBe(true)
    expect(`${row.message}\n${row.stack}`).not.toContain('a@b.c')
    expect(row.stack).toContain('Key (email)=(…) already exists.')
  })

  it('reportServerError: a raw pg error (no Drizzle wrapper), in its message and its stack', async () => {
    const err = pgError({ code: '22P02', severity: 'ERROR', message: 'invalid input syntax for type uuid: "not-a-uuid"' })
    expect(err.stack).toContain('not-a-uuid')
    reportServerError(err)
    await flushPendingReports()
    const row = insertErrorEvent.mock.calls[0][0]
    expect(row.message).toBe('invalid input syntax for type uuid: "…"')
    expect(row.stack).not.toContain('not-a-uuid')
    expect(row.stack).toContain('invalid input syntax for type uuid: "…"')
  })

  it('scrubOwnPgMessage leaves a non-pg error alone, even one shaped like a cast message', () => {
    const err = new Error('Unknown option: "verbose"')
    expect(scrubOwnPgMessage(err, err.message)).toBe(err.message)
  })

  it("Sentry: the pg cause's message, sent as its own linked exception value", () => {
    expect(scrubExceptionValue('invalid input syntax for type uuid: "not-a-uuid"'))
      .toBe('invalid input syntax for type uuid: "…"')
  })
})
