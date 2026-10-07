/**
 * #2579 — `GET /api/oura-ble/rollup-watermark`. The device marks raw rows "folded on the server" from
 * this value, so it must answer only for the caller, refuse anything it was not built to take, and
 * say "nothing is folded" (null) rather than guess.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const getSleepCoverageEnd = vi.fn(async (..._a: unknown[]) => null as Date | null)

let sessionUser: { id: string } | null = { id: 'u-1' }
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))
vi.mock('@/lib/data', () => {
  const repo = async () => ({ getSleepCoverageEnd })
  return { getRepository: repo, getRepositoryAsync: repo }
})

import { GET } from '@/app/api/oura-ble/rollup-watermark/route'

const call = (qs = '') => GET(new Request(`http://localhost/api/oura-ble/rollup-watermark${qs}`))

let seq = 0
beforeEach(() => {
  vi.clearAllMocks()
  sessionUser = { id: `wm-u-${++seq}` }   // a fresh user each test, so the rate limiter cannot leak between them
  getSleepCoverageEnd.mockResolvedValue(null)
})

describe('/api/oura-ble/rollup-watermark', () => {
  it('refuses without a session, before reading anything', async () => {
    sessionUser = null
    expect((await call()).status).toBe(401)
    expect(getSleepCoverageEnd).not.toHaveBeenCalled()
  })

  it("returns the caller's own watermark in wall-clock ms", async () => {
    const at = new Date('2026-10-06T20:15:00.000Z')
    getSleepCoverageEnd.mockResolvedValue(at)
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ rolledThroughMs: at.getTime() })
    expect(getSleepCoverageEnd).toHaveBeenCalledTimes(1)
    expect(getSleepCoverageEnd).toHaveBeenCalledWith(sessionUser!.id)
  })

  // No completed rollup, or a watermark from an earlier clock epoch: nothing is known to be folded.
  it('answers null when nothing is folded', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ rolledThroughMs: null })
  })

  it('answers null rather than a non-number for an invalid date', async () => {
    getSleepCoverageEnd.mockResolvedValue(new Date(Number.NaN))
    expect(await (await call()).json()).toEqual({ rolledThroughMs: null })
  })

  // There is no way to ask about another user: the route takes no parameters, and says so instead
  // of ignoring one.
  it('rejects any query parameter — a userId above all — without reading', async () => {
    for (const qs of ['?userId=someone-else', '?since=0', '?x=1']) {
      expect((await call(qs)).status).toBe(400)
    }
    expect(getSleepCoverageEnd).not.toHaveBeenCalled()
  })

  it('forbids caching', async () => {
    expect((await call()).headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('rate-limits a runaway caller', async () => {
    let limited = 0
    for (let i = 0; i < 40; i++) if ((await call()).status === 429) limited++
    expect(limited).toBeGreaterThan(0)
  })
})
