// #2816 — the dev fuse on live Gemini requests. On 2026-10-11 ~460 requests from `pnpm dev` emptied
// the one prepaid balance production also draws on, and every AI feature in the live app failed
// (#2815). These pin that the fuse is off wherever real users are, and that off production it
// counts every request — retries and stream steps included — and refuses before calling out.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { APICallError } from 'ai'
import {
  DEFAULT_DEV_AI_CALL_LIMIT,
  DevAiBudgetError,
  assertDevAiBudget,
  devAiBudgetActive,
  devAiCallLimit,
  recordDevAiCall,
  takeDevAiCall,
} from '../dev-call-budget'
import { isRetryableAiError } from '../retry'

const insertAiCallLog = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('@/lib/data', () => ({
  getRepository: async () => ({ insertAiCallLog }),
  getRepositoryAsync: async () => ({ insertErrorEvent: async () => {} }),
}))

// Captures what `loggedStreamText` hands the SDK, so its merged callbacks can be driven directly.
const streamed: { params?: Record<string, unknown> } = {}
vi.mock('ai', async importOriginal => ({
  ...(await importOriginal<typeof import('ai')>()),
  streamText: (params: Record<string, unknown>) => { streamed.params = params; return {} },
}))

const HOUR = 60 * 60 * 1000
const NOW = 1_800_000_000_000

let dir: string
let store: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-ai-budget-'))
  store = path.join(dir, 'calls.json')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
  fs.rmSync(dir, { recursive: true, force: true })
})

const dev = (extra: Record<string, string> = {}) =>
  ({ NODE_ENV: 'development', AI_DEV_CALL_LOG_PATH: store, ...extra })
const stored = (): number[] => JSON.parse(fs.readFileSync(store, 'utf8'))

describe('devAiBudgetActive — off wherever real users are', () => {
  it.each([
    ['production', { NODE_ENV: 'production' }],
    ['the unit-test suite', { NODE_ENV: 'test' }],
    ['Railway by environment name, whatever NODE_ENV says', { NODE_ENV: 'development', RAILWAY_ENVIRONMENT_NAME: 'production' }],
    ['Railway by environment id, whatever NODE_ENV says', { RAILWAY_ENVIRONMENT_ID: 'abc' }],
  ])('is off in %s: no throw even at limit 0, and no file written', (_, env) => {
    const e = { ...env, AI_DEV_CALL_LOG_PATH: store, AI_DEV_DAILY_CALL_LIMIT: '0' }
    expect(devAiBudgetActive(e)).toBe(false)
    expect(() => takeDevAiCall(e, NOW)).not.toThrow()
    expect(() => assertDevAiBudget(e, NOW)).not.toThrow()
    recordDevAiCall(e, NOW)
    expect(fs.existsSync(store)).toBe(false)
  })

  it('is on for pnpm dev and for a plain node script', () => {
    expect(devAiBudgetActive({ NODE_ENV: 'development' })).toBe(true)
    expect(devAiBudgetActive({})).toBe(true)
  })

  // The live tests run under vitest, so NODE_ENV=test alone would wave through the one test run
  // that does spend the balance.
  it('is on inside vitest when the live-model tests are opted in', () => {
    expect(devAiBudgetActive({ NODE_ENV: 'test', RUN_LIVE_AI_TESTS: '1' })).toBe(true)
  })
})

describe('devAiCallLimit', () => {
  it('defaults when unset or blank', () => {
    expect(devAiCallLimit({})).toBe(DEFAULT_DEV_AI_CALL_LIMIT)
    expect(devAiCallLimit({ AI_DEV_DAILY_CALL_LIMIT: '  ' })).toBe(DEFAULT_DEV_AI_CALL_LIMIT)
  })

  it('reads a non-negative integer, 0 included', () => {
    expect(devAiCallLimit({ AI_DEV_DAILY_CALL_LIMIT: '25' })).toBe(25)
    expect(devAiCallLimit({ AI_DEV_DAILY_CALL_LIMIT: '0' })).toBe(0)
  })

  it.each(['-5', '2.5', 'lots', '1e3', 'Infinity'])('falls back to the default for %j', raw => {
    expect(devAiCallLimit({ AI_DEV_DAILY_CALL_LIMIT: raw })).toBe(DEFAULT_DEV_AI_CALL_LIMIT)
  })
})

describe('the budget off production', () => {
  it('records each call and throws once the window holds the limit', () => {
    const env = dev({ AI_DEV_DAILY_CALL_LIMIT: '3' })
    takeDevAiCall(env, NOW)
    takeDevAiCall(env, NOW + 1)
    takeDevAiCall(env, NOW + 2)
    expect(stored()).toEqual([NOW, NOW + 1, NOW + 2])
    expect(() => takeDevAiCall(env, NOW + 3)).toThrow(DevAiBudgetError)
    // A refused call is not counted.
    expect(stored()).toHaveLength(3)
  })

  it('limit 0 blocks the first call', () => {
    expect(() => assertDevAiBudget(dev({ AI_DEV_DAILY_CALL_LIMIT: '0' }), NOW)).toThrow(DevAiBudgetError)
  })

  it('drops calls older than 24 hours out of the window', () => {
    const env = dev({ AI_DEV_DAILY_CALL_LIMIT: '2' })
    recordDevAiCall(env, NOW - 25 * HOUR)
    recordDevAiCall(env, NOW - 23 * HOUR)
    // One inside the window, so one more fits.
    expect(() => takeDevAiCall(env, NOW)).not.toThrow()
    expect(stored()).toEqual([NOW - 23 * HOUR, NOW])
    expect(() => assertDevAiBudget(env, NOW)).toThrow(DevAiBudgetError)
    // Once the older one ages out too, the window has room again.
    expect(() => assertDevAiBudget(env, NOW + 2 * HOUR)).not.toThrow()
  })

  it('applies the default when the limit is invalid', () => {
    const env = dev({ AI_DEV_DAILY_CALL_LIMIT: 'nope' })
    fs.writeFileSync(store, JSON.stringify(Array.from({ length: DEFAULT_DEV_AI_CALL_LIMIT - 1 }, (_, i) => NOW - i)))
    expect(() => takeDevAiCall(env, NOW)).not.toThrow()
    expect(() => assertDevAiBudget(env, NOW)).toThrow(DevAiBudgetError)
  })

  it.each([
    ['not JSON', '{not json'],
    ['not an array', '{"calls":[1,2,3]}'],
  ])('treats a store that is %s as empty', (_, contents) => {
    fs.writeFileSync(store, contents)
    const env = dev({ AI_DEV_DAILY_CALL_LIMIT: '1' })
    expect(() => takeDevAiCall(env, NOW)).not.toThrow()
    expect(stored()).toEqual([NOW])
  })

  it('ignores entries that are not finite numbers', () => {
    fs.writeFileSync(store, JSON.stringify(['x', null, NOW - HOUR, { t: NOW }]))
    expect(() => takeDevAiCall(dev({ AI_DEV_DAILY_CALL_LIMIT: '2' }), NOW)).not.toThrow()
    expect(stored()).toEqual([NOW - HOUR, NOW])
  })

  it('fails open when the store cannot be written', () => {
    // A directory where the file should be: every write fails.
    const env = dev({ AI_DEV_CALL_LOG_PATH: dir, AI_DEV_DAILY_CALL_LIMIT: '1' })
    expect(() => recordDevAiCall(env, NOW)).not.toThrow()
    expect(() => takeDevAiCall(env, NOW)).not.toThrow()
  })

  it('the error carries what was used and the limit, and says where to read before raising it', () => {
    const env = dev({ AI_DEV_DAILY_CALL_LIMIT: '2' })
    recordDevAiCall(env, NOW - 1)
    recordDevAiCall(env, NOW)
    let caught: unknown
    try { assertDevAiBudget(env, NOW) } catch (e) { caught = e }
    expect(caught).toBeInstanceOf(DevAiBudgetError)
    expect(caught).toMatchObject({ name: 'DevAiBudgetError', used: 2, limit: 2 })
    expect((caught as Error).message).toContain('AI_DEV_DAILY_CALL_LIMIT')
    expect((caught as Error).message).toContain('docs/rules/ai-security-and-integrations.md')
  })

  it('is never retried by the shared retry policy', () => {
    expect(isRetryableAiError(new DevAiBudgetError(100, 100))).toBe(false)
  })
})

describe('the chokepoint in instrument.ts honours the budget', () => {
  const apiError = (statusCode: number) =>
    new APICallError({ message: `status ${statusCode}`, url: 'https://example.test', requestBodyValues: {}, statusCode })

  beforeEach(() => {
    insertAiCallLog.mockClear()
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('AI_DEV_CALL_LOG_PATH', store)
  })

  it('refuses an exhausted budget before making the call, and logs no failed call', async () => {
    vi.stubEnv('AI_DEV_DAILY_CALL_LIMIT', '0')
    const { withAiLogging } = await import('../instrument')
    const fn = vi.fn(async () => ({ usage: {} }))
    await expect(withAiLogging({ section: 'coach' }, fn)).rejects.toBeInstanceOf(DevAiBudgetError)
    expect(fn).not.toHaveBeenCalled()
    expect(fs.existsSync(store)).toBe(false)
    // The ai_call_log insert is fire-and-forget; give it a macrotask to land if it were coming.
    await new Promise(r => setTimeout(r, 0))
    expect(insertAiCallLog).not.toHaveBeenCalled()
  })

  it('records one request for a call that succeeds first time', async () => {
    vi.stubEnv('AI_DEV_DAILY_CALL_LIMIT', '10')
    const { withAiLogging } = await import('../instrument')
    await withAiLogging({ section: 'coach' }, async () => ({ usage: {} }))
    expect(stored()).toHaveLength(1)
  })

  it('records every attempt, so a retried 503 counts as two requests', async () => {
    vi.stubEnv('AI_DEV_DAILY_CALL_LIMIT', '10')
    vi.useFakeTimers()
    const { withAiLogging } = await import('../instrument')
    const fn = vi.fn()
      .mockRejectedValueOnce(apiError(503))
      .mockResolvedValueOnce({ usage: {} })
    const call = withAiLogging({ section: 'coach' }, fn)
    // The shared retry backs off 1–1.5 s before its one retry.
    await vi.advanceTimersByTimeAsync(2000)
    await expect(call).resolves.toEqual({ usage: {} })
    expect(fn).toHaveBeenCalledTimes(2)
    expect(stored()).toHaveLength(2)
  })

  it('loggedStreamText refuses up front and counts each finished step', async () => {
    vi.stubEnv('AI_DEV_DAILY_CALL_LIMIT', '10')
    const { loggedStreamText } = await import('../instrument')
    const callerStep = vi.fn()
    loggedStreamText({ section: 'coach' }, { prompt: 'hi', onStepFinish: callerStep } as never)
    const onStepFinish = streamed.params?.onStepFinish as (ev: unknown) => unknown
    onStepFinish({ n: 1 })
    onStepFinish({ n: 2 })
    expect(stored()).toHaveLength(2)
    // The caller's own callback still runs, once per step.
    expect(callerStep).toHaveBeenCalledTimes(2)

    vi.stubEnv('AI_DEV_DAILY_CALL_LIMIT', '2')
    streamed.params = undefined
    expect(() => loggedStreamText({ section: 'coach' }, { prompt: 'hi' } as never)).toThrow(DevAiBudgetError)
    expect(streamed.params).toBeUndefined()
  })
})
