/**
 * PS-39 — the two routes behind the pending-weigh-in triage, and they are here because the coverage
 * fix (#956) showed they were **believed tested and were not**: what "covered" them was a test
 * borrowing a type from the module, never calling a handler.
 *
 * That matters more for these two than for most. The whole triage was **dead in production** once
 * already (BF-53): a sweep applied the UUID guard to routes whose key is a `bigserial`, so every
 * real request got `400 Invalid id` — a reading that was not the owner's could not be dismissed and
 * one that was could not be confirmed. The correct numeric check sat unreachable on the next line.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const confirmScaleSample = vi.fn(async (_userId: string, _id: number) =>
  null as null | { measuredAt: Date; decoded: Record<string, number> | null })
const dismissScaleSample = vi.fn(async (_userId: string, _id: number) => false)
const getUserById = vi.fn(async (_userId: string) => ({
  id: 'u-1', timezone: 'Australia/Brisbane', dateOfBirth: '1990-01-01', sex: 'male', heightCm: 180,
}) as Record<string, unknown> | null)
const applyScaleReadingToBodyMetrics = vi.fn(async (_repo: unknown, _userId: string, _args: {
  measuredAt: Date; tz: string; weightKg: number; composition: unknown
}) => ({ trendUpdated: true }))

let sessionUser: { id: string } | null = { id: 'u-1' }
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))
vi.mock('@/lib/data', () => ({
  getRepositoryAsync: async () => ({ confirmScaleSample, dismissScaleSample, getUserById }),
  getRepository: async () => ({ confirmScaleSample, dismissScaleSample, getUserById }),
}))
vi.mock('@/lib/scale-ble/apply-reading', () => ({
  applyScaleReadingToBodyMetrics: (r: unknown, u: string, a: never) => applyScaleReadingToBodyMetrics(r, u, a),
}))

import { POST as confirm } from '@/app/api/scale-ble/pending/[id]/confirm/route'
import { POST as dismiss } from '@/app/api/scale-ble/pending/[id]/dismiss/route'

const call = (handler: (req: never, ctx: never) => Promise<Response>, id: string) =>
  handler(new Request('http://localhost/x', { method: 'POST' }) as never,
          { params: Promise.resolve({ id }) } as never)

const reading = (measuredAt: Date) => ({
  measuredAt, decoded: { weightKg: 82.4, impedanceOhmsA: 500, impedanceOhmsB: 520 },
})

beforeEach(() => {
  for (const m of [confirmScaleSample, dismissScaleSample, getUserById, applyScaleReadingToBodyMetrics]) m.mockClear()
  sessionUser = { id: 'u-1' }
  confirmScaleSample.mockResolvedValue(null)
  dismissScaleSample.mockResolvedValue(false)
  getUserById.mockResolvedValue({ id: 'u-1', timezone: 'Australia/Brisbane', dateOfBirth: '1990-01-01', sex: 'male', heightCm: 180 })
  applyScaleReadingToBodyMetrics.mockResolvedValue({ trendUpdated: true })
})

describe('the pending-weigh-in triage accepts a NUMERIC id (BF-53)', () => {
  it('accepts a decimal id on both routes — the whole triage died when this was a UUID guard', async () => {
    confirmScaleSample.mockResolvedValue(reading(new Date('2026-09-01T07:00:00Z')))
    dismissScaleSample.mockResolvedValue(true)

    expect((await call(confirm, '41')).status).toBe(200)
    expect(confirmScaleSample).toHaveBeenCalledWith('u-1', 41)
    expect((await call(dismiss, '41')).status).toBe(200)
    expect(dismissScaleSample).toHaveBeenCalledWith('u-1', 41)
  })

  it('refuses the shapes a bigserial never produces, without reaching the repository', async () => {
    // `Number.isInteger(Number(x))` would accept every one of these.
    for (const bad of ['1e3', '0x10', ' 41 ', '0', '-1', 'abc', '00000000-0000-4000-8000-000000000001']) {
      confirmScaleSample.mockClear()
      const res = await call(confirm, bad)
      expect(res.status, `id ${JSON.stringify(bad)} must be refused`).toBe(400)
      expect(confirmScaleSample).not.toHaveBeenCalled()
    }
  })

  it('refuses without a session', async () => {
    sessionUser = null
    expect((await call(confirm, '41')).status).toBe(401)
    expect((await call(dismiss, '41')).status).toBe(401)
  })

  it('404s a reading that is not the caller\'s, on both routes', async () => {
    expect((await call(confirm, '41')).status).toBe(404)
    expect((await call(dismiss, '41')).status).toBe(404)
  })
})

describe('confirming files the weigh-in against the day it was MEASURED (Q-25)', () => {
  it('uses the reading\'s own measuredAt, never today', async () => {
    // A pending reading is confirmed whenever the owner next opens the app — potentially days after
    // the anomaly gate staged it. Keying the write on today filed it against the wrong day almost
    // every time. Derived from the clock so the fixture cannot expire.
    const measuredAt = new Date(Date.now() - 3 * 86_400_000)
    confirmScaleSample.mockResolvedValue(reading(measuredAt))

    await call(confirm, '41')
    expect(applyScaleReadingToBodyMetrics.mock.calls[0][2].measuredAt).toEqual(measuredAt)
  })

  it('reports WHY composition was skipped, distinguishing impedance from profile', async () => {
    // PS-33 widened this: "skipped" alone cannot tell a bad reading from an incomplete profile, and
    // the two need different things from the user.
    confirmScaleSample.mockResolvedValue({ measuredAt: new Date(), decoded: { weightKg: 82.4, impedanceOhmsA: 0, impedanceOhmsB: 0 } })
    const bad = await (await call(confirm, '41')).json()
    expect(bad.compositionSkipped).toBe(true)
    expect(bad.compositionSkippedReason).toBe('impedance')

    confirmScaleSample.mockResolvedValue(reading(new Date()))
    getUserById.mockResolvedValue({ id: 'u-1', timezone: 'Australia/Brisbane' })   // no dob/sex/height
    const noProfile = await (await call(confirm, '41')).json()
    expect(noProfile.compositionSkipped).toBe(true)
    expect(noProfile.compositionSkippedReason).toBe('profile')
  })

  it('500s a staged row whose decode is incomplete rather than writing a partial weigh-in', async () => {
    confirmScaleSample.mockResolvedValue({ measuredAt: new Date(), decoded: { weightKg: 82.4 } })
    expect((await call(confirm, '41')).status).toBe(500)
    expect(applyScaleReadingToBodyMetrics).not.toHaveBeenCalled()
  })

  it('says the trend was unchanged under the wire name the installed APK still sends', async () => {
    // `isAdditionalReadingForDay` is kept for the shipped client; its meaning is "trend unchanged",
    // which is what the toast copy says. Renaming it server-side would break the installed app.
    confirmScaleSample.mockResolvedValue(reading(new Date()))
    applyScaleReadingToBodyMetrics.mockResolvedValue({ trendUpdated: false })
    expect((await (await call(confirm, '41')).json()).isAdditionalReadingForDay).toBe(true)
  })
})
