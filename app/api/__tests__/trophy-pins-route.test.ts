/**
 * #3125 — the trophies a user pins are saved on the account and are what friends see.
 *
 * `PUT /api/user/trophy-pins` stores up to three ids, but only ones the caller has earned: a pin is
 * shown on the public profile, so a direct PUT must not be able to display a trophy that was never
 * unlocked. The unlock state is `computeAchievements`, the one implementation the profile route and
 * the title route also ask.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>

const getTrophyPins = vi.fn(async (_u: string) => null as string[] | null)
const updateTrophyPins = vi.fn(async (_u: string, _p: string[] | null) => true)
const computeAchievements = vi.fn(async (_u: string, _tz: string) => ({ achievements: [] }) as Row)
const limit = vi.fn(() => true)

let sessionUser: { id: string; timezone?: string } | null = null
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))
vi.mock('@/lib/data', () => {
  const repo = async () => ({ getTrophyPins, updateTrophyPins })
  return { getRepository: repo, getRepositoryAsync: repo }
})
vi.mock('@/lib/achievements', () => ({
  computeAchievements: (u: string, tz: string) => computeAchievements(u, tz),
}))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => limit() }))

import { GET, PUT } from '@/app/api/user/trophy-pins/route'

const ME = '00000000-0000-4000-8000-00000000000a'
const earned = (...ids: string[]) => ({
  achievements: ['a', 'b', 'c', 'd', 'locked'].map(id => ({ id, unlocked: id !== 'locked' && (ids.length === 0 || ids.includes(id)) })),
})
const put = (body: unknown, raw?: string) =>
  PUT(new Request('http://localhost/api/user/trophy-pins', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: raw ?? JSON.stringify(body),
  }) as never)

beforeEach(() => {
  vi.clearAllMocks()
  limit.mockReturnValue(true)
  sessionUser = { id: ME, timezone: 'Australia/Brisbane' }
  computeAchievements.mockResolvedValue(earned())
})

describe('PUT /api/user/trophy-pins', () => {
  it('saves earned pins in order', async () => {
    const res = await put({ pins: ['b', 'a'] })
    expect(res.status).toBe(200)
    expect(updateTrophyPins).toHaveBeenCalledWith(ME, ['b', 'a'])
    expect(await res.json()).toEqual({ pins: ['b', 'a'] })
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('refuses a trophy the caller has not unlocked, and writes nothing', async () => {
    const res = await put({ pins: ['a', 'locked'] })
    expect(res.status).toBe(403)
    expect(updateTrophyPins).not.toHaveBeenCalled()
  })

  it('refuses an id that is not an achievement at all', async () => {
    expect((await put({ pins: ['nope'] })).status).toBe(403)
    expect(updateTrophyPins).not.toHaveBeenCalled()
  })

  it('an empty list clears the pins, without asking for unlock state', async () => {
    const res = await put({ pins: [] })
    expect(res.status).toBe(200)
    expect(updateTrophyPins).toHaveBeenCalledWith(ME, null)
    expect(computeAchievements).not.toHaveBeenCalled()
    expect(await res.json()).toEqual({ pins: null })
  })

  it.each([
    ['more than three', { pins: ['a', 'b', 'c', 'd'] }],
    ['a duplicate', { pins: ['a', 'a'] }],
    ['a non-string id', { pins: [1] }],
    ['an empty id', { pins: [''] }],
    ['an extra field', { pins: ['a'], userId: 'someone-else' }],
    ['no pins field', {}],
  ])('rejects %s with 400', async (_name, body) => {
    expect((await put(body)).status).toBe(400)
    expect(updateTrophyPins).not.toHaveBeenCalled()
  })

  it('rejects a body that is not JSON', async () => {
    expect((await put(null, '{nope')).status).toBe(400)
  })

  it('rejects an oversized body with 413', async () => {
    expect((await put({ pins: ['x'.repeat(8000)] })).status).toBe(413)
  })

  it('is rate limited', async () => {
    limit.mockReturnValue(false)
    expect((await put({ pins: ['a'] })).status).toBe(429)
    expect(updateTrophyPins).not.toHaveBeenCalled()
  })

  it('needs a session', async () => {
    sessionUser = null
    expect((await put({ pins: ['a'] })).status).toBe(401)
  })

  it('404s when the user row is gone', async () => {
    updateTrophyPins.mockResolvedValueOnce(false)
    expect((await put({ pins: ['a'] })).status).toBe(404)
  })
})

describe('GET /api/user/trophy-pins', () => {
  it('returns the saved pins, or null', async () => {
    getTrophyPins.mockResolvedValueOnce(['c'])
    expect(await (await GET()).json()).toEqual({ pins: ['c'] })
    expect(await (await GET()).json()).toEqual({ pins: null })
    expect(getTrophyPins).toHaveBeenCalledWith(ME)
  })

  it('needs a session', async () => {
    sessionUser = null
    expect((await GET()).status).toBe(401)
  })

  it('is rate limited, and reads nothing when it is', async () => {
    limit.mockReturnValue(false)
    expect((await GET()).status).toBe(429)
    expect(getTrophyPins).not.toHaveBeenCalled()
  })
})
