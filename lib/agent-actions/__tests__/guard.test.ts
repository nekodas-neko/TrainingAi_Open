// Issue 2381 (part b): the agent key's guard, without a database. It must refuse a missing, wrong,
// unconfigured or too-short key, never accept a session cookie, compare in constant time, and
// rate-limit attempts per IP before the compare.
import { describe, it, expect, beforeEach, vi } from 'vitest'

const compare = vi.fn((a: string, b: string) => a === b)
vi.mock('@/lib/security/constant-time', () => ({ safeCompare: (a: string, b: string) => compare(a, b) }))
let allow = true
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => allow }))

import { authorizeAgentRequest, AGENT_SECRET_MIN_LENGTH } from '../guard'

const KEY = 'k'.repeat(AGENT_SECRET_MIN_LENGTH)
const OWNER = '00000000-0000-4000-8000-000000238121'
const request = (headers: Record<string, string>) => new Request('http://localhost/api/agent-actions', { headers })

describe('authorizeAgentRequest', () => {
  beforeEach(() => {
    process.env.AGENT_ACTIONS_SECRET = KEY
    process.env.ADMIN_EXPORT_USER_ID = OWNER
    allow = true
    compare.mockClear()
  })

  it('accepts the key and names the owner account', () => {
    expect(authorizeAgentRequest(request({ authorization: `Bearer ${KEY}` }))).toEqual({ ok: true, ownerUserId: OWNER })
    expect(compare).toHaveBeenCalledWith(KEY, KEY)
  })

  it.each([
    ['no header', {}],
    ['a wrong key', { authorization: `Bearer ${'x'.repeat(AGENT_SECRET_MIN_LENGTH)}` }],
    ['a cookie only', { cookie: 'authjs.session-token=abc' }],
    ['Basic auth', { authorization: `Basic ${KEY}` }],
    ['a key with a trailing word', { authorization: `Bearer ${KEY} extra` }],
  ])('refuses %s', (_l, headers) => {
    expect(authorizeAgentRequest(request(headers as Record<string, string>))).toMatchObject({ ok: false, status: 401 })
  })

  it('fails closed when the secret is unset or shorter than the minimum, without comparing', () => {
    delete process.env.AGENT_ACTIONS_SECRET
    expect(authorizeAgentRequest(request({ authorization: `Bearer ${KEY}` })).ok).toBe(false)
    process.env.AGENT_ACTIONS_SECRET = 'k'.repeat(AGENT_SECRET_MIN_LENGTH - 1)
    expect(authorizeAgentRequest(request({ authorization: `Bearer ${process.env.AGENT_ACTIONS_SECRET}` })).ok).toBe(false)
    expect(compare).not.toHaveBeenCalled()
  })

  it('refuses the right key once the per-IP limit has tripped, before comparing', () => {
    allow = false
    expect(authorizeAgentRequest(request({ authorization: `Bearer ${KEY}` })).ok).toBe(false)
    expect(compare).not.toHaveBeenCalled()
  })
})
