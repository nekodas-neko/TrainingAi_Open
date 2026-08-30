// PS-15 at the route boundary — the half that actually shipped broken.
//
// `lib/health/__tests__/device-comparison-phase-units.test.ts` proves the maths; this proves the
// WIRING, because the bug was never in the maths. The module has said *"bucket to the COARSEST
// cadence"* since it was written and the route passed a constant five minutes, so Oura's stress
// buckets (:15/:45) and the Colmi's (:00/:30) could not share a bucket at any point in history.
//
// Fixtures are on a fixed UTC day and the window params name that same day — both sides fixed, so
// this is not a rolling-window time bomb. The route derives no window of its own.
import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'

const DAY = '2026-08-27'

/** Half-hourly samples at `offsetMin` past the hour, from midday on DAY. */
const halfHourly = (offsetMin: number, values: number[]) =>
  values.map((value, i) => ({
    at: new Date(Date.UTC(2026, 7, 27, 12, 0) + i * 30 * 60_000 + offsetMin * 60_000),
    value,
  }))

// The real production phases and the real scales: Oura normalised −1..+1, Colmi raw 0..100.
const ouraStress  = halfHourly(15, [0.10, 0.30, -0.20, 0.50, 0.05, -0.40, 0.25, 0.60])
const colmiStress = halfHourly(0,  [  42,   55,    38,   61,   40,    33,   48,   65])

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: 'u1', isAdmin: true, timezone: 'Australia/Brisbane' } })),
}))
vi.mock('@/lib/admin', () => ({
  requireAdmin: vi.fn(async () => undefined),
  adminErrorResponse: vi.fn(() => new Response('nope', { status: 403 })),
}))
vi.mock('@/lib/data', () => ({
  getRepository: vi.fn(async () => ({
    getOuraDaytimeStressBuckets: vi.fn(async () => ouraStress.map(r => ({ bucketStart: r.at, level: r.value }))),
    getColmiReadings: vi.fn(async () => colmiStress.map(r => ({ measuredAt: r.at, value: r.value }))),
    getOuraHeartrateBySource: vi.fn(async () => []),
  })),
}))

import { GET } from '@/app/api/admin/device-comparison/route'

const get = async (qs: string) => {
  const res = await GET(new NextRequest(`http://localhost/api/admin/device-comparison?from=${DAY}&to=${DAY}&${qs}`))
  return { status: res.status, body: await res.json() }
}

describe('the bucket width comes from the data (PS-15)', () => {
  it('derives thirty minutes from two half-hourly series, and says it derived it', async () => {
    const { body } = await get('metric=stress')
    expect(body.bucketMinutes).toBe(30)
    expect(body.bucketSource).toBe('derived-from-cadence')
    expect(body.derivedMinutes).toBe(30)
  })

  // The finding the entry was filed for: on the constant five-minute grid these two never met.
  it('pairs all eight buckets, where the shipped five-minute grid paired none', async () => {
    const { body } = await get('metric=stress')
    const pair = body.pairs[0]
    expect(pair.verdict).toBe('compared')
    expect(pair.overlap).toBe(8)

    const shipped = await get('metric=stress&bucket=5')
    expect(shipped.body.pairs[0].overlap).toBe(0)
    expect(shipped.body.pairs[0].verdict).toBe('out-of-phase')
  })

  it('lets an explicit bucket win, and reports that it was asked for', async () => {
    const { body } = await get('metric=stress&bucket=60')
    expect(body.bucketMinutes).toBe(60)
    expect(body.bucketSource).toBe('requested')
    // Still reports what the data would have chosen, so the two are distinguishable.
    expect(body.derivedMinutes).toBe(30)
  })
})

describe('mixed units are declared and suppressed (PS-15)', () => {
  it('names both units and reports no magnitude across them', async () => {
    const { body } = await get('metric=stress')
    expect(body.units).toEqual({ oura_ring: 'normalised_-1..1', colmi_ring: 'raw_0..100' })
    const pair = body.pairs[0]
    expect(pair.meanBias).toBeNull()
    expect(pair.meanAbsDelta).toBeNull()
    expect(pair.unitsDiffer).toBe('normalised_-1..1 vs raw_0..100')
    expect(pair.spearman).not.toBeNull()
  })
})

describe('the metric parameter', () => {
  it('rejects one it does not know rather than silently comparing heart rate', async () => {
    const { status, body } = await get('metric=steps')
    expect(status).toBe(400)
    // Names what it DOES accept — and steps is deliberately not among them until PS-16 settles
    // whether the Colmi's activity buckets are cumulative.
    expect(body.error).toBe('Unknown metric — one of heart_rate, stress')
  })

  it('defaults to heart rate', async () => {
    const { body } = await get('')
    expect(body.metric).toBe('heart_rate')
    expect(body.devices).toEqual(['oura_ring', 'chest_strap', 'colmi_ring'])
  })
})
