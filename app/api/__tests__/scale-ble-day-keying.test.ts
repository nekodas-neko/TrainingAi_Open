// Q-25(b): the scale routes archived the raw sample under its real `measuredAt` but keyed the
// body_metrics trend row on todayInTz() — so a weigh-in captured while the phone was offline and
// pushed later landed on today, overwriting today's real weight and leaving its own day blank.
// These assert the ROUTE wiring (which day reaches upsertBodyMetrics), not just the date helper.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { formatInTimeZone } from 'date-fns-tz'

const upsertBodyMetrics = vi.fn()
const getConfirmedScaleTrendForDate = vi.fn(async (): Promise<{ weightKg: number } | null> => null)

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: 'u1', timezone: 'Australia/Brisbane' } })),
}))
vi.mock('@/lib/data', () => ({
  getRepositoryAsync: vi.fn(async () => ({
    getUserById: vi.fn(async () => ({ timezone: 'Australia/Brisbane', heightCm: 180, dateOfBirth: '1990-01-01', sex: 'male' })),
    // No prior weight → the anomaly gate passes and the confirmed path runs.
    getMostRecentConfirmedWeightKg: vi.fn(async () => null),
    insertScaleRawSample: vi.fn(),
    getConfirmedScaleTrendForDate,
    upsertBodyMetrics,
  })),
}))

import { POST } from '@/app/api/scale-ble/samples/route'

const post = (body: unknown) => POST(new Request('http://x/api/scale-ble/samples', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}))

const reading = (measuredAt?: string) => ({
  weightKg: 82.5, impedanceOhmsA: 500, impedanceOhmsB: 510, rawHex: 'ab12', ...(measuredAt ? { measuredAt } : {}),
})

// Two days back at 22:00 UTC — 08:00 the next morning in Brisbane, so it exercises the case where
// the UTC and local days differ.
//
// **Derived from the clock, never hardcoded.** The route clamps anything older than
// `INGEST_PAST_TOLERANCE_MS` (7 days) to `now`, so a fixed date silently ages out of the window and
// the test starts failing on a date nobody chose. That is exactly what happened: it was pinned to
// `2026-07-27T22:00:00Z`, and at 22:00 UTC on 2026-08-03 it crossed the seven-day line and began
// failing on every branch, `main` included.
const backdated = (() => {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - 2)
  d.setUTCHours(22, 0, 0, 0)
  return d
})()
const backdatedIso = backdated.toISOString()
const backdatedLocalDay = formatInTimeZone(backdated, 'Australia/Brisbane', 'yyyy-MM-dd')

describe('POST /api/scale-ble/samples — the trend row is keyed to the day of the weigh-in', () => {
  beforeEach(() => { upsertBodyMetrics.mockClear(); getConfirmedScaleTrendForDate.mockClear() })

  it('files a backdated reading on its own local day, not the day it was received', async () => {
    const res = await post(reading(backdatedIso))
    expect(res.status).toBe(200)

    expect(upsertBodyMetrics).toHaveBeenCalledTimes(1)
    expect(upsertBodyMetrics.mock.calls[0][1][0].date).toBe(backdatedLocalDay)
    // The trend lookup must ask about the SAME day it writes, or a second backdated reading
    // would compare against the wrong day's value.
    expect(getConfirmedScaleTrendForDate.mock.calls[0][1]).toBe(backdatedLocalDay)
  })

  it('still writes the day-of when measuredAt is omitted', async () => {
    const res = await post(reading())
    expect(res.status).toBe(200)
    const written = upsertBodyMetrics.mock.calls[0][1][0].date
    expect(written).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(written).toBe(getConfirmedScaleTrendForDate.mock.calls[0][1])
  })

  it('leaves the day untouched when that day already has a LOWER scale reading', async () => {
    getConfirmedScaleTrendForDate.mockResolvedValueOnce({ weightKg: 70 })
    const res = await post(reading(backdatedIso))   // reading() weighs more than 70
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ isAdditionalReadingForDay: true })
    expect(upsertBodyMetrics).not.toHaveBeenCalled()
  })

  it('replaces the day when the new reading is LOWER, and reports the trend as changed', async () => {
    // Q-69. `isAdditionalReadingForDay` is the wire name the installed APK reads to render
    // "Additional reading today" — it must be FALSE here, because this reading did become the
    // trend and that copy would be a lie.
    getConfirmedScaleTrendForDate.mockResolvedValueOnce({ weightKg: 999 })
    const res = await post(reading(backdatedIso))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ isAdditionalReadingForDay: false })
    expect(upsertBodyMetrics).toHaveBeenCalledTimes(1)
    expect(upsertBodyMetrics.mock.calls[0][1][0].date).toBe(backdatedLocalDay)
  })
})
