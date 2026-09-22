/**
 * TN-57 — the readers, which is where the defect actually lived.
 *
 * The row has always been honest: the morning sheet seeds from a neutral constant, tracks whether
 * each scale was moved, and posts both. The schema said what to do with that when the columns were
 * added (Q-113) — *"a calibration query must filter on these before trusting
 * perceivedRecovery/sleepQualityFeel as real self-report"* — and nothing ever did.
 *
 * Measured on production 2026-09-22 over the owner's 97 morning check-ins: **78 carry a
 * `perceived_recovery` and 0 of them were touched**, two distinct values, standard deviation 0.286.
 * `sleep_quality_feel` was touched 3 times. So a calibration route was fitting to 78 values nobody
 * gave, and a user-facing correlation was plotting them as a coefficient.
 *
 * The expected outcome at each reader is that the series **empties**, not that it shifts. That is
 * correct and must not be rescued by relaxing the filter — a small number that is real beats a
 * large one that is not.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
// The admin route reads `req.nextUrl.searchParams`, which a plain Request does not have.
import { NextRequest } from 'next/server'
import { shiftDateStr } from '@trainingai/shared/date-utils'

const listDayCheckins = vi.fn(async (..._a: unknown[]) => [] as unknown[])
const getBodyBatteryHistory = vi.fn(async (..._a: unknown[]) => [] as unknown[])
const listSleepSessions = vi.fn(async (..._a: unknown[]) => [] as unknown[])
const getOuraDaily = vi.fn(async (..._a: unknown[]) => [] as unknown[])
const getOuraDailyDerived = vi.fn(async (..._a: unknown[]) => [] as unknown[])
// `requireAdmin` (lib/admin.ts) re-reads the row and never trusts the JWT claim, so the admin route
// needs this rather than an isAdmin session field. Without it the route answers 503 — Q-548's
// "could not decide" — and every assertion below would pass on an error body.
const getUserById = vi.fn(async (_id: string) => ({ id: 'u-tn57', isAdmin: true }) as unknown)

let sessionUser: { id: string; timezone: string; isAdmin?: boolean } = {
  id: 'u-tn57', timezone: 'Australia/Brisbane', isAdmin: true,
}
vi.mock('@/auth', () => ({ auth: async () => ({ user: sessionUser }) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))
const repo = () => ({
  listDayCheckins, getBodyBatteryHistory, listSleepSessions, getOuraDaily, getOuraDailyDerived,
  getUserById,
})
vi.mock('@/lib/data', () => ({ getRepository: async () => repo(), getRepositoryAsync: async () => repo() }))

const checkin = (logDate: string, over: Record<string, unknown> = {}) => ({
  id: `c-${logDate}`, userId: 'u-tn57', logDate, phase: 'morning',
  physicalTiredness: null, mentalDrain: null, barelyMoved: null, hydration: null, lateHeavyMeal: null,
  wakeMood: null, perceivedRecovery: 3, motivation: null, sleepQualityFeel: 3, restingSoreness: null,
  illnessContext: null, perceivedRecoveryTouched: false, sleepQualityFeelTouched: false,
  soreMuscles: [], journal: null, foodLoggingCompletedAt: null,
  createdAt: new Date(), updatedAt: new Date(),
  ...over,
})

beforeEach(() => {
  for (const m of [listDayCheckins, getBodyBatteryHistory, listSleepSessions, getOuraDaily,
                   getOuraDailyDerived]) { m.mockClear(); m.mockResolvedValue([]) }
  getUserById.mockClear(); getUserById.mockResolvedValue({ id: 'u-tn57', isAdmin: true })
  sessionUser = { id: 'u-tn57', timezone: 'Australia/Brisbane', isAdmin: true }
})

/**
 * Every assertion below counts PAIRED SAMPLES rather than reading a summary flag. A route that
 * errored, or one whose shape moved, produces no samples either — so each case has a positive
 * control beside it that must find them. The first draft of this file counted a field named `n`,
 * which does not exist; the negative cases passed against everything and the controls caught it.
 */
const samplesIn = (body: unknown): number => {
  const buckets = (body as { buckets?: { count?: number }[] } | null)?.buckets
  if (!Array.isArray(buckets)) throw new Error(`no buckets in ${JSON.stringify(body).slice(0, 200)}`)
  return buckets.reduce((sum, b) => sum + (b.count ?? 0), 0)
}

describe('the battery-recovery calibration stops fitting to a seed', () => {
  const load = async () => {
    const { GET } = await import('@/app/api/admin/battery-recovery-calibration/route')
    const res = await GET(new NextRequest('http://x/api/admin/battery-recovery-calibration') as never)
    expect(res.status).toBe(200)
    return res.json()
  }
  const days = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04']
  const battery = () => days.map((d, i) => ({ date: d, endValue: 30 + i * 15 }))

  it('pairs nothing from untouched rows', async () => {
    listDayCheckins.mockResolvedValue(days.map(d => checkin(d)))
    getBodyBatteryHistory.mockResolvedValue(battery())
    expect(samplesIn(await load())).toBe(0)
  })

  it('pairs the days that were answered', async () => {
    listDayCheckins.mockResolvedValue(
      days.map((d, i) => checkin(d, { perceivedRecovery: 1 + i, perceivedRecoveryTouched: true })))
    getBodyBatteryHistory.mockResolvedValue(battery())
    expect(samplesIn(await load())).toBe(days.length)
  })
})

describe('the subjective-recovery correlation stops plotting a seed', () => {
  const readinessRows = (days: string[]) => days.map((d, i) => ({ day: d, readinessScore: 60 + i * 5 }))

  it('has no paired points when nothing was answered', async () => {
    const days = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04']
    listDayCheckins.mockResolvedValue(days.map(d => checkin(d)))
    getOuraDailyDerived.mockResolvedValue(readinessRows(days))

    const { GET } = await import('@/app/api/health-trends/route')
    const res = await GET(new Request('http://x/api/health-trends?view=subjective-recovery') as never)
    expect(samplesIn(await res.json())).toBe(0)
  })

  it('plots the days that were answered', async () => {
    const days = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04']
    listDayCheckins.mockResolvedValue(
      days.map((d, i) => checkin(d, { perceivedRecovery: 1 + i, perceivedRecoveryTouched: true })))
    getOuraDailyDerived.mockResolvedValue(readinessRows(days))

    const { GET } = await import('@/app/api/health-trends/route')
    const res = await GET(new Request('http://x/api/health-trends?view=subjective-recovery') as never)
    expect(samplesIn(await res.json())).toBe(4)
  })
})

/**
 * The sleep-feel sibling, through the route rather than through a mocked `buildSleepFeelCalibration`
 * — `lib/__tests__/admin-report-calibration-routes.test.ts` already covers the map it hands over,
 * and both its fixtures moved with this change. This file exercises the real calibration on real
 * scores, so the two together say the value is dropped AND that dropping it empties the report.
 *
 * `sleep_quality_feel` was touched 3 times in 97 rows, so this route reads 3 answers instead of 78
 * seeded ones. A small number that is real beats a large one that is not.
 */
describe('the sleep-feel calibration stops fitting to a seed', () => {
  // A night that ENDS at 07:00 Brisbane ON `date` — which is 21:00 UTC the day BEFORE, since
  // Brisbane is UTC+10. Keying it to 21:00Z on `date` itself lands the night on the following local
  // day, so every check-in missed its night and the positive control found nothing.
  const night = (date: string, durationHours = 7.5) => {
    const end = new Date(new Date(`${date}T00:00:00Z`).getTime() - 3 * 3_600_000)
    return {
      date, durationHours, efficiency: 90, averageHrvMs: 55, avgHeartRate: 52,
      sleepStart: new Date(end.getTime() - durationHours * 3_600_000), sleepEnd: end,
    }
  }
  const days = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04']
  // The route reads 28 days before the window to build each night's baseline, and a night with no
  // baseline scores as null — so a fixture holding only the four days under test pairs nothing and
  // the negative case would pass for the wrong reason. The lead-in carries no check-ins.
  const leadIn = Array.from({ length: 28 }, (_, i) => night(shiftDateStr('2026-09-01', -(28 - i))))

  const load = async () => {
    const { GET } = await import('@/app/api/admin/sleep-feel-calibration/route')
    const res = await GET(new NextRequest(
      'http://x/api/admin/sleep-feel-calibration?from=2026-09-01&to=2026-09-04') as never)
    expect(res.status).toBe(200)
    return res.json()
  }

  // This route reports per-night rows rather than correlation buckets, so it gets its own counter.
  // Reusing `samplesIn` here read a field this shape does not have and quietly answered 0 for
  // everything — the same way the first draft of the buckets counter did.
  const feltNights = (body: unknown): number => {
    const rows = (body as { rows?: { feel: number | null }[] } | null)?.rows
    if (!Array.isArray(rows)) throw new Error(`no rows in ${JSON.stringify(body).slice(0, 200)}`)
    return rows.filter(r => r.feel != null).length
  }

  it('pairs nothing from untouched rows', async () => {
    listSleepSessions.mockResolvedValue([...leadIn, ...days.map(d => night(d))])
    listDayCheckins.mockResolvedValue(days.map(d => checkin(d)))
    const body = await load()
    // The nights themselves still score — it is only the self-report that goes away.
    expect((body as { rows: { modelScore: number | null }[] }).rows.filter(r => r.modelScore != null).length)
      .toBe(days.length)
    expect(feltNights(body)).toBe(0)
  })

  it('pairs the days that were answered', async () => {
    listSleepSessions.mockResolvedValue([...leadIn, ...days.map(d => night(d))])
    listDayCheckins.mockResolvedValue(
      days.map((d, i) => checkin(d, { sleepQualityFeel: 1 + i, sleepQualityFeelTouched: true })))
    expect(feltNights(await load())).toBe(days.length)
  })
})
