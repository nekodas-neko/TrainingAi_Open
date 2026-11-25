// #3673 review round: three gaps in the scrubber, each proved with a REAL Postgres error (and a real
// Drizzle error wrapping it) from the local database. Every value is made up.
//   1. a quoted value with a line break in it
//   2. data-exception messages that carry the value in another shape
//   3. the stack scrub: exact `.params` removal, every `params:` marker, odd parameter types
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { DrizzleQueryError } from 'drizzle-orm/errors'
import { summariseCause } from '../pg-cause'
import { safeErrorText, scrubErrorStack, scrubErrorText, scrubPgDetail, scrubPgMessage, scrubBoundParamsInStack } from '../scrub-params'

const canRun = !!process.env.DATABASE_URL
const MULTI = 'CANARY-line-one\n    at the gym\nCANARY-line-three'
const WORDS = ['CANARY-line-one', 'at the gym', 'CANARY-line-three']

function expectClean(text: string | null | undefined, words: string[] = WORDS) {
  expect(text).toBeTruthy()
  for (const w of words) expect(text!, w).not.toContain(w)
}

describe('multi-line quoted value, message shapes (no database)', () => {
  it('scrubPgMessage takes a value across line breaks up to the end of the message', () => {
    const out = scrubPgMessage(`invalid input syntax for type uuid: "${MULTI}"`)
    expect(out).toBe('invalid input syntax for type uuid: "…"')
  })
  it('a value that contains a quote is swallowed whole', () => {
    expect(scrubPgMessage('invalid input syntax for type uuid: "CANARY"x"\nCANARY2"')).toBe('invalid input syntax for type uuid: "…"')
  })
  it('the other shapes, by text alone', () => {
    expect(scrubPgMessage('value "CANARY\nx" is out of range for type smallint')).toBe('value "…" is out of range for type smallint')
    expect(scrubPgMessage('"CANARY\nx" is out of range for type double precision')).toBe('"…" is out of range for type double precision')
    expect(scrubPgMessage('time zone "CANARY\nx" not recognized')).toBe('time zone "…" not recognized')
    expect(scrubPgMessage('invalid value "CANARY\nx" for "YYYY"')).toBe('invalid value "…" for "…"')
  })
  it('leaves a message without a value alone', () => {
    expect(scrubPgMessage('canceling statement due to statement timeout')).toBe('canceling statement due to statement timeout')
    expect(scrubPgMessage('integer out of range')).toBe('integer out of range')
  })
  it('class 22 details that echo unquoted values go entirely', () => {
    expect(scrubPgDetail('line 1: Couldn\'t find end of Start Tag CANARY line 1\n<CANARY\n     ^', '2200N')).toBe('…')
    expect(scrubPgDetail('Token "CANARY" is invalid.', '22P02')).toBe('Token "…" is invalid.')
  })
})

describe('the stack scrub (no database)', () => {
  const frame = '\n    at save (/app/lib/x.ts:10:5)\n    at async handler (/app/app/api/y/route.ts:4:2)'
  const fake = (params: unknown[]) => new DrizzleQueryError('insert into "t" values ($1, $2, $3)', params, undefined)

  it('a text parameter with a line break then "at the gym", and a later parameter after it', () => {
    const err = fake([MULTI, 'CANARY-later-param-xyz', 7])
    for (const out of [scrubErrorStack(err.stack!, err), scrubErrorStack(err.stack!), scrubErrorText(err.message, err), scrubErrorText(err.message)]) {
      expectClean(out, [...WORDS, 'CANARY-later-param-xyz'])
    }
    expect(scrubErrorStack(err.stack!, err)).toMatch(/\n\s+at .*:\d+:\d+/)
  })
  it('keeps the frames, drops a forged frame line only when the error is known', () => {
    const err = fake(['CANARY-a\n    at fake (x.js:1:1)\nCANARY-b', 'CANARY-c-param'])
    const out = scrubErrorStack(err.stack!, err)
    expectClean(out, ['CANARY-a', 'CANARY-b', 'CANARY-c-param', 'fake (x.js'])
  })
  it('scrubs every params marker, not only the first', () => {
    const stack = `Error: Failed query: a\nparams: CANARY-one${frame}\nCaused by: Failed query: b\nparams: CANARY-two\nCANARY-two-more${frame}`
    const out = scrubBoundParamsInStack(stack)
    expectClean(out, ['CANARY-one', 'CANARY-two', 'CANARY-two-more'])
    expect(out.match(/params: \[scrubbed\]/g)).toHaveLength(2)
    expect(out).toContain('at save (/app/lib/x.ts:10:5)')
  })
  it('a 100 kB parameter', () => {
    const big = `CANARY-${'x'.repeat(100_000)}\n    at the gym`
    const err = fake([big, 'CANARY-after-big'])
    const out = scrubErrorStack(err.stack!, err)
    expectClean(out, ['CANARY-', 'at the gym'])
    expect(out.length).toBeLessThan(5000)
  })
  it('array, JSON, null, Date, bigint and Buffer parameters', () => {
    const err = fake([['CANARY-arr1', 'CANARY-arr2\nx'], { k: 'CANARY-json-value' }, null, new Date(0), 12345678901234567890n, Buffer.from('CANARY-buffer\nbytes')])
    const out = scrubErrorStack(err.stack!, err) + scrubErrorText(err.message, err)
    expectClean(out, ['CANARY', 'bytes', '12345678901234567890', '1970'])
  })
  it('walks the cause chain for params', () => {
    const inner = fake([MULTI, 'CANARY-later-param-xyz'])
    const outer = new Error(`save failed: ${inner.message}`, { cause: inner })
    expectClean(scrubErrorText(outer.message, outer), [...WORDS, 'CANARY-later-param-xyz'])
    expectClean(scrubErrorStack(outer.stack!, outer), [...WORDS, 'CANARY-later-param-xyz'])
  })
  it('a Date and a short parameter do not mangle the SQL', () => {
    const err = fake([1, 'a', new Date(0)])
    expect(scrubErrorText(err.message, err)).toContain('insert into "t" values ($1, $2, $3)')
  })
})

describe.skipIf(!canRun)('real Postgres + Drizzle errors', () => {
  let pool: import('pg').Pool
  let db: ReturnType<typeof import('@/lib/data/postgres/client').getDb>
  const TAG = '/api/__scrubreview'

  beforeAll(async () => {
    const c = await import('@/lib/data/postgres/client')
    pool = c.getPool()
    db = c.getDb()
    await pool.query(`DO $$ BEGIN CREATE TYPE scrub3673_mood AS ENUM ('ok'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`)
    await pool.query(`DELETE FROM error_events WHERE url LIKE $1`, [`%${TAG}%`])
  })
  beforeEach(async () => { (await import('../request-error')).resetRequestErrorDedupe() })
  afterAll(async () => {
    await pool.query(`DELETE FROM error_events WHERE url LIKE $1`, [`%${TAG}%`])
    await pool.query('DROP TYPE IF EXISTS scrub3673_mood')
  })

  const drizzleFail = async (q: ReturnType<typeof sql>) => { try { await db.execute(q); throw new Error('expected a failure') } catch (e) { return e as Error } }
  const rawFail = async (text: string, vals: unknown[]) => { try { await pool.query(text, vals); throw new Error('expected a failure') } catch (e) { return e as Error } }
  const rowFor = async (url: string) =>
    (await pool.query(`SELECT message, stack FROM error_events WHERE url = $1 ORDER BY created_at DESC LIMIT 1`, [url])).rows[0] as { message: string; stack: string | null }

  // Fix 1: a text value with a line break, cast to four types.
  const CASTS = ['uuid', 'integer', 'date', 'scrub3673_mood']
  for (const type of CASTS) {
    it(`multi-line value cast to ${type}: safeErrorText, scrubErrorStack, summariseCause, stored row`, async () => {
      const err = await drizzleFail(sql`select ${MULTI}::${sql.raw(type)}`)
      const pg = (err as { cause?: Error }).cause!
      expect(pg.message).toContain('CANARY-line-three') // the real error does carry the value
      expectClean(safeErrorText(err))
      expectClean(safeErrorText(pg))
      expectClean(scrubErrorStack(err.stack!, err))
      expectClean(scrubErrorStack(pg.stack!, pg))
      expectClean(scrubErrorStack(pg.stack!))
      const { prefix, block } = summariseCause(err)
      expectClean(prefix + block)
      expect(block).toMatch(/22(P02|007)/)

      const { reportServerError, flushPendingReports } = await import('@/lib/observability')
      const { recordRequestError } = await import('../request-error')
      reportServerError(err, { url: `${TAG}-${type}-d` })
      reportServerError(await rawFail(`select $1::${type}`, [MULTI]), { url: `${TAG}-${type}-p` })
      await flushPendingReports()
      await recordRequestError(err, { path: `${TAG}-${type}-r`, method: 'PUT' })
      for (const url of [`${TAG}-${type}-d`, `${TAG}-${type}-p`, `PUT ${TAG}-${type}-r`]) {
        const row = await rowFor(url)
        expect(row, url).toBeDefined()
        expectClean(row.message)
        expectClean(row.stack)
        expect(row.stack).toMatch(/\n\s+at /)
      }
    })
  }

  // Fix 2: other shapes, real errors, the pg code and type name kept.
  const SHAPES: [string, string, string, string][] = [
    ['integer out of range', 'select $1::bigint::integer', '99999999999', '22003'],
    ['smallint out of range', 'select $1::smallint', '99999', '22003'],
    ['bigint out of range', 'select $1::bigint', '99999999999999999999', '22003'],
    ['double precision out of range', 'select $1::float8', '1e999', '22003'],
    ['time zone not recognized', 'select now() at time zone $1', 'CANARY/Zone\nat the gym', '22023'],
    ['to_date invalid value', "select to_date($1, 'YYYY')", 'CANARYX', '22007'], // Postgres echoes only the first 4 characters: "CANA"
  ]
  for (const [name, text, value, code] of SHAPES) {
    it(`${name}: no value, the code and type name stay`, async () => {
      const pgErr = await rawFail(text, [value]) as Error & { code: string }
      expect(pgErr.code).toBe(code)
      const wrapped = new DrizzleQueryError(text, [value], pgErr)
      const needle = name.startsWith('to_date') ? 'CANA' : value.replace(/\n.*/s, '')
      const outs = [safeErrorText(pgErr), scrubErrorStack(pgErr.stack!, pgErr), summariseCause(wrapped).block ?? '', safeErrorText(wrapped), scrubErrorStack(wrapped.stack!, wrapped)]
      for (const o of outs) { expect(o).not.toContain(needle); expect(o).not.toContain('at the gym') }
      if (name.includes('out of range')) expect(outs[0]).toMatch(/out of range for type (smallint|bigint|double precision)|integer out of range/)
      if (name.includes('time zone')) expect(outs[0]).toBe('time zone "…" not recognized')
      expect(summariseCause(wrapped).prefix).toBe(`[pg ${code}] `)
    })
  }

  // Postgres 16 class 22 / 23 messages that echo a value. See the PR for the full list.
  it('json, xml, uuid-array, interval, enum: nothing of the value survives', async () => {
    const cases: [string, unknown][] = [
      ['select $1::jsonb', '{CANARYjson\nx'],
      ['select $1::xml', '<CANARYxml'],
      ['select $1::uuid[]', '{CANARYarr\nx}'],
      ['select $1::interval', 'CANARYint\nx'],
      ['select $1::scrub3673_mood', 'CANARYenum\nx'],
      ['select $1::numeric', 'CANARYnum'],
      ['select decode($1, \'hex\')', 'CANARYhex'],
    ]
    for (const [text, v] of cases) {
      const pgErr = await rawFail(text, [v]) as Error & { code: string; detail?: string }
      const wrapped = new DrizzleQueryError(text, [v], pgErr)
      const { prefix, block } = summariseCause(wrapped)
      for (const o of [safeErrorText(pgErr), scrubErrorStack(pgErr.stack!, pgErr), prefix + block]) expect(o, text).not.toMatch(/CANARY/)
    }
  })

  it('a not-null and a unique violation keep what they kept', async () => {
    const err = await rawFail('insert into users (email, password_hash) values ($1, $2)', [null, 'CANARY-hash-value'])
    expect((err as { code: string }).code).toBe('23502')
    const { block } = summariseCause(new DrizzleQueryError('insert', [], err))
    expect(block).not.toContain('CANARY')
    expect(block).toContain('detail: Failing row contains (…).')
  })
})
