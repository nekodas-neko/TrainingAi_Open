import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { APICallError } from 'ai'

const insertErrorEvent = vi.fn(async (_e: unknown) => {})
vi.mock('@/lib/data', () => ({
  getRepository: async () => ({ insertAiCallLog: async () => {} }),
  getRepositoryAsync: async () => ({ insertErrorEvent }),
}))

import {
  isAiBillingError, aiPausedResponse, noteAiBillingError, resetAiPausedSignalForTests,
  AI_PAUSED_CODE, AI_PAUSED_SIGNAL_PREFIX,
} from '../provider-paused'
import { withAiLogging } from '../instrument'

const OWNER = '11111111-2222-3333-4444-555555555555'
const apiError = (statusCode: number, message: string, responseBody?: string) =>
  new APICallError({ message, url: 'https://example.test', requestBodyValues: {}, statusCode, responseBody })
const flush = () => new Promise(r => setTimeout(r, 0))

// The wording Google returned on 2026-10-11, from the issue.
const DEPLETED = apiError(402, 'Your prepayment credits are depleted. Please go to AI Studio.', '{"error":{"status":"RESOURCE_EXHAUSTED"}}')

beforeEach(() => {
  insertErrorEvent.mockClear()
  resetAiPausedSignalForTests()
  vi.stubEnv('CLAUDE_RO_OWNER_USER_ID', OWNER)
})
afterEach(() => vi.unstubAllEnvs())

describe('isAiBillingError — a refusal about the account, not the request', () => {
  it('recognises the depleted-credits 402 from 10-11', () => {
    expect(isAiBillingError(DEPLETED)).toBe(true)
  })

  it('treats any 402 as billing', () => {
    expect(isAiBillingError(apiError(402, 'anything'))).toBe(true)
  })

  it('recognises quota and billing wording on 400, 403 and 429', () => {
    expect(isAiBillingError(apiError(429, 'You exceeded your current quota, please check your plan and billing details.'))).toBe(true)
    expect(isAiBillingError(apiError(403, 'Billing is not enabled for this project'))).toBe(true)
    expect(isAiBillingError(apiError(400, 'x', '{"message":"prepayment credits are depleted"}'))).toBe(true)
  })

  it('leaves a plain rate limit, a 5xx, a bad request and a non-API error alone', () => {
    expect(isAiBillingError(apiError(429, 'Resource has been exhausted (e.g. check quota).'.replace('quota', 'limits')))).toBe(false)
    expect(isAiBillingError(apiError(500, 'internal'))).toBe(false)
    expect(isAiBillingError(apiError(400, 'Invalid JSON payload'))).toBe(false)
    expect(isAiBillingError(new Error('Your prepayment credits are depleted'))).toBe(false)
    expect(isAiBillingError(null)).toBe(false)
  })

  it('finds the provider error under a wrapper', () => {
    expect(isAiBillingError(new Error('wrapped', { cause: DEPLETED }))).toBe(true)
  })
})

describe('aiPausedResponse', () => {
  it('is a 503 that says nothing is the person\'s doing and carries a code to key on', async () => {
    const res = aiPausedResponse(DEPLETED)!
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.code).toBe(AI_PAUSED_CODE)
    expect(body.error).toMatch(/paused/i)
    expect(body.error).not.toMatch(/try again/i)
  })

  it('is null for every other error, so the route keeps its own answer', () => {
    expect(aiPausedResponse(new Error('boom'))).toBeNull()
    expect(aiPausedResponse(apiError(500, 'internal'))).toBeNull()
  })
})

describe('noteAiBillingError — one owner-visible row an hour', () => {
  it('writes an error_events row under the OWNER, not the caller', async () => {
    expect(noteAiBillingError(DEPLETED, 1_000)).toBe(true)
    await flush()
    expect(insertErrorEvent).toHaveBeenCalledTimes(1)
    const row = insertErrorEvent.mock.calls[0][0] as { userId: string; message: string; source: string }
    expect(row.userId).toBe(OWNER)
    expect(row.source).toBe('server')
    expect(row.message.startsWith(AI_PAUSED_SIGNAL_PREFIX)).toBe(true)
    expect(row.message).toContain('HTTP 402')
    expect(row.message).toContain('prepayment credits are depleted')
  })

  it('writes nothing for an ordinary error', async () => {
    expect(noteAiBillingError(new Error('boom'))).toBe(false)
    await flush()
    expect(insertErrorEvent).not.toHaveBeenCalled()
  })

  it('at most once an hour: a burst leaves one row, the next hour another', async () => {
    const hour = 60 * 60 * 1000
    for (let i = 0; i < 50; i++) noteAiBillingError(DEPLETED, 10_000 + i * 1000)
    await flush()
    expect(insertErrorEvent).toHaveBeenCalledTimes(1)
    noteAiBillingError(DEPLETED, 10_000 + hour + 1)
    await flush()
    expect(insertErrorEvent).toHaveBeenCalledTimes(2)
  })
})

describe('the AI chokepoint raises the signal for every route', () => {
  it('withAiLogging records a billing refusal and rethrows the original error', async () => {
    await expect(withAiLogging({ section: 'x', userId: 'someone-else' }, async () => { throw DEPLETED })).rejects.toBe(DEPLETED)
    await flush()
    const rows = insertErrorEvent.mock.calls.map(c => c[0] as { userId: string; message: string })
    expect(rows).toHaveLength(1)
    // not under the user who happened to trigger it
    expect(rows[0].userId).toBe(OWNER)
  })

  it('does not signal a transient failure', async () => {
    await expect(withAiLogging({ section: 'x' }, async () => { throw apiError(400, 'Invalid JSON payload') }, () => false)).rejects.toThrow()
    await flush()
    expect(insertErrorEvent).not.toHaveBeenCalled()
  })
})

/**
 * Discovery, not a list: any route that calls the logged AI chokepoint must answer a billing
 * failure with the paused notice, or a new AI route reintroduces "try again" for a dead balance.
 */
describe('every AI route answers a billing failure with the paused notice', () => {
  const ROOT = path.resolve(__dirname, '../../..')
  const walk = (dir: string): string[] =>
    readdirSync(dir).filter(n => n !== '__check_fixture__').flatMap(n => {
      const p = path.join(dir, n)
      return statSync(p).isDirectory() ? walk(p) : p.endsWith('route.ts') ? [p] : []
    })
  const routes = walk(path.join(ROOT, 'app/api')).filter(p => /loggedGenerate(Object|Text)|loggedStreamText|withAiLogging/.test(readFileSync(p, 'utf8')))

  it('finds the AI routes', () => {
    expect(routes.length).toBeGreaterThanOrEqual(10)
  })

  it.each(routes.map(p => [path.relative(ROOT, p), p]))('%s', (_rel, p) => {
    expect(readFileSync(p as string, 'utf8')).toMatch(/aiPausedResponse\(/)
  })
})
