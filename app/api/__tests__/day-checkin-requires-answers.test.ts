// `POST /api/day-checkin` with a body of exactly `{}` returned 201 and wrote a row with every
// metric null (Q-465) — indistinguishable from a real check-in in which the user answered nothing.
// Verified by mutation: removing the guard from the route fails the first three cases.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const authMock = vi.fn(async () => ({ user: { id: 'u1', timezone: 'Australia/Brisbane' } }) as unknown)
vi.mock('@/auth', () => ({ auth: () => authMock() }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(() => true) }))

const saveDayCheckin = vi.fn(async () => ({ id: 'c1' }))
vi.mock('@/lib/data', () => ({ getRepository: vi.fn(async () => ({ saveDayCheckin })) }))

import { POST } from '@/app/api/day-checkin/route'

const post = (body: unknown) => POST(new Request('http://x/api/day-checkin', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
}))

describe('POST /api/day-checkin — a check-in has to say something', () => {
  beforeEach(() => { saveDayCheckin.mockClear() })

  it('refuses an empty body, and writes nothing', async () => {
    const res = await post({})
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Check-in carries no answers')
    expect(saveDayCheckin).not.toHaveBeenCalled()
  })

  it('refuses a body that is only addressing', async () => {
    expect((await post({ phase: 'morning', date: '2026-08-23' })).status).toBe(400)
    expect(saveDayCheckin).not.toHaveBeenCalled()
  })

  it('refuses the touched flags on their own', async () => {
    expect((await post({ perceivedRecoveryTouched: true, sleepQualityFeelTouched: true })).status).toBe(400)
    expect(saveDayCheckin).not.toHaveBeenCalled()
  })

  it('accepts what the morning sheet sends', async () => {
    const res = await post({
      phase: 'morning', perceivedRecovery: 3, sleepQualityFeel: 3,
      perceivedRecoveryTouched: false, sleepQualityFeelTouched: false,
      illnessContext: null, motivation: null, restingSoreness: null, wakeMood: null,
      soreMuscles: [], journal: null,
    })
    expect(res.status).toBe(201)
    expect(saveDayCheckin).toHaveBeenCalledTimes(1)
  })

  it('accepts a journal with no scales at all', async () => {
    expect((await post({ journal: 'slept badly' })).status).toBe(201)
    expect(saveDayCheckin).toHaveBeenCalledTimes(1)
  })
})
