/**
 * Q-91-followup — `GET /api/oura-ble/rollup-state`. A single-row read of the rollup watermark, so a
 * client that has seen a drain finish can wait for the DERIVATION rather than guess at its duration.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const getOuraRollupState = vi.fn(async (..._a: unknown[]) => null as { lastRolledDs: number; epoch: number } | null)

let sessionUser: { id: string } | null = { id: 'u-1' }
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))
vi.mock('@/lib/data', () => {
  const repo = async () => ({ getOuraRollupState })
  return { getRepository: repo, getRepositoryAsync: repo }
})

import { GET } from '@/app/api/oura-ble/rollup-state/route'

const call = () => GET()

let seq = 0
beforeEach(() => {
  vi.clearAllMocks()
  sessionUser = { id: `u-${++seq}` }   // a fresh user each test, so the rate limiter cannot leak between them
  getOuraRollupState.mockResolvedValue(null)
})

describe('/api/oura-ble/rollup-state', () => {
  it('refuses without a session', async () => {
    sessionUser = null
    expect((await call()).status).toBe(401)
    expect(getOuraRollupState).not.toHaveBeenCalled()
  })

  it('returns the watermark and its epoch, scoped to the caller', async () => {
    getOuraRollupState.mockResolvedValue({ lastRolledDs: 91_234, epoch: 3 })

    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ lastRolledDs: 91_234, epoch: 3 })
    expect(getOuraRollupState).toHaveBeenCalledWith(sessionUser!.id)
  })

  // Before the first successful rollup there is no row. That is a state, not an error — the client
  // reads an absent baseline as "any watermark counts as progress".
  it('answers 200 with nulls when no rollup has ever succeeded', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ lastRolledDs: null, epoch: null })
  })

  // This endpoint is POLLED, so it must not be cached anywhere: an HTTP-cached response would make
  // the client wait out its whole schedule re-reading one stale number.
  it('forbids caching', async () => {
    expect((await call()).headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('rate-limits a runaway poll', async () => {
    getOuraRollupState.mockResolvedValue({ lastRolledDs: 1, epoch: 1 })
    let limited = 0
    for (let i = 0; i < 70; i++) if ((await call()).status === 429) limited++
    expect(limited).toBeGreaterThan(0)
  })
})
