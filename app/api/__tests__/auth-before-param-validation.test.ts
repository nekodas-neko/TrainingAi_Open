// Three routes answered a question before establishing the caller was anyone (Q-454), found by
// calling all 122 GET routes anonymously. None leaked data — supply the missing param and both
// param routes returned 401 — but the stated rule is that security checks fail closed and fail
// *first*, and the pre-auth code is cheap to reorder now and expensive the day someone adds a
// param handler above the `auth()` call that touches the DB.
//
// The assertion is deliberately "anonymous gets 401 whatever the params are", not "the reorder
// happened": the property is what matters, and it survives the handler being rewritten.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const authMock = vi.fn(async () => null as unknown)
vi.mock('@/auth', () => ({ auth: () => authMock() }))

const getRepository = vi.fn(async () => { throw new Error('repository must not be reached anonymously') })
vi.mock('@/lib/data', () => ({ getRepository: () => getRepository() }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(() => true) }))

import { NextRequest } from 'next/server'

async function statusAndBody(res: Response) {
  return { status: res.status, body: await res.json() as { error?: string } }
}

describe('anonymous callers are refused before any parameter question is answered', () => {
  beforeEach(() => { authMock.mockReset().mockResolvedValue(null); getRepository.mockClear() })

  it('GET /api/day-log — no date', async () => {
    const { GET } = await import('@/app/api/day-log/route')
    const { status, body } = await statusAndBody(await GET(new NextRequest('http://x/api/day-log')))
    expect(status).toBe(401)
    expect(body.error).toBe('Unauthorized')
  })

  it('GET /api/day-log — malformed date', async () => {
    const { GET } = await import('@/app/api/day-log/route')
    const { status } = await statusAndBody(await GET(new NextRequest('http://x/api/day-log?date=banana')))
    expect(status).toBe(401)
  })

  it('GET /api/exercise-history — no name', async () => {
    const { GET } = await import('@/app/api/exercise-history/route')
    const { status, body } = await statusAndBody(await GET(new NextRequest('http://x/api/exercise-history')))
    expect(status).toBe(401)
    expect(body.error).toBe('Unauthorized')
  })

  it('reaches the repository for none of them', async () => {
    expect(getRepository).not.toHaveBeenCalled()
  })
})
