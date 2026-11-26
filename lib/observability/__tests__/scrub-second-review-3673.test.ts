// #3673 second review round. Every value is made up; no database, no network, no model.
import { describe, it, expect } from 'vitest'
import { DrizzleQueryError } from 'drizzle-orm/errors'
import { reportServerError, flushPendingReports } from '@/lib/observability'
import { scrubErrorStack, scrubErrorText, scrubPgDetail, scrubPgMessage } from '../scrub-params'

const sqlText = 'select $1::uuid from users where id = $2 limit 1'
const fake = (params: unknown[]) => new DrizzleQueryError(sqlText, params, undefined)

describe('item 1: a short parameter does not mangle the SQL or the frames', () => {
  for (const params of [['1', '4'], ['users', '5'], ['4']]) {
    it(`params ${JSON.stringify(params)}`, () => {
      const err = fake(params)
      for (const out of [scrubErrorText(err.message, err), scrubErrorStack(err.stack!, err)]) {
        expect(out).toContain(sqlText)
        expect(out).toContain('params: [scrubbed]')
        expect(out).not.toMatch(/params: (1|4|users|5)\b/)
      }
      // the frames keep their line numbers
      const stack = scrubErrorStack(err.stack!, err)
      expect(stack).toMatch(/\n\s+at .*:\d+:\d+/)
      expect(stack).not.toContain('[scrubbed]:')
    })
  }
  it('a long parameter is still removed wherever it appears', () => {
    const err = fake(['CANARY-long-value', 'x'])
    const out = scrubErrorText(`first: ${err.message} and again CANARY-long-value`, err)
    expect(out).not.toContain('CANARY-long-value')
  })
})

describe('item 2: relation/type/function/schema/role names', () => {
  for (const kind of ['relation', 'type', 'function', 'schema', 'role']) {
    it(kind, () => {
      expect(scrubPgMessage(`${kind} "CANARY\nname" does not exist`)).toBe(`${kind} "…" does not exist`)
    })
  }
  it('a message that only mentions a relation is untouched', () => {
    expect(scrubPgMessage('null value in column "n" of relation "t" violates not-null constraint')).toBe('null value in column "n" of relation "t" violates not-null constraint')
  })
})

