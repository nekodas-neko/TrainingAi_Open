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

describe('item 3: the stored stack is built from the scrubbed message', () => {
  const FRAMEY = 'CANARY-a\n    at fake (x.js:1:1)\nCANARY-b'
  it('a Drizzle error wrapped in text, with a frame-like parameter', () => {
    const inner = fake([FRAMEY, 'CANARY-c-param'])
    const wrapped = new Error(`save failed: ${String(inner)}`)
    const out = scrubErrorStack(wrapped.stack!, wrapped)
    for (const w of ['CANARY-a', 'CANARY-b', 'CANARY-c-param', 'fake (x.js']) expect(out).not.toContain(w)
    expect(out).toMatch(/\n\s+at .*:\d+:\d+/)
  })
  it('a .params that is not an array', () => {
    const err = Object.assign(new Error(`Failed query: ${sqlText}\nparams: CANARY-solo\n    at fake (x.js:1:1)`), { params: 'CANARY-solo' })
    expect(scrubErrorStack(err.stack!, err)).not.toContain('CANARY-solo')
    expect(scrubErrorText(err.message, err)).not.toContain('CANARY-solo')
  })
  it('a throwing .params getter does not throw, and the frame rule still applies', async () => {
    const err = new Error(`Failed query: ${sqlText}\nparams: CANARY-getter,CANARY-two`)
    Object.defineProperty(err, 'params', { get() { throw new Error('boom') } })
    expect(() => scrubErrorText(err.message, err)).not.toThrow()
    expect(scrubErrorStack(err.stack!, err)).not.toContain('CANARY-getter')
    expect(() => reportServerError(err)).not.toThrow()
    await flushPendingReports()
  })
})

