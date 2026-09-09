/**
 * PS-39 — the last three Oura-BLE reads plus the NextAuth handler re-export:
 * `oura-ble/step-counter-export`, `oura-ble/workout-sensors`, `oura-ble/comparison-harness` and
 * `auth/[...nextauth]`.
 *
 * **On the NextAuth route, plainly: it is two lines** — `export const { GET, POST } = handlers` —
 * so there is nothing to test but that both verbs are exported and reachable. That is what the case
 * below asserts and all it claims. It counts on the ratchet because the ratchet asks whether a test
 * imports the handler, and a route that re-exports someone else's handler still fails to build if
 * the import breaks. Writing more would be inventing coverage.
 *
 * What the other three decide:
 *
 *   · **The step export is a VALIDATION tool, not a trusted count** (its own header says so), and
 *     the route's job is to hand the pipeline chronological frames — the reader returns newest-first
 *     and the pipeline pairs windows in time order, so the sort is load-bearing rather than cosmetic.
 *   · **No clock anchor is `hasAnchor: false`, not an error.** `ring_timestamp_ds` is a counter since
 *     the ring's own epoch, so without an anchor there is no wall-clock time to report against, and
 *     that is the normal state before the first sync.
 *   · **`workout-sensors` answers 404 when there is no completed workout**, rather than an empty
 *     probe that reads as "the ring captured nothing".
 *   · **The comparison harness picks its adapter from `?metric`** — ring HR against the H10 by
 *     default, D5's own daytime HRV against the H10's RR-derived rMSSD on request. Two different
 *     questions behind one route.
 *
 * Not exercised: the ONNX pipeline, the comparison maths and the probe query are all stand-ins, so
 * nothing here says a step count or a correlation is right — only which frames and which window each
 * is handed. No SQL, no ring, no device.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

type Row = Record<string, unknown>

const getUserById = vi.fn(async (_id: string) => ({ isAdmin: true }) as Row | null)
const rateLimit = vi.fn((..._a: unknown[]) => true)

const getOuraClockAnchors = vi.fn(async (_u: string) => [{ ds: 0, ms: 0 }] as Row[])
const getOuraRawSamplesByTags = vi.fn(async (..._a: unknown[]) => [] as Row[])
const getWorkoutSensorProbe = vi.fn(async (..._a: unknown[]) => null as Row | null)

const runStepCounterPipeline = vi.fn(async (..._a: unknown[]) => null as Row | null)
const ensureServerOuraConstants = vi.fn(() => undefined)
const resolveDsToMs = vi.fn((ds: number, _a: unknown) => ds * 100)

const runComparison = vi.fn(async (..._a: unknown[]) => ({ ours: 1, reference: 1, pairs: 0 } as Row))
const ringVsH10HrAdapter = vi.fn((_r: unknown) => ({ kind: 'hr' }))
const dhrvVsH10Adapter = vi.fn((_r: unknown) => ({ kind: 'hrv' }))

let sessionUser: { id: string; isAdmin?: boolean } | null = { id: 'u-1', isAdmin: true }
vi.mock('@/auth', () => ({
  auth: async () => (sessionUser ? { user: sessionUser } : null),
  // What `app/api/auth/[...nextauth]/route.ts` re-exports.
  handlers: { GET: async () => new Response('ok'), POST: async () => new Response('ok') },
}))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: (...a: unknown[]) => rateLimit(...a) }))
vi.mock('@/lib/data', () => {
  const repo = async () => ({
    getUserById,
    getOuraClockAnchors: (u: string) => getOuraClockAnchors(u),
    getOuraRawSamplesByTags: (...a: unknown[]) => getOuraRawSamplesByTags(...a),
    getWorkoutSensorProbe: (...a: unknown[]) => getWorkoutSensorProbe(...a),
  })
  return { getRepository: repo, getRepositoryAsync: repo }
})
vi.mock('@/lib/oura-ble/step-counter-pipeline', () => ({
  runStepCounterPipeline: (...a: unknown[]) => runStepCounterPipeline(...a),
}))
vi.mock('@/lib/oura-models/inference/runtime-node', () => ({ nodeModelRuntime: { kind: 'node' } }))
vi.mock('@/lib/oura-models/constants-inject', () => ({
  ensureServerOuraConstants: () => ensureServerOuraConstants(),
}))
vi.mock('@/lib/oura-ble/clock', () => ({ resolveDsToMs: (ds: number, a: unknown) => resolveDsToMs(ds, a) }))
vi.mock('@/lib/oura-comparison-harness', () => ({
  runComparison: (...a: unknown[]) => runComparison(...a),
}))
vi.mock('@/lib/oura-comparison-harness-adapters', () => ({
  ringVsH10HrAdapter: (r: unknown) => ringVsH10HrAdapter(r),
  dhrvVsH10Adapter: (r: unknown) => dhrvVsH10Adapter(r),
}))

import { GET as stepExportGet } from '@/app/api/oura-ble/step-counter-export/route'
import { GET as sensorsGet } from '@/app/api/oura-ble/workout-sensors/route'
import { GET as harnessGet } from '@/app/api/oura-ble/comparison-harness/route'
import { GET as authGet, POST as authPost } from '@/app/api/auth/[...nextauth]/route'

const stepExportReq = async (qs = '') => {
  const { NextRequest } = await import('next/server')
  return stepExportGet(new NextRequest(`http://localhost/api/oura-ble/step-counter-export${qs}`))
}
const sensorsReq = (qs = '') =>
  sensorsGet(new Request(`http://localhost/api/oura-ble/workout-sensors${qs}`))
const harnessReq = (qs = '') =>
  harnessGet(new Request(`http://localhost/api/oura-ble/comparison-harness${qs}`))

const frame = (ds: number, tag: number) => ({ ringTimestampDs: ds, tag, bodyHex: 'aabb' })

beforeEach(() => {
  for (const m of [getUserById, rateLimit, getOuraClockAnchors, getOuraRawSamplesByTags,
                   getWorkoutSensorProbe, runStepCounterPipeline, ensureServerOuraConstants,
                   resolveDsToMs, runComparison, ringVsH10HrAdapter, dhrvVsH10Adapter]) m.mockClear()
  rateLimit.mockReturnValue(true)
  getUserById.mockResolvedValue({ isAdmin: true })
  getOuraClockAnchors.mockResolvedValue([{ ds: 0, ms: 0 }])
  getOuraRawSamplesByTags.mockResolvedValue([])
  getWorkoutSensorProbe.mockResolvedValue(null)
  runStepCounterPipeline.mockResolvedValue(null)
  runComparison.mockResolvedValue({ ours: 1, reference: 1, pairs: 0 })
  ringVsH10HrAdapter.mockReturnValue({ kind: 'hr' })
  dhrvVsH10Adapter.mockReturnValue({ kind: 'hrv' })
  sessionUser = { id: 'u-1', isAdmin: true }
})

afterEach(() => { vi.useRealTimers() })

describe('the admin gate on the three probes', () => {
  const ALL: [string, () => Promise<Response>][] = [
    ['step export', () => stepExportReq()],
    ['workout sensors', () => sensorsReq()],
    ['comparison harness', () => harnessReq()],
  ]

  it('refuses a non-admin, whatever the token claims', async () => {
    sessionUser = { id: 'u-1', isAdmin: true }
    getUserById.mockResolvedValue({ isAdmin: false })
    for (const [name, call] of ALL) expect((await call()).status, name).toBe(403)
    expect(runStepCounterPipeline).not.toHaveBeenCalled()
    expect(runComparison).not.toHaveBeenCalled()
  })

  it('answers 503 when the CHECK could not run, not 403 (Q-548)', async () => {
    getUserById.mockRejectedValue(new Error('connection terminated unexpectedly'))
    for (const [name, call] of ALL) {
      const res = await call()
      expect(res.status, name).toBe(503)
      expect(await res.json(), name).toEqual({ error: 'Service unavailable' })
    }
  })

  it('answers 401 with no session, before touching the repository', async () => {
    sessionUser = null
    for (const [name, call] of ALL) expect((await call()).status, name).toBe(401)
    expect(getUserById).not.toHaveBeenCalled()
  })
})

describe('GET /api/oura-ble/step-counter-export', () => {
  it('reports no clock anchor as hasAnchor: false, not an error', async () => {
    // `ring_timestamp_ds` counts from the ring's own epoch, which resets on a re-key or a dead
    // battery — without an anchor there is no wall-clock time to report against, and that is the
    // normal state before the first sync rather than a fault.
    getOuraClockAnchors.mockResolvedValue([])
    const res = await stepExportReq()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ hasAnchor: false })
    expect(getOuraRawSamplesByTags).not.toHaveBeenCalled()
  })

  it('reads the two streams separately, both at the requested limit', async () => {
    // Step frames and motion frames are different tags and must not be pooled: the pipeline pairs
    // 0x7e with 0x7f and uses 0x47 as a separate input.
    await stepExportReq('?limit=200')
    const calls = getOuraRawSamplesByTags.mock.calls as unknown[][]
    expect(calls).toHaveLength(2)
    expect(calls[0].slice(1)).toEqual([[0x7e, 0x7f], 200])
    expect(calls[1].slice(1)).toEqual([[0x47], 200])
  })

  it('defaults to 1000 and refuses a limit outside the band', async () => {
    await stepExportReq()
    expect((getOuraRawSamplesByTags.mock.calls[0] as unknown[])[2]).toBe(1000)
    for (const qs of ['?limit=10', '?limit=5000', '?limit=abc', '?limit=100.5']) {
      const res = await stepExportReq(qs)
      expect(res.status, qs).toBe(400)
    }
  })

  it('hands the pipeline CHRONOLOGICAL frames, though the reader returns newest-first', async () => {
    // The sort is load-bearing: the pipeline pairs windows in time order, so newest-first frames
    // would pair the wrong ends. A fixture already in order proves nothing about a sort.
    getOuraRawSamplesByTags
      .mockResolvedValueOnce([frame(300, 0x7e), frame(100, 0x7f), frame(200, 0x7e)])
      .mockResolvedValueOnce([frame(250, 0x47), frame(50, 0x47)])
    await stepExportReq()
    const [steps, motion] = runStepCounterPipeline.mock.calls[0] as [Row[], Row[]]
    expect(steps.map(f => f.ringTimestampDs)).toEqual([100, 200, 300])
    expect(motion.map(f => f.ringTimestampDs)).toEqual([50, 250])
  })

  it('delivers the constants before running the model', async () => {
    // The constants loader is synchronous and reads whichever directory boot settled on; without
    // this call the pipeline's first inference throws rather than returning null.
    await stepExportReq()
    expect(ensureServerOuraConstants).toHaveBeenCalled()
  })

  it('says so plainly when no paired windows were found', async () => {
    // `pairedWindows: 0` with a message, not an empty success — the whole point of the console is
    // to tell the owner whether the pairing worked.
    const body = await (await stepExportReq()).json()
    expect(body).toMatchObject({ hasAnchor: true, pairedWindows: 0 })
    expect(body.message).toContain('No paired')
  })

  it('summarises stride frequency, taking the LOWER median of an even count', async () => {
    // Four values: an odd-length fixture cannot tell the lower median from an averaged one, and
    // this route deliberately takes an actual observed value rather than inventing one between two.
    getOuraRawSamplesByTags.mockResolvedValue([frame(100, 0x7e)])
    runStepCounterPipeline.mockResolvedValue({
      totalSteps: 1234.6, gateEstimateSteps: 1200, motionFrames: 9, pairedWindows: 3,
      strideFrequencyHz: [2.0, 1.0, 4.0, 3.0],
      stepWindows: [{ startMs: 1, endMs: 2, steps: 12.345 }],
    })
    const body = await (await stepExportReq()).json()
    expect(body.strideFrequencyHz).toEqual({ subRows: 4, min: 1, median: 2, max: 4, inWalkingBand: 2 })
    expect(body.stepCounterTotal).toBe(1235)
    expect(body.stepWindows).toEqual([{ startMs: 1, endMs: 2, steps: 12.35 }])
  })

  it('counts the walking band inclusively at both ends, and drops non-finite values', async () => {
    // 1.5 and 3 are in; a NaN from a failed decode is neither in nor counted at all, and leaving it
    // in would poison min/max as well as the band count.
    getOuraRawSamplesByTags.mockResolvedValue([frame(100, 0x7e)])
    runStepCounterPipeline.mockResolvedValue({
      totalSteps: 0, gateEstimateSteps: 0, motionFrames: 0, pairedWindows: 1,
      strideFrequencyHz: [1.5, 3, 3.01, 1.49, Number.NaN, Number.POSITIVE_INFINITY],
      stepWindows: [],
    })
    const body = await (await stepExportReq()).json()
    expect(body.strideFrequencyHz.subRows).toBe(4)
    expect(body.strideFrequencyHz.inWalkingBand).toBe(2)
    expect(body.strideFrequencyHz.max).toBe(3.01)
  })

  it('reports the ds span from the STEP frames, after sorting', async () => {
    getOuraRawSamplesByTags
      .mockResolvedValueOnce([frame(300, 0x7e), frame(100, 0x7f)])
      .mockResolvedValueOnce([frame(999, 0x47)])
    runStepCounterPipeline.mockResolvedValue({
      totalSteps: 0, gateEstimateSteps: 0, motionFrames: 1, pairedWindows: 1,
      strideFrequencyHz: [], stepWindows: [],
    })
    const body = await (await stepExportReq()).json()
    expect(body.generatedAtDs).toEqual({ first: 100, last: 300 })
    expect(body.stepFrames).toBe(2)
    expect(body.motionFramesUsed).toBe(1)
  })

  it('rate-limits before reading', async () => {
    rateLimit.mockReturnValue(false)
    expect((await stepExportReq()).status).toBe(429)
    expect(rateLimit.mock.calls[0].slice(1)).toEqual([10, 60_000])
    expect(getOuraClockAnchors).not.toHaveBeenCalled()
  })

  it('sends no-store', async () => {
    getOuraRawSamplesByTags.mockResolvedValue([frame(100, 0x7e)])
    runStepCounterPipeline.mockResolvedValue({
      totalSteps: 0, gateEstimateSteps: 0, motionFrames: 0, pairedWindows: 1,
      strideFrequencyHz: [], stepWindows: [],
    })
    expect((await stepExportReq()).headers.get('Cache-Control')).toBe('private, no-store')
  })
})

describe('GET /api/oura-ble/workout-sensors', () => {
  it('probes the named session, and the most recent when none is named', async () => {
    getWorkoutSensorProbe.mockResolvedValue({ sessionId: 'ws-1', motionFrames: 12 })
    await sensorsReq('?sessionId=ws-9')
    expect(getWorkoutSensorProbe).toHaveBeenCalledWith('u-1', 'ws-9')
    getWorkoutSensorProbe.mockClear()
    await sensorsReq()
    expect(getWorkoutSensorProbe).toHaveBeenCalledWith('u-1', undefined)
  })

  it('treats a blank sessionId as absent rather than looking one up', async () => {
    // `?sessionId=` and `?sessionId=%20` would otherwise become a lookup for the empty string,
    // which finds nothing and reads as "no workout" instead of "you did not name one".
    getWorkoutSensorProbe.mockResolvedValue({ sessionId: 'ws-1' })
    for (const qs of ['?sessionId=', '?sessionId=%20%20']) {
      getWorkoutSensorProbe.mockClear()
      await sensorsReq(qs)
      expect(getWorkoutSensorProbe, qs).toHaveBeenCalledWith('u-1', undefined)
    }
  })

  it('answers 404 when there is no completed workout, not an empty probe', async () => {
    // An empty probe would read as "the ring captured nothing during the workout" — the exact
    // finding this route exists to establish, arrived at without a workout.
    const res = await sensorsReq()
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'No completed workout found' })
  })

  it('returns the probe as-is', async () => {
    getWorkoutSensorProbe.mockResolvedValue({ sessionId: 'ws-1', motionFrames: 12, hrReadings: 340 })
    expect(await (await sensorsReq()).json()).toEqual({ sessionId: 'ws-1', motionFrames: 12, hrReadings: 340 })
  })
})

describe('GET /api/oura-ble/comparison-harness', () => {
  it('compares ring HR against the H10 by default', async () => {
    await harnessReq()
    expect(ringVsH10HrAdapter).toHaveBeenCalled()
    expect(dhrvVsH10Adapter).not.toHaveBeenCalled()
    expect((runComparison.mock.calls[0] as unknown[])[0]).toEqual({ kind: 'hr' })
  })

  it('switches to the HRV adapter only for ?metric=hrv exactly', async () => {
    // Two different questions behind one route, and anything that is not `hrv` is the HR one —
    // a typo must not silently answer the other question.
    await harnessReq('?metric=hrv')
    expect(dhrvVsH10Adapter).toHaveBeenCalled()
    expect((runComparison.mock.calls[0] as unknown[])[0]).toEqual({ kind: 'hrv' })

    for (const qs of ['?metric=HRV', '?metric=rmssd', '?metric=']) {
      dhrvVsH10Adapter.mockClear(); ringVsH10HrAdapter.mockClear()
      await harnessReq(qs)
      expect(ringVsH10HrAdapter, qs).toHaveBeenCalled()
      expect(dhrvVsH10Adapter, qs).not.toHaveBeenCalled()
    }
  })

  it('uses an explicit start/end window when BOTH are given', async () => {
    await harnessReq('?start=2026-09-01T00:00:00Z&end=2026-09-01T01:00:00Z')
    expect((runComparison.mock.calls[0] as unknown[]).slice(1)).toEqual([
      'u-1', '2026-09-01T00:00:00Z', '2026-09-01T01:00:00Z',
    ])
  })

  it('falls back to the minutes window when only ONE of the two is given', async () => {
    // Half a range is not a range. A fixture supplying both could not tell the `&&` from an `||`,
    // and an `||` would pass one real bound and one undefined into the comparison.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-09T12:00:00Z'))
    for (const qs of ['?start=2026-09-01T00:00:00Z', '?end=2026-09-01T01:00:00Z']) {
      runComparison.mockClear()
      await harnessReq(qs)
      const [, , startIso, endIso] = runComparison.mock.calls[0] as unknown[]
      expect(endIso, qs).toBe('2026-09-09T12:00:00.000Z')
      expect(startIso, qs).toBe('2026-09-09T11:45:00.000Z')
    }
  })

  it('defaults to 15 minutes, clamps to a day, and ignores a minutes it cannot use', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-09T12:00:00Z'))
    const startOf = () => (runComparison.mock.calls[0] as unknown[])[2] as string

    await harnessReq()
    expect(startOf()).toBe('2026-09-09T11:45:00.000Z')

    runComparison.mockClear()
    await harnessReq('?minutes=5000')
    expect(startOf()).toBe('2026-09-08T12:00:00.000Z')

    for (const qs of ['?minutes=abc', '?minutes=0', '?minutes=-30']) {
      runComparison.mockClear()
      await harnessReq(qs)
      expect(startOf(), qs).toBe('2026-09-09T11:45:00.000Z')
    }
  })

  it('rate-limits before running the comparison', async () => {
    rateLimit.mockReturnValue(false)
    expect((await harnessReq()).status).toBe(429)
    expect(rateLimit.mock.calls[0].slice(1)).toEqual([20, 60_000])
    expect(runComparison).not.toHaveBeenCalled()
  })
})

describe('/api/auth/[...nextauth]', () => {
  it('re-exports both of NextAuth’s handlers', async () => {
    // The whole route is `export const { GET, POST } = handlers`. There is nothing else to assert,
    // and this is not a claim that authentication works — only that both verbs are exported and
    // reachable, which is what breaks if the import or the destructuring is wrong.
    expect(typeof authGet).toBe('function')
    expect(typeof authPost).toBe('function')
    const { NextRequest } = await import('next/server')
    expect((await authGet(new NextRequest('http://localhost/api/auth/session'))).status).toBe(200)
    expect((await authPost(new NextRequest('http://localhost/api/auth/signout', { method: 'POST' }))).status).toBe(200)
  })
})
