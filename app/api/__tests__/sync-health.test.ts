import { describe, it, expect, vi, beforeEach } from 'vitest'

// `activityTypes` is per-test so the seeded vocabulary can be varied — the guard's behaviour
// depends on whether the fallback row itself exists, which is the branch a fixed mock can't reach.
const mockRepo = vi.hoisted(() => ({
  activityTypes: [] as { id: string }[],
  saveActivityLog: vi.fn(),
  upsertBodyMetrics: vi.fn(),
  upsertAggregatorHeartrate: vi.fn(),
  upsertHealthConnectIntervals: vi.fn(async (_u: string, rows: unknown[]) => rows.length),
}))

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: 'u1', timezone: 'Australia/Brisbane' } })),
}))
vi.mock('@/lib/data', () => ({
  getRepositoryAsync: vi.fn(async () => ({
    upsertBodyMetrics: mockRepo.upsertBodyMetrics,
    upsertAggregatorHeartrate: mockRepo.upsertAggregatorHeartrate,
    upsertHealthConnectIntervals: mockRepo.upsertHealthConnectIntervals,
    saveActivityLog: mockRepo.saveActivityLog,
    saveSleepSession: vi.fn(),
    listActivityLogs: vi.fn(async () => []),
    listActivityTypes: vi.fn(async () => mockRepo.activityTypes),
  })),
}))

import { POST } from '@/app/api/sync-health/route'
import { NextRequest } from 'next/server'

const post = (body: unknown) => POST(new NextRequest('http://x/api/sync-health', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}))

describe('POST /api/sync-health validation', () => {
  it('400s when a daily metric has a non-numeric weight', async () => {
    const res = await post({ dailyMetrics: [{ date: '2026-07-01', weightKg: 'heavy' }] })
    expect(res.status).toBe(400)
  })

  it('400s when the dailyMetrics array exceeds the item cap', async () => {
    const res = await post({ dailyMetrics: Array.from({ length: 401 }, () => ({ date: '2026-07-01' })) })
    expect(res.status).toBe(400)
  })

  it('400s on an out-of-range value (weight > 500)', async () => {
    const res = await post({ dailyMetrics: [{ date: '2026-07-01', weightKg: 9000 }] })
    expect(res.status).toBe(400)
  })

  it('400s on an unknown extra field (strict)', async () => {
    const res = await post({ dailyMetrics: [{ date: '2026-07-01', weightKg: 80, bogus: 1 }] })
    expect(res.status).toBe(400)
  })

  it('400s on a non-JSON / null body (fail closed)', async () => {
    const res = await POST(new NextRequest('http://x/api/sync-health', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: 'not json',
    }))
    expect(res.status).toBe(400)
  })

  it('accepts a well-formed payload', async () => {
    const res = await post({
      dailyMetrics: [{ date: '2026-07-01', weightKg: 82.5, steps: 8000 }],
      exerciseSessions: [],
      sleepRecords: [],
    })
    expect(res.status).toBe(200)
  })

  it('accepts an empty payload (all arrays omitted)', async () => {
    const res = await post({})
    expect(res.status).toBe(200)
  })
})

// Q-25(a), shipped in #902 without a test. `activity_type` is an FK into `activity_types`, and the
// client maps Health Connect's exercise types to our slugs from its own table — which drifts the
// moment a type is renamed here. An unknown slug used to throw out of the exercise loop and 500 the
// route, losing the WHOLE flush including the records that were fine: the same poison-pill shape
// the implausibility guard already covered, through a different door.
describe('POST /api/sync-health — an unknown activityType must not sink the flush', () => {
  const session = (activityType: string, startTime = '07:00') => ({
    date: '2026-07-01', activityType, title: 'Morning walk',
    startTime, endTime: '07:30', durationMin: 30,
  })

  beforeEach(() => {
    mockRepo.saveActivityLog.mockClear()
    mockRepo.activityTypes = [{ id: 'walk' }, { id: 'other' }]
  })

  it('writes a seeded activityType through unchanged', async () => {
    const res = await post({ exerciseSessions: [session('walk')] })
    expect(res.status).toBe(200)
    expect((await res.json()).rejected).toEqual([])
    expect(mockRepo.saveActivityLog).toHaveBeenCalledTimes(1)
    expect(mockRepo.saveActivityLog.mock.calls[0][1]).toMatchObject({ activityType: 'walk' })
  })

  it('degrades an unseeded type to "other" rather than dropping a real session', async () => {
    const res = await post({ exerciseSessions: [session('walking')] })
    expect(res.status).toBe(200)

    // The session still lands — losing a real workout is worse than filing it imprecisely.
    expect(mockRepo.saveActivityLog).toHaveBeenCalledTimes(1)
    expect(mockRepo.saveActivityLog.mock.calls[0][1]).toMatchObject({ activityType: 'other' })

    // …but the degrade is reported, so a drifted client mapping stays visible rather than silent.
    const { rejected } = await res.json()
    expect(rejected).toHaveLength(1)
    expect(rejected[0]).toContain('walking')
    expect(rejected[0]).toContain('other')
  })

  it('does not let an unknown record strand a valid sibling in the same flush', async () => {
    const res = await post({
      exerciseSessions: [session('walking', '07:00'), session('walk', '09:00')],
    })
    expect(res.status).toBe(200)
    expect(mockRepo.saveActivityLog).toHaveBeenCalledTimes(2)
    expect(mockRepo.saveActivityLog.mock.calls.map(c => c[1].activityType)).toEqual(['other', 'walk'])
  })

  it('skips only the offending record when "other" itself is not seeded', async () => {
    mockRepo.activityTypes = [{ id: 'walk' }]
    const res = await post({
      exerciseSessions: [session('walking', '07:00'), session('walk', '09:00')],
    })
    expect(res.status).toBe(200)

    const { rejected } = await res.json()
    expect(rejected).toHaveLength(1)
    expect(rejected[0]).toContain('unknown activityType')
    expect(mockRepo.saveActivityLog).toHaveBeenCalledTimes(1)
    expect(mockRepo.saveActivityLog.mock.calls[0][1]).toMatchObject({ activityType: 'walk' })
  })
})

// `active_calories` is an INTEGER column and the upsert is parameterised, so a fractional value
// does not round on the way in — node-pg sends "412.6" and Postgres answers `invalid input syntax
// for type integer`, which fails the WHOLE dailyMetrics write rather than the one field. That is
// not an edge case: Health Connect's ActiveCaloriesBurned and Apple Health's activeEnergyBurned are
// both Doubles, so fractional kcal is the normal payload. Every sibling integer field in the route
// already rounds; this one shipped without it.
describe('POST /api/sync-health — activeCalories reaches an integer column', () => {
  beforeEach(() => { mockRepo.upsertBodyMetrics.mockClear() })

  it('rounds a fractional value rather than passing it to the driver', async () => {
    const res = await post({ dailyMetrics: [{ date: '2026-07-01', activeCalories: 412.6 }] })
    expect(res.status).toBe(200)
    const [, rows] = mockRepo.upsertBodyMetrics.mock.calls[0]
    expect(rows[0].activeCalories).toBe(413)
    expect(Number.isInteger(rows[0].activeCalories)).toBe(true)
  })

  it('keeps zero, which is a real reading and not an absent one', async () => {
    await post({ dailyMetrics: [{ date: '2026-07-01', activeCalories: 0 }] })
    const [, rows] = mockRepo.upsertBodyMetrics.mock.calls[0]
    expect(rows[0].activeCalories).toBe(0)
  })

  it('leaves an omitted value undefined rather than writing 0', async () => {
    await post({ dailyMetrics: [{ date: '2026-07-01', steps: 100 }] })
    const [, rows] = mockRepo.upsertBodyMetrics.mock.calls[0]
    expect(rows[0].activeCalories).toBeUndefined()
  })
})

// #2168 — Health Connect's intraday heart rate. The write itself (and why a ring user's scores do
// not move) is DB-tested in `aggregator-heartrate.test.ts`; this pins the route's half: structure
// is validated as a batch, values and clocks per sample, and the write is stamped with the
// payload's source and the session's timezone.
describe('POST /api/sync-health — heartRateSamples', () => {
  const MIN = 60_000

  beforeEach(() => { mockRepo.upsertAggregatorHeartrate.mockClear() })

  it('writes in-range samples as the payload source, in the session timezone', async () => {
    const now = Date.now()
    const res = await post({ heartRateSamples: [{ at: now - 2 * MIN, bpm: 71 }, { at: now - MIN, bpm: 128.6 }] })
    expect(res.status).toBe(200)
    expect((await res.json()).heartRateAccepted).toBe(2)

    expect(mockRepo.upsertAggregatorHeartrate).toHaveBeenCalledTimes(1)
    const [userId, rows, source, tz] = mockRepo.upsertAggregatorHeartrate.mock.calls[0]
    expect(userId).toBe('u1')
    expect(source).toBe('health_connect')
    expect(tz).toBe('Australia/Brisbane')
    expect(rows).toEqual([
      { timestamp: new Date(now - 2 * MIN), bpm: 71 },
      { timestamp: new Date(now - MIN), bpm: 129 },
    ])
  })

  it('stamps Apple Health when the payload says so', async () => {
    await post({ source: 'apple_health', heartRateSamples: [{ at: Date.now() - MIN, bpm: 70 }] })
    expect(mockRepo.upsertAggregatorHeartrate.mock.calls[0][2]).toBe('apple_health')
  })

  it('drops an implausible bpm or a broken clock per sample, never the batch', async () => {
    const now = Date.now()
    const res = await post({
      heartRateSamples: [
        { at: now - MIN, bpm: 0 },                       // strap-on acquisition zero
        { at: now - MIN + 1, bpm: 400 },                 // decode fault
        { at: now - 40 * 24 * 60 * MIN, bpm: 70 },       // older than the cold-sync window
        { at: now + 10 * MIN, bpm: 70 },                 // ahead of clock skew
        { at: now - 3 * MIN, bpm: 66 },                  // the one good sample
      ],
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.heartRateAccepted).toBe(1)
    expect(body.rejected).toEqual([expect.stringContaining('heart rate: 4 sample(s)')])
    expect(mockRepo.upsertAggregatorHeartrate.mock.calls[0][1]).toEqual([{ timestamp: new Date(now - 3 * MIN), bpm: 66 }])
  })

  it('does not write at all when every sample is dropped', async () => {
    const res = await post({ heartRateSamples: [{ at: Date.now(), bpm: 5 }] })
    expect(res.status).toBe(200)
    expect(mockRepo.upsertAggregatorHeartrate).not.toHaveBeenCalled()
  })

  it('400s on a structurally broken sample (fail closed)', async () => {
    for (const bad of [
      [{ at: '2026-07-01T00:00:00Z', bpm: 70 }],         // a string where epoch ms belongs
      [{ at: 1.5, bpm: 70 }],                            // not an integer instant
      [{ at: 9e15, bpm: 70 }],                           // past the Date range
      [{ at: Date.now(), bpm: 70, source: 'ble' }],      // a sample cannot name its own source
      [{ at: Date.now() }],
    ]) {
      expect((await post({ heartRateSamples: bad })).status, JSON.stringify(bad)).toBe(400)
    }
    expect(mockRepo.upsertAggregatorHeartrate).not.toHaveBeenCalled()
  })

  it('400s past the per-request cap, which is the client chunk size', async () => {
    const { HR_UPLOAD_CHUNK } = await import('@/lib/health-connect-sync')
    const at = Date.now() - MIN
    const res = await post({ heartRateSamples: Array.from({ length: HR_UPLOAD_CHUNK + 1 }, (_, i) => ({ at: at - i, bpm: 70 })) })
    expect(res.status).toBe(400)
  })
})

// #2462. Per-interval steps, active kcal and cadence. The DB half (the value lands, a re-read is
// idempotent, the user scope holds) is in `health-connect-intervals.test.ts`; this pins the route's
// half — structure as a batch, plausibility and the clock per row, each kind through the helper the
// codebase already owns for it.
describe('POST /api/sync-health — activityIntervals', () => {
  const MIN = 60_000
  const row = (o: Record<string, unknown>) => ({ recordId: 'rec-1', origin: 'com.sec.android.app.shealth', device: 'TYPE_WATCH', ...o })

  beforeEach(() => { mockRepo.upsertHealthConnectIntervals.mockClear() })

  it('writes each kind with its record id, origin and device, as Dates', async () => {
    const t = Date.now() - 10 * MIN
    const res = await post({ activityIntervals: [
      row({ kind: 'steps', startMs: t, endMs: t + MIN, value: 96 }),
      row({ kind: 'active_kcal', recordId: 'rec-2', startMs: t, endMs: t + 5 * MIN, value: 21.4 }),
      row({ kind: 'cadence_spm', recordId: 'rec-3', startMs: t, endMs: t, value: 112.5, device: undefined }),
    ] })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.intervalsAccepted).toBe(3)
    expect(body.rejected).toEqual([])
    const [userId, rows] = mockRepo.upsertHealthConnectIntervals.mock.calls[0]
    expect(userId).toBe('u1')
    expect(rows).toEqual([
      { kind: 'steps', recordId: 'rec-1', startAt: new Date(t), endAt: new Date(t + MIN), value: 96, dataOrigin: 'com.sec.android.app.shealth', deviceType: 'TYPE_WATCH' },
      { kind: 'active_kcal', recordId: 'rec-2', startAt: new Date(t), endAt: new Date(t + 5 * MIN), value: 21.4, dataOrigin: 'com.sec.android.app.shealth', deviceType: 'TYPE_WATCH' },
      { kind: 'cadence_spm', recordId: 'rec-3', startAt: new Date(t), endAt: new Date(t), value: 112.5, dataOrigin: 'com.sec.android.app.shealth', deviceType: null },
    ])
  })

  it('drops implausible rows and broken clocks per row, grouped in the report, never the batch', async () => {
    const t = Date.now() - 10 * MIN
    const DAY = 24 * 60 * MIN
    const res = await post({ activityIntervals: [
      row({ kind: 'steps', startMs: t, endMs: t + MIN, value: 3605 }),                   // isPlausibleStepWindow
      row({ kind: 'steps', recordId: 'b', startMs: t, endMs: t + MIN, value: 4000 }),    // same reason, grouped
      row({ kind: 'steps', recordId: 'c', startMs: t, endMs: t, value: 10 }),            // zero-length window
      row({ kind: 'steps', recordId: 'd', startMs: t, endMs: t + MIN, value: 10.5 }),    // not a count
      row({ kind: 'active_kcal', startMs: t, endMs: t + MIN, value: 500 }),              // 500 kcal/min
      row({ kind: 'active_kcal', recordId: 'e', startMs: t, endMs: t + MIN, value: -1 }),
      row({ kind: 'cadence_spm', startMs: t, endMs: t, value: 400 }),                    // isPlausibleCadence
      row({ kind: 'cadence_spm', recordId: 'f', startMs: t, endMs: t + 1, value: 110 }), // not an instant
      row({ kind: 'steps', recordId: 'g', startMs: t - 40 * DAY, endMs: t - 40 * DAY + MIN, value: 50 }), // older than the cold sync
      row({ kind: 'steps', recordId: 'h', startMs: t + 20 * MIN, endMs: t + 25 * MIN, value: 50 }),       // ahead of clock skew
      row({ kind: 'steps', recordId: 'ok', startMs: t, endMs: t + MIN, value: 80 }),     // the one good row
    ] })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.intervalsAccepted).toBe(1)
    expect(mockRepo.upsertHealthConnectIntervals.mock.calls[0][1]).toEqual([
      expect.objectContaining({ kind: 'steps', recordId: 'ok', value: 80 }),
    ])
    expect(body.rejected).toHaveLength(8)
    expect(body.rejected).toEqual(expect.arrayContaining([
      'intervals steps: N steps in N s (2 row(s))',
      'intervals steps: endMs is not after startMs (1 row(s))',
      'intervals steps: steps N is not a whole count (1 row(s))',
      expect.stringMatching(/^intervals active_kcal: calories imply N kcal\/min/),
      expect.stringMatching(/^intervals active_kcal: value -N is not a non-negative number/),
      expect.stringMatching(/^intervals cadence_spm: cadence N spm is outside/),
      expect.stringMatching(/^intervals cadence_spm: a cadence sample is an instant/),
      'intervals steps: outside the sync window (2 row(s))',
    ]))
  })

  it('does not write at all when every row is dropped', async () => {
    const t = Date.now() - MIN
    const res = await post({ activityIntervals: [row({ kind: 'cadence_spm', startMs: t, endMs: t, value: 10 })] })
    expect(res.status).toBe(200)
    expect(mockRepo.upsertHealthConnectIntervals).not.toHaveBeenCalled()
  })

  it('ignores the rows from a non-Health Connect caller, and says so', async () => {
    const t = Date.now() - 2 * MIN
    const res = await post({ source: 'apple_health', activityIntervals: [row({ kind: 'steps', startMs: t, endMs: t + MIN, value: 80 })] })
    expect(res.status).toBe(200)
    expect((await res.json()).rejected).toEqual([expect.stringContaining('only Health Connect')])
    expect(mockRepo.upsertHealthConnectIntervals).not.toHaveBeenCalled()
  })

  it('400s on a structurally broken row (fail closed)', async () => {
    const t = Date.now() - 2 * MIN
    for (const bad of [
      [row({ kind: 'distance', startMs: t, endMs: t + MIN, value: 1 })],     // unknown kind
      [row({ kind: 'steps', startMs: String(t), endMs: t + MIN, value: 1 })],
      [row({ kind: 'steps', startMs: t + 0.5, endMs: t + MIN, value: 1 })],
      [row({ kind: 'steps', startMs: t, endMs: 9e15, value: 1 })],
      [row({ kind: 'steps', startMs: t, endMs: t + MIN, value: '80' })],
      [row({ kind: 'steps', startMs: t, endMs: t + MIN, value: 1, recordId: '  ' })],
      [row({ kind: 'steps', startMs: t, endMs: t + MIN, value: 1, recordId: 'x'.repeat(201) })],
      [row({ kind: 'steps', startMs: t, endMs: t + MIN, value: 1, userId: 'someone-else' })], // a row cannot name its owner
      [{ kind: 'steps', startMs: t, endMs: t + MIN, value: 1 }],             // no record id
    ]) {
      expect((await post({ activityIntervals: bad })).status, JSON.stringify(bad)).toBe(400)
    }
    expect(mockRepo.upsertHealthConnectIntervals).not.toHaveBeenCalled()
  })

  it('400s past the per-request cap, which is the client chunk size', async () => {
    const { INTERVAL_UPLOAD_CHUNK } = await import('@/lib/health-connect-sync')
    const t = Date.now() - 2 * MIN
    const res = await post({ activityIntervals: Array.from({ length: INTERVAL_UPLOAD_CHUNK + 1 }, (_, i) =>
      ({ kind: 'cadence_spm', startMs: t - i, endMs: t - i, value: 100, recordId: 'r' })) })
    expect(res.status).toBe(400)
  })
})
