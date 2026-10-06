// #2168 — the owner's scores do not move when Health Connect heart rate arrives.
//
// He wears a ring, and a ring outranks Health Connect (ingest architecture D2: rank decides what a
// score reads per interval, the loser is kept). So on a day the ring covers, Activity Score's
// zone-minutes and move-hours — the 22% of it that reads intraday HR — must come out identical
// with a dense, very different Health Connect series stored beside the ring's.
//
// Driven through the real `buildReadinessPayload`, with `getHrForWindow` served by the real
// database merge rather than a stub: the question is what the scoring path actually reads. Every
// other repository read is stubbed, as in `readiness-settled-before-checkin.test.ts`.
//
// The second case is the other half of the feature: a user with no ring gains both contributors.
//
// Runs only against a real local dev Postgres — skips in CI.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { fromZonedTime } from 'date-fns-tz'
import { todayInTz, shiftDateStr } from '@trainingai/shared/date-utils'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000022168'
const TZ = 'Australia/Brisbane'

const repo = vi.hoisted(() => ({
  listBodyMetrics: async () => [] as unknown[],
  listSleepSessions: async () => [] as unknown[],
  getWorkoutSessionsFrom: async () => [] as unknown[],
  getOuraDaily: async () => [] as unknown[],
  getActiveProgram: async () => null,
  getHrForWindow: async (userId: string, from: Date, to: Date) => {
    const { getDb } = await import('@/lib/data/postgres/client')
    const oura = await import('@/lib/data/postgres/slices/oura')
    return oura.getHrForWindow(getDb(), userId, from, to)
  },
  getOuraDailySummary: async () => [] as unknown[],
  getOuraDailyDerived: async () => [] as unknown[],
  getLatestOuraCloudVitals: async () => null,
  getMoodLog: async () => null,
  getUserById: async () => ({ timezone: 'Australia/Brisbane', dateOfBirth: '1990-01-01', sex: 'male', heightCm: 180 }),
  getUserGoals: async () => ({ stepsGoal: null }),
  upsertOuraDailyDerived: async () => undefined,
  upsertOuraDailySummary: async () => undefined,
}))

vi.mock('@/lib/data', () => ({
  getRepository: async () => repo,
  getRepositoryAsync: async () => repo,
}))

import { buildReadinessPayload } from '@/lib/health/readiness-payload'

const today = () => todayInTz(TZ)
/** A wall-clock instant on today's local day. */
const local = (hh: number, mm = 0, ss = 0) =>
  fromZonedTime(`${today()}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`, TZ)

/** Two weeks of resting HR, so the payload has the baseline its zone maths needs. */
const history = Array.from({ length: 14 }, (_, i) => ({
  date: shiftDateStr(todayInTz(TZ), -i), restingHeartRate: 55, hrvMs: 60, steps: 8000, activeCalories: 400,
}))

// Resting readings stay under the move threshold (5% of reserve, ~61 bpm at these settings), so
// only the two hard half hours count as moved — and any leaked Health Connect row would move both
// contributors visibly.
const hardAt = (m: number) => (m >= 8 * 60 && m < 8 * 60 + 30) || (m >= 17 * 60 && m < 17 * 60 + 30)

/** The ring's day: 5-minute bins 06:00–22:00, resting except a hard half hour at 08:00 and 17:00. */
function ringDay() {
  const rows: { timestamp: Date; bpm: number; source: string }[] = []
  for (let m = 6 * 60; m < 22 * 60; m += 5) {
    rows.push({ timestamp: local(Math.floor(m / 60), m % 60), bpm: hardAt(m) ? 132 : 56 + (m % 5), source: 'ble' })
  }
  return rows
}

/** A dense Health Connect series over the same hours, flat out — it would score very differently.
 *  Offset 7 s so no sample lands exactly on a ring bin, where the ring row keeps the slot (that
 *  case is `aggregator-heartrate.test.ts`'s); here every one of them is stored. */
function hcDay() {
  const rows: { timestamp: Date; bpm: number }[] = []
  for (let s = 6 * 3600 + 7; s < 22 * 3600; s += 30) {
    rows.push({ timestamp: local(Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60), bpm: 172 })
  }
  return rows
}

const scored = (p: Awaited<ReturnType<typeof buildReadinessPayload>>) => ({
  zoneMinutes: p.activitySignals?.zoneMinutes ?? null,
  moveHours: p.activitySignals?.moveHours ?? null,
  activityScore: p.activityScore,
  activityContributors: p.activityContributors,
  readiness: p.readinessDisplayScore,
  hr: [p.hrCurrent, p.hrMin, p.hrMax, p.hrAvg],
})

describe.skipIf(!canRun)('Health Connect heart rate is ranked below the ring (#2168)', () => {
  let pool: import('pg').Pool
  let db: ReturnType<typeof import('@/lib/data/postgres/client').getDb>
  let oura: typeof import('@/lib/data/postgres/slices/oura')

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    pool = client.getPool()
    db = client.getDb()
    oura = await import('@/lib/data/postgres/slices/oura')
    await pool.query(
      `INSERT INTO users (id, email, name, timezone) VALUES ($1, 'hc-hr-2168-score@local.dev', 'HC HR', $2) ON CONFLICT (id) DO NOTHING`,
      [USER, TZ])
    repo.listBodyMetrics = async () => history
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM daily_zone_minutes WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM oura_heartrate WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM oura_heartrate WHERE user_id = $1`, [USER])
  })

  it('scores a ring-covered day from the ring, with a Health Connect series stored beside it', async () => {
    await oura.upsertOuraHeartrate(db, USER, ringDay())
    const before = scored(await buildReadinessPayload(USER, TZ))

    // A control: a day with nothing in these contributors would pass the comparison vacuously.
    expect(before.zoneMinutes).toBeGreaterThan(0)
    expect(before.moveHours).toBe(2)

    await oura.upsertAggregatorHeartrate(db, USER, hcDay(), 'health_connect', TZ)
    const { rows: [{ n }] } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM oura_heartrate WHERE user_id = $1 AND source = 'health_connect'`, [USER])
    expect(n, 'the Health Connect rows are kept, not discarded').toBe(hcDay().length)

    const after = scored(await buildReadinessPayload(USER, TZ))
    expect(after).toEqual(before)
  })

  it('gives a user without a ring the zone-minutes and move-hours contributors', async () => {
    const before = scored(await buildReadinessPayload(USER, TZ))
    expect(before.zoneMinutes).toBeNull()
    expect(before.moveHours).toBeNull()

    // Readings every minute, with a hard half hour at 08:00 and 17:00.
    const series: { timestamp: Date; bpm: number }[] = []
    for (let m = 6 * 60; m < 22 * 60; m++) {
      series.push({ timestamp: local(Math.floor(m / 60), m % 60), bpm: hardAt(m) ? 132 : 57 })
    }
    await oura.upsertAggregatorHeartrate(db, USER, series, 'health_connect', TZ)

    const after = scored(await buildReadinessPayload(USER, TZ))
    expect(after.zoneMinutes).toBeGreaterThan(0)
    expect(after.moveHours).toBe(2)
    expect(Object.keys(after.activityContributors ?? {})).toEqual(expect.arrayContaining(['zoneMinutes', 'moveHours']))
  })
})
