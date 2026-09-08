/**
 * PS-39 — `/api/nutrition/energy-balance` was believed tested and was not (#956): what "covered" it
 * was `import type { EnergyBalanceResponse }` in a component test, which borrows the response type
 * and calls nothing.
 *
 * It is a thin route, and the two things it decides are both ones this repo has broken before: which
 * day it answers for, and whether the answer may be cached.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { todayInTz } from '@trainingai/shared/date-utils'

const computeEnergyBalance = vi.fn(async (_repo: unknown, _userId: string, _tz: string, _date: string) =>
  ({ intakeKcal: 0, activeKcal: 0 }) as Record<string, unknown>)

let sessionUser: { id: string; timezone?: string } | null = { id: 'u-1', timezone: 'Australia/Brisbane' }
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))
vi.mock('@/lib/data', () => ({ getRepository: async () => ({}), getRepositoryAsync: async () => ({}) }))
vi.mock('@/lib/health/energy-balance-service', () => ({
  computeEnergyBalance: (r: unknown, u: string, tz: string, d: string) => computeEnergyBalance(r, u, tz, d),
}))

import { GET } from '@/app/api/nutrition/energy-balance/route'

const get = (qs = '') => GET(new NextRequest(`http://localhost/api/nutrition/energy-balance${qs}`))

beforeEach(() => {
  computeEnergyBalance.mockClear()
  computeEnergyBalance.mockResolvedValue({ intakeKcal: 2014, activeKcal: 551 })
  sessionUser = { id: 'u-1', timezone: 'Australia/Brisbane' }
})

describe('GET /api/nutrition/energy-balance', () => {
  it('refuses without a session', async () => {
    sessionUser = null
    expect((await get('?date=2026-09-01')).status).toBe(401)
    expect(computeEnergyBalance).not.toHaveBeenCalled()
  })

  it('accepts the slash form the client actually sends', async () => {
    // `localDateString()` emits `YYYY/MM/DD`; a dash-only guard rejects every real request before
    // the handler runs, which is how ai-chat's localDate shipped broken for a full release.
    expect((await get('?date=2026/09/01')).status).toBe(200)
    expect(computeEnergyBalance.mock.calls[0][3]).toBe('2026-09-01')
  })

  it('defaults to today in the USER\'s timezone, not the server\'s', async () => {
    // Deliberately a non-default zone: with Brisbane this assertion passes against a route that
    // hardcodes DEFAULT_TZ, which is the vacuous shape a mutation check caught earlier in PS-39.
    sessionUser = { id: 'u-1', timezone: 'America/New_York' }
    await get()
    const [, , tz, date] = computeEnergyBalance.mock.calls[0]
    expect(tz).toBe('America/New_York')
    expect(date).toBe(todayInTz('America/New_York'))
  })

  it('rejects a malformed date rather than computing against a bad day', async () => {
    expect((await get('?date=not-a-date')).status).toBe(400)
    expect(computeEnergyBalance).not.toHaveBeenCalled()
  })

  it('is never served from a cache — it folds live today totals', async () => {
    // The header is the deliberate difference from the sibling SWR route: this response mixes
    // today's intake and activity, both of which move during the day.
    expect((await get('?date=2026-09-01')).headers.get('Cache-Control')).toBe('private, no-store')
  })
})
