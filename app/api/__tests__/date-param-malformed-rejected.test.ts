// A normaliser's `null` means two different things, and reading it as one is Q-453.
//
// `(raw ? normalize(raw) : null) ?? today` collapses **absent** (default to today, which the caller
// asked for by omitting the param) with **present but malformed** (a caller who asked for a
// specific day and mistyped it). Measured live across all 11 routes reading a date param: nine
// returned 400, `/api/oura/hr-window` takes start/end, and `/api/training-stress` returned **200**
// — the 17th's numbers for a request naming the 10th, with no echo of which date it answered for.
//
// The sibling sweep found exactly one more, `/api/zone-minutes`, where a range makes it worse: a
// mistyped `from` silently widened the window to 30 days.
//
// Verified by mutation: restoring either `?? default` fails the malformed cases here.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const authMock = vi.fn(async () => ({ user: { id: 'u1', timezone: 'Australia/Brisbane' } }) as unknown)
vi.mock('@/auth', () => ({ auth: () => authMock() }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(() => true) }))

// Reaching the repository at all means the malformed param got past the guard, so the mock throws
// rather than returning a plausible empty result — a silent 200 is exactly the bug.
const getRepository = vi.fn(async () => { throw new Error('repository reached with an unvalidated date') })
vi.mock('@/lib/data', () => ({ getRepository: () => getRepository(), getRepositoryAsync: () => getRepository() }))

// `?date=` (empty) is deliberately NOT here: `searchParams.get` returns '', which is falsy, so it
// takes the absent branch — indistinguishable from omitting the param at this layer, and every
// sibling route treats it the same way.
const MALFORMED = ['not-a-date', '2026-13-45', '2026-02-30', 'null', '2026/8/1x']

describe('a present-but-malformed date param is rejected, not defaulted', () => {
  beforeEach(() => { getRepository.mockClear() })

  it('GET /api/training-stress', async () => {
    const { GET } = await import('@/app/api/training-stress/route')
    for (const d of MALFORMED) {
      const res = await GET(new Request(`http://x/api/training-stress?date=${encodeURIComponent(d)}`))
      expect(res.status, `date=${JSON.stringify(d)}`).toBe(400)
      expect((await res.json()).error).toBe('Invalid date')
    }
    expect(getRepository).not.toHaveBeenCalled()
  })

  it('GET /api/zone-minutes — either end of the range', async () => {
    const { GET } = await import('@/app/api/zone-minutes/route')
    for (const d of MALFORMED) {
      const to = await GET(new NextRequest(`http://x/api/zone-minutes?to=${encodeURIComponent(d)}`))
      expect(to.status, `to=${JSON.stringify(d)}`).toBe(400)
      const from = await GET(new NextRequest(`http://x/api/zone-minutes?from=${encodeURIComponent(d)}`))
      expect(from.status, `from=${JSON.stringify(d)}`).toBe(400)
    }
    expect(getRepository).not.toHaveBeenCalled()
  })
})

describe('an ABSENT date param still defaults, which is the case worth not breaking', () => {
  it('reaches the repository rather than 400ing', async () => {
    // The distinction the fix rests on: omitting the param is a request for today, and must keep
    // working. The repository mock throws, so reaching it is the assertion.
    const { GET } = await import('@/app/api/training-stress/route')
    await expect(GET(new Request('http://x/api/training-stress'))).rejects.toThrow(/repository reached/)
  })
})
