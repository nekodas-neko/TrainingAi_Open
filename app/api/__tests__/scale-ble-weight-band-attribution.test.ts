// BF-58 option D: one scale, two people, two phones. Each phone claims only what falls inside its
// own owner's weight band, asks about what it cannot separate, and declines the rest — instead of
// asking about every reading and then discarding the answer.
//
// The three bands and the numbers behind them are documented on SCALE_WEIGHT_CLAIM_PCT
// (lib/scale-ble/composition.ts). These assert the ROUTE's split: which status reaches
// `insertScaleRawSample`, whether the trend row is written, and — the half BF-58 is titled after —
// that the raw frame is stored in **every** branch rather than thrown away.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SCALE_WEIGHT_ANOMALY_PCT, SCALE_WEIGHT_CLAIM_PCT } from '@/lib/scale-ble/composition'
import type { ScaleRawSampleInput } from '@/lib/data/repository'

const insertScaleRawSample = vi.fn(async (_userId: string, _sample: ScaleRawSampleInput) => ({ id: 1 }))
const upsertBodyMetrics = vi.fn()
const getMostRecentConfirmedWeightKg = vi.fn(async (): Promise<number | null> => null)

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: 'u1', timezone: 'Australia/Brisbane' } })),
}))
vi.mock('@/lib/data', () => ({
  getRepositoryAsync: vi.fn(async () => ({
    getUserById: vi.fn(async () => ({ timezone: 'Australia/Brisbane', heightCm: 180, dateOfBirth: '1990-01-01', sex: 'male' })),
    getMostRecentConfirmedWeightKg,
    insertScaleRawSample,
    getConfirmedScaleTrendForDate: vi.fn(async () => null),
    upsertBodyMetrics,
  })),
}))

import { POST } from '@/app/api/scale-ble/samples/route'

const post = async (weightKg: number) => {
  const res = await POST(new Request('http://x/api/scale-ble/samples', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ weightKg, impedanceOhmsA: 500, impedanceOhmsB: 510, rawHex: 'ab12' }),
  }))
  return { res, body: await res.json() as Record<string, unknown> }
}

const statusWritten = () => insertScaleRawSample.mock.calls[0]?.[1]?.status

// His measured anchor: the midpoint of the 70.0–72.8 kg confirmed cluster.
const ANCHOR = 71.0

beforeEach(() => {
  insertScaleRawSample.mockClear()
  upsertBodyMetrics.mockClear()
  getMostRecentConfirmedWeightKg.mockResolvedValue(ANCHOR)
})

describe('POST /api/scale-ble/samples — weight-band attribution (BF-58 option D)', () => {
  it('claims a reading inside the owner\'s band without prompting', async () => {
    const { res, body } = await post(ANCHOR * (1 + SCALE_WEIGHT_CLAIM_PCT / 2))
    expect(res.status).toBe(200)
    expect(body.status).toBe('confirmed')
    expect(statusWritten()).toBe('confirmed')
    expect(upsertBodyMetrics).toHaveBeenCalledTimes(1)
  })

  it('still claims his worst measured day-to-day change (2.85 kg) — no prompt for a real swing', async () => {
    const { body } = await post(ANCHOR - 2.85)
    expect(body.status).toBe('confirmed')
    expect(upsertBodyMetrics).toHaveBeenCalledTimes(1)
  })

  it('asks rather than guesses when a reading is between the two bands', async () => {
    const mid = (SCALE_WEIGHT_CLAIM_PCT + SCALE_WEIGHT_ANOMALY_PCT) / 2
    const { body } = await post(ANCHOR * (1 + mid))
    expect(body.status).toBe('pending')
    expect(statusWritten()).toBe('pending')
    expect(upsertBodyMetrics).not.toHaveBeenCalled()
  })

  it('declines a reading beyond the outer band instead of prompting', async () => {
    const { body } = await post(ANCHOR * (1 + SCALE_WEIGHT_ANOMALY_PCT * 2))
    expect(body.status).toBe('dismissed')
    expect(statusWritten()).toBe('dismissed')
    expect(upsertBodyMetrics).not.toHaveBeenCalled()
  })

  // The case the entry was filed for: the partner's dismissed cluster measured 57.5–58.0 kg against
  // his 70.0–72.8. Under the old single 15% gate this raised "is this you?" every time and threw the
  // reading away on Not me; it must now be declined silently and kept.
  it('declines the partner\'s real cluster without prompting, and keeps the frame', async () => {
    const { body } = await post(57.8)
    expect(body.status).toBe('dismissed')
    expect(insertScaleRawSample).toHaveBeenCalledTimes(1)
    expect(insertScaleRawSample.mock.calls[0][1]).toMatchObject({ rawHex: 'ab12', status: 'dismissed' })
  })

  it('archives the raw frame in all three bands — a declined reading is un-attributed, not destroyed', async () => {
    for (const w of [ANCHOR, ANCHOR * 1.10, 57.8]) {
      insertScaleRawSample.mockClear()
      await post(w)
      expect(insertScaleRawSample).toHaveBeenCalledTimes(1)
      expect(insertScaleRawSample.mock.calls[0][1].rawHex).toBe('ab12')
    }
  })

  it('claims a first reading — with no confirmed weight there is no band to be outside of', async () => {
    getMostRecentConfirmedWeightKg.mockResolvedValue(null)
    const { body } = await post(57.8)
    expect(body.status).toBe('confirmed')
    expect(upsertBodyMetrics).toHaveBeenCalledTimes(1)
  })

  // Where each boundary actually sits, asserted to within 10 g either side rather than by an exact
  // float equality the route's own division would not reproduce.
  it('puts each boundary exactly where the constants say', async () => {
    const GRAMS = 0.01
    const cases = [
      [ANCHOR * (1 + SCALE_WEIGHT_CLAIM_PCT) - GRAMS, 'confirmed'],
      [ANCHOR * (1 + SCALE_WEIGHT_CLAIM_PCT) + GRAMS, 'pending'],
      [ANCHOR * (1 + SCALE_WEIGHT_ANOMALY_PCT) - GRAMS, 'pending'],
      [ANCHOR * (1 + SCALE_WEIGHT_ANOMALY_PCT) + GRAMS, 'dismissed'],
    ] as const

    for (const [weightKg, expected] of cases) {
      insertScaleRawSample.mockClear()
      upsertBodyMetrics.mockClear()
      const { body } = await post(weightKg)
      expect({ weightKg, status: body.status }).toEqual({ weightKg, status: expected })
    }
  })

  it('is symmetric — a light reading is banded the same way as a heavy one', async () => {
    const { body } = await post(ANCHOR * (1 - SCALE_WEIGHT_ANOMALY_PCT * 2))
    expect(body.status).toBe('dismissed')
  })
})
