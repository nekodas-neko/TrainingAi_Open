/**
 * issue 2235 — Body Battery charges at or below resting HR + 9 bpm (v7), and the history re-derive
 * that moves every stored day onto it.
 *
 * DB-free: a synthetic 28-day history (no production or owner data) is served from a stub
 * repository, and the admin route is driven against it with auth, admin and rate limit stubbed.
 * The v6 end values below were captured from this same fixture on `main` before the change
 * (characterization), so the test states exactly which days move and by how much.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { NextRequest } from 'next/server'
import type { BodyBatteryDailyRow, WorkoutRepository } from '@/lib/data/repository'
import { todayInTz, shiftDateStr, dateStrMidnightInTz } from '@trainingai/shared/date-utils'
import { computeObservedHr } from '@trainingai/shared/health/observed-hr'

const TZ = 'Australia/Brisbane'
const USER = 'u-2235'
const DAYS = 28

const h = vi.hoisted(() => ({ repo: null as unknown }))

vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'u-2235', timezone: 'Australia/Brisbane', isAdmin: true } })) }))
vi.mock('@/lib/admin', () => ({ requireAdmin: async () => {}, adminErrorResponse: () => new Response(null, { status: 403 }) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))
vi.mock('@/lib/data', () => ({ getRepository: async () => h.repo }))
vi.mock('@/lib/oura-models/constants-inject', () => ({ tryEnsureServerOuraConstants: () => {} }))
vi.mock('@/lib/observability', () => ({ reportServerError: vi.fn() }))
vi.mock('@/lib/health/daytime-stress', async (orig) => ({
  ...(await orig<typeof import('@/lib/health/daytime-stress')>()),
  buildDaytimeStressSeriesFromModel: () => [],
}))

/**
 * Day i (0 = oldest) of the synthetic history: a reading every 5 minutes, 06:00–22:00 local. Seated
 * HR cycles 62–70 bpm, so with resting HR 58 it sits 4 to 12 bpm over rest, straddling both the
 * old ceiling (0.05 × reserve) and the new one (9 bpm). Every day has an active morning (08:00–11:00
 * at 85 bpm); every fourth day adds a 90-minute 110 bpm session, every fourth a 45-minute 130 bpm one.
 */
function hrFor(date: string, i: number): { timestamp: Date; bpm: number }[] {
  const mid = dateStrMidnightInTz(date, TZ).getTime()
  const seated = 62 + (i % 9)
  const out: { timestamp: Date; bpm: number }[] = []
  for (let m = 6 * 60; m <= 22 * 60; m += 5) {
    let bpm = seated
    if (m >= 8 * 60 && m < 11 * 60) bpm = 85
    if (i % 4 === 1 && m >= 12 * 60 && m < 13.5 * 60) bpm = 110
    if (i % 4 === 3 && m >= 17 * 60 && m < 17.75 * 60) bpm = 130
    out.push({ timestamp: new Date(mid + m * 60_000), bpm })
  }
  return out
}

function buildRepo(dates: string[]) {
  const hr = new Map(dates.map((d, i) => [d, hrFor(d, i)]))
  const stored = new Map<string, BodyBatteryDailyRow>()
  // What a v6 day looked like when it was stored: the anchor it froze, its own HR peak, the v6 stamp.
  for (const d of dates) {
    const bpms = hr.get(d)!.map(r => r.bpm)
    stored.set(d, {
      date: d, anchor: 60, anchorSource: 'readiness', endValue: 0, dayMin: 0, dayMax: 60,
      totalCharged: 1, totalDrained: 1, restingHr: 58, hrMax: 190,
      hrMaxObserved: computeObservedHr(bpms).max, hrSampleCount: bpms.length, modelVersion: 'v6:stored',
    })
  }
  let writes = 0
  const repo = {
    getOuraDaily: async () => [],
    getOuraDailyDerived: async () => [],
    listBodyMetrics: async () => [{ restingHeartRate: 58, hrvMs: 50 }],
    listSleepSessions: async () => [],
    getHrForWindow: async (_u: string, from: Date, to: Date) => {
      const all = [...hr.values()].flat()
      return all.filter(r => r.timestamp >= from && r.timestamp < to)
    },
    getUserById: async () => null,
    getOuraDaytimeSignals: async () => ({ temp: [], met: [] }),
    getBodyBatteryHistory: async (_u: string, from: string, to: string) =>
      [...stored.values()].filter(r => r.date >= from && r.date <= to).sort((a, b) => a.date.localeCompare(b.date)),
    getDaytimeHrvModel: async () => null,
    upsertBodyBatteryDaily: async (_u: string, row: BodyBatteryDailyRow) => { writes++; stored.set(row.date, { ...row }); return true },
  }
  return { repo: repo as unknown as WorkoutRepository, stored, writes: () => writes }
}

const call = async (qs: string) => {
  const { POST } = await import('../route')
  const res = await POST(new NextRequest(`http://localhost/api/admin/rederive-body-battery?${qs}`, { method: 'POST' }))
  expect(res.status).toBe(200)
  return res.json()
}

describe('Body Battery waking-rest offset and its re-derive (issue 2235)', () => {
  let dates: string[]
  let from: string
  let to: string
  beforeAll(() => {
    to = shiftDateStr(todayInTz(TZ), -1)
    from = shiftDateStr(to, -(DAYS - 1))
    dates = Array.from({ length: DAYS }, (_, i) => shiftDateStr(from, i))
  })

  type Day = { action: string; recomputed: { endValue: number } }

  it('stamps v7 with the 9 bpm offset in the model version', async () => {
    const { BODY_BATTERY_MODEL_VERSION, WAKING_REST_OFFSET_BPM } = await import('@/lib/health/body-battery-day')
    expect(WAKING_REST_OFFSET_BPM).toBe(9)
    expect(BODY_BATTERY_MODEL_VERSION).toBe('v7:rest+9bpm:chg0.12:drn0.08:str0.02:hrmax-observed:oura-rule')
  })

  it('moves exactly the days the offset reaches, by the pinned amounts', async () => {
    h.repo = buildRepo(dates).repo
    const body = await call(`from=${from}&to=${to}`)
    const ends = body.days.map((d: Day) => d.recomputed.endValue)
    expect(ends).toEqual(V7_ENDS)
    const deltas = ends.map((e: number, i: number) => e - V6_ENDS[i])
    const moved = deltas.filter((x: number) => x !== 0)
    // 22 of 28 days end higher; none ends lower. The six that stay are days that already charged
    // to 100 under v6. Days whose seated HR is 4–9 bpm over rest flip from drain to charge (+42 to
    // +53, and pin at 100 in this synthetic history, which sits for 13 hours); days whose seated HR
    // is 10–12 bpm over rest still drain, but less, because the drain is measured from the higher
    // ceiling (+1 to +6).
    expect(moved).toHaveLength(22)
    expect(Math.min(...moved)).toBe(1)
    expect(Math.max(...moved)).toBe(53)
    expect(deltas.filter((x: number) => x < 0)).toHaveLength(0)
  })

  it('is idempotent: a second real run writes nothing, and a dry run never writes', async () => {
    const r = buildRepo(dates)
    h.repo = r.repo
    const dry = await call(`from=${from}&to=${to}`)
    expect(dry.dryRun).toBe(true)
    expect(dry.summary.written).toBe(DAYS)
    expect(r.writes()).toBe(0)

    const first = await call(`from=${from}&to=${to}&dryRun=false`)
    expect(first.summary.written).toBe(DAYS)
    expect(r.writes()).toBe(DAYS)
    expect([...r.stored.values()].every(x => x.modelVersion.startsWith('v7:rest+9bpm:'))).toBe(true)
    // Frozen anchors are kept, not re-chosen.
    expect([...r.stored.values()].every(x => x.anchor === 60)).toBe(true)

    const second = await call(`from=${from}&to=${to}&dryRun=false`)
    expect(second.summary.written).toBe(0)
    expect(second.summary.unchanged).toBe(DAYS)
    expect(r.writes()).toBe(DAYS)
    expect(second.days.map((d: Day) => d.recomputed.endValue)).toEqual(V7_ENDS)
  })
})

// Captured from this fixture on `main` (v6, threshold 0.05 of reserve) before the change.
const V6_ENDS = [100, 100, 100, 56, 57, 54, 56, 54, 55, 100, 100, 100, 58, 47, 51, 47, 49, 44, 55, 51, 53, 48, 52, 47, 50, 45, 48, 52]
// The same fixture under v7 (resting HR + 9 bpm).
const V7_ENDS = [100, 100, 100, 100, 100, 100, 58, 55, 57, 100, 100, 100, 100, 100, 100, 52, 55, 50, 100, 100, 100, 100, 100, 100, 56, 51, 54, 100]
