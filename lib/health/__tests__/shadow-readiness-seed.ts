// #2377 — a seeded, synthetic history for the shadow readiness DB tests and the local days-moved
// replay. Deterministic (a fixed PRNG), so two runs seed the same days. Not a fixture of anyone's
// real data.
import type { Pool } from 'pg'
import { dateStrMidnightInTz, shiftDateStr } from '@trainingai/shared/date-utils'
import { seedOrUpdateBaseline, type Baseline } from '@trainingai/shared/health/personal-baseline'
import { getRepository } from '@/lib/data'
import type { OuraDailySummaryRow } from '@/lib/data/repository'

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface SeedOptions {
  /** Last seeded wake day (inclusive). */
  end: string
  days: number
  tz: string
  seed?: number
}

/**
 * Seeds `days` nights and days ending on `end`: sleep sessions, overnight HRV/RHR, steps, SpO₂,
 * water, and the BLE daily summary with its running baselines (built with the rollup's own
 * `seedOrUpdateBaseline`), so the live composite has what it reads.
 */
export async function seedShadowHistory(pool: Pool, userId: string, opts: SeedOptions): Promise<string[]> {
  const rnd = mulberry32(opts.seed ?? 2377)
  const around = (centre: number, spread: number) => centre + (rnd() * 2 - 1) * spread
  const dates = Array.from({ length: opts.days }, (_, i) => shiftDateStr(opts.end, -(opts.days - 1 - i)))
  const summaries: OuraDailySummaryRow[] = []
  let hrvB: Baseline | null = null
  let rhrB: Baseline | null = null
  let tempB: Baseline | null = null
  let sleepB: Baseline | null = null
  let breathB: Baseline | null = null

  for (const [i, date] of dates.entries()) {
    const wake = dateStrMidnightInTz(date, opts.tz).getTime() + 6.5 * 3_600_000 + around(0, 0.5) * 3_600_000
    const hours = Math.round(around(7.4, 0.9) * 100) / 100
    const start = new Date(wake - hours * 3_600_000)
    const efficiency = Math.round(around(89, 5))
    const latencySec = Math.round(around(14, 9)) * 60
    const hrv = Math.round(around(55, 10))
    const rhr = Math.round(around(54, 3))
    const tempMean = Math.round(around(34.2, 0.25) * 100) / 100
    const breath = Math.round(around(15, 0.8) * 10) / 10

    await pool.query(
      `INSERT INTO sleep_sessions (user_id, date, sleep_start, sleep_end, duration_hours, efficiency, onset_latency_sec)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, date, start, new Date(wake), hours, efficiency, latencySec],
    )
    await pool.query(
      `INSERT INTO body_metrics (user_id, date, hrv_ms, resting_heart_rate, steps, spo2_pct, water_ml)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, date) DO UPDATE SET hrv_ms = EXCLUDED.hrv_ms, resting_heart_rate = EXCLUDED.resting_heart_rate,
         steps = EXCLUDED.steps, spo2_pct = EXCLUDED.spo2_pct, water_ml = EXCLUDED.water_ml`,
      [userId, date, hrv, rhr, Math.round(around(9000, 4000)), Math.round(around(96, 1.5) * 10) / 10, Math.round(around(2200, 600))],
    )

    const prevTemp: Baseline | null = tempB
    summaries.push({
      date,
      sleepDurationHours: hours,
      sleepEfficiency: efficiency,
      deepSleepHours: null,
      remSleepHours: null,
      restlessPeriods: null,
      sleepLatencySec: latencySec,
      hrvAvgMs: hrv,
      rhrLowBpm: rhr,
      rhrAvgBpm: rhr + 4,
      recoveryIndexHours: Math.round(around(4.2, 1.2) * 100) / 100,
      tempMeanC: tempMean,
      tempDevC: prevTemp ? Math.round((tempMean - prevTemp.meanX8 / 800) * 100) / 100 : null,
      metAvg: null,
      breathAvgRpm: breath,
      hrvBaseline: (hrvB = seedOrUpdateBaseline(hrvB, hrv, i)),
      rhrBaseline: (rhrB = seedOrUpdateBaseline(rhrB, rhr, i)),
      tempBaseline: (tempB = seedOrUpdateBaseline(tempB, Math.round(tempMean * 100), i)),
      sleepBaseline: (sleepB = seedOrUpdateBaseline(sleepB, Math.round(hours * 60), i)),
      metBaseline: null,
      breathBaseline: (breathB = seedOrUpdateBaseline(breathB, Math.round(breath * 10), i)),
      nHistory: i + 1,
    })
  }
  const repo = await getRepository()
  await repo.upsertOuraDailySummary(userId, summaries)
  return dates
}
