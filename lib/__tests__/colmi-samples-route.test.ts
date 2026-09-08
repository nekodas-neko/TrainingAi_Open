/**
 * PS-39 — `POST /api/colmi/samples` is the Colmi R09's only way in, and its guarantees are the kind
 * that break silently: a filter that quietly widened would not fail anything, it would just lose
 * data nobody misses until a decoder fix needs it back.
 *
 * Four of these pin a rule the route's own comments trace to a past incident, which is why they are
 * the ones worth having rather than a happy-path POST.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { formatInTimeZone } from 'date-fns-tz'

const insertColmiReadings = vi.fn(async (_userId: string, _rows: Array<Record<string, unknown>>) => 0)
const insertColmiSleepSegments = vi.fn(async (_userId: string, _rows: Array<Record<string, unknown>>) => 0)
const insertColmiRawFrames = vi.fn(async (_userId: string, _rows: Array<Record<string, unknown>>) => 0)

const TZ = 'Australia/Brisbane'
let sessionUser: { id: string; timezone?: string } | null = { id: 'u-1', timezone: TZ }
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))
vi.mock('@/lib/data', () => ({
  getRepositoryAsync: async () => ({ insertColmiReadings, insertColmiSleepSegments, insertColmiRawFrames }),
  getRepository: async () => ({ insertColmiReadings, insertColmiSleepSegments, insertColmiRawFrames }),
}))

/** The server-decode path, stubbed. The decoder has its own tests; what these need is a way to
 *  hand the route a segment the client schema would never have let through, which is precisely the
 *  case the route restates its bounds for. */
const framesToPayload = vi.fn((_frames: unknown, _opts: unknown) =>
  ({ readings: [] as Array<Record<string, unknown>>, sleep: [] as Array<Record<string, unknown>> }))
vi.mock('@/lib/colmi-ble/frames-to-payload', () => ({
  decodeRawFrames: (frames: unknown) => frames,
  framesToPayload: (frames: unknown, opts: unknown) => framesToPayload(frames, opts),
}))

import { POST } from '@/app/api/colmi/samples/route'

/** A fresh IP is pointless here (the limiter keys on the user), so the user id rotates instead —
 *  60 requests/minute would otherwise make later cases pass for the wrong reason. */
let userSeq = 0
const freshUser = () => { sessionUser = { id: `u-${++userSeq}`, timezone: TZ }; return sessionUser.id }

const post = (body: unknown) =>
  POST(new Request('http://localhost/api/colmi/samples', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }) as never)

const minutesAgo = (n: number) => Date.now() - n * 60_000

beforeEach(() => {
  insertColmiReadings.mockClear(); insertColmiSleepSegments.mockClear(); insertColmiRawFrames.mockClear()
  insertColmiReadings.mockResolvedValue(0); insertColmiSleepSegments.mockResolvedValue(0); insertColmiRawFrames.mockResolvedValue(0)
  freshUser()
})

describe('POST /api/colmi/samples', () => {
  it('refuses without a session', async () => {
    sessionUser = null
    expect((await post({ readings: [] })).status).toBe(401)
    expect(insertColmiRawFrames).not.toHaveBeenCalled()
  })

  it('drops one implausible sample instead of rejecting the batch', async () => {
    // The poison-pill rule, stated in the route: a ring emits a bad reading during acquisition, and
    // 400-ing the whole sync makes the client swallow it and drop the batch permanently.
    const res = await post({ readings: [
      { kind: 'heart_rate', at: minutesAgo(5), value: 62 },
      { kind: 'heart_rate', at: minutesAgo(4), value: 9_000 },
      { kind: 'heart_rate', at: minutesAgo(3), value: 58 },
    ] })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.received.readings).toBe(3)
    expect(json.accepted.readings).toBe(2)
    expect(insertColmiReadings.mock.calls[0][1]).toHaveLength(2)
  })

  it('refuses a future-dated sample, which is a bad clock rather than history', async () => {
    // Q-56: real sensor data landing on future-dated rows is a live incident here, so this side
    // fails closed — one minute of tolerance against thirty days of backfill.
    const json = await (await post({ readings: [
      { kind: 'heart_rate', at: Date.now() + 10 * 60_000, value: 60 },
    ] })).json()
    expect(json.accepted.readings).toBe(0)
  })

  it('stores raw frames UNFILTERED, even when every decoded sample is discarded', async () => {
    // The archival guarantee, and the one worth a test: every filter above the write discards
    // something, and what it discards is exactly what a later decoder fix needs to re-read.
    const json = await (await post({
      readings: [{ kind: 'heart_rate', at: minutesAgo(2), value: 9_000 }],
      rawFrames: [{ channel: 'v1', tag: 3, hex: 'abcd' }, { channel: 'v2', hex: '0011ff' }],
    })).json()
    expect(json.accepted.readings).toBe(0)
    expect(insertColmiRawFrames.mock.calls[0][1]).toEqual([
      { channel: 'v1', tag: 3, hex: 'abcd' },
      { channel: 'v2', tag: null, hex: '0011ff' },
    ])
  })

  it('files a night under the day it STARTED in, not the day it ended', async () => {
    // What makes a 23:40 bedtime and a 00:20 one land on the same night rather than either side of
    // a midnight. Derived from the clock rather than pinned to a date: a fixed timestamp against a
    // rolling 30-day window is a test with a detonation date.
    const startedAt = Date.now() - 8 * 60 * 60_000
    const endedAt = startedAt + 60 * 60_000
    await post({ sleep: [{ startedAt, endedAt, stage: 2, minutes: 60 }] })

    const written = insertColmiSleepSegments.mock.calls[0][1][0] as { localDate: string }
    expect(written.localDate).toBe(formatInTimeZone(new Date(startedAt), TZ, 'yyyy-MM-dd'))
  })

  it('rejects an over-long sleep segment from the CLIENT at the schema', async () => {
    const res = await post({ sleep: [{ startedAt: minutesAgo(200), endedAt: minutesAgo(10), stage: 1, minutes: 2000 }] })
    expect(res.status).toBe(400)
    expect(insertColmiSleepSegments).not.toHaveBeenCalled()
  })

  it('drops the same segment on the SERVER-decoded path, where the schema never sees it', async () => {
    // Migration 260: a junk tail on the sleep frame stored an 8.9-hour night as 19.1. The Zod bound
    // above only guards the client path — a server-decoded segment reaches the write having met no
    // schema at all, which is why the route restates the bound there. A test that exercised only
    // the client path would pass straight over the half that actually broke.
    const startedAt = Date.now() - 3 * 60 * 60_000
    framesToPayload.mockReturnValue({
      readings: [],
      sleep: [
        { startedAt, endedAt: startedAt + 60_000, stage: 1, minutes: 2000 },   // the 19.1-hour night
        { startedAt, endedAt: startedAt + 60_000, stage: 1, minutes: 60 },     // a real one, kept
      ],
    })
    const json = await (await post({ rawFrames: [{ channel: 'v1', hex: 'abcd' }] })).json()

    expect(json.decodedBy).toBe('server')
    expect(insertColmiSleepSegments.mock.calls[0][1]).toHaveLength(1)
    expect((insertColmiSleepSegments.mock.calls[0][1][0] as { minutes: number }).minutes).toBe(60)
  })

  it('says which side decoded, so a silent fallback to the client is visible', async () => {
    const withReadings = await (await post({
      readings: [{ kind: 'heart_rate', at: minutesAgo(1), value: 60 }],
      rawFrames: [{ channel: 'v1', hex: 'abcd' }],
    })).json()
    expect(withReadings.decodedBy).toBe('client')
  })

  it('resolves the local day from the session timezone, never the server clock', async () => {
    // One writer deciding the day is what keeps three devices' rows comparable.
    sessionUser = { id: 'u-tz', timezone: 'America/New_York' }
    const at = minutesAgo(30)
    await post({ readings: [{ kind: 'heart_rate', at, value: 60 }] })

    const row = insertColmiReadings.mock.calls[0][1][0] as { localDate: string }
    expect(row.localDate).toBe(formatInTimeZone(new Date(at), 'America/New_York', 'yyyy-MM-dd'))
  })
})
