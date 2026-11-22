// #3718 — the trends the daily check's rest signals read, from the rows the next-session read loads.
// One function so the server (`getNextSession` in the Postgres adapter) and the replay over past days
// (`scripts/tuning/rest-signals-replay-entry.ts`) build them the same way.
import type { BodyMetrics, SleepSession } from '@trainingai/shared/types/body'
import { sleepDurationTrendReading, sleepScoreTrendReading, type TrendReading } from '@trainingai/shared/health/sleep-trend'
import { hrvTrendReading, spo2TrendReading } from '@trainingai/shared/health/recovery-trends'
import { wearByDate } from '@trainingai/shared/health/wear-confidence'
import { ouraDailyWear } from '@/lib/oura/cloud/readiness-signals-map'

export interface RestTrends {
  sleepScore: TrendReading | null
  sleepDuration: TrendReading | null
  hrv: TrendReading | null
  spo2: TrendReading | null
}

/**
 * The four trends, over the 14 days before and including the day: sleep sessions, nightly body
 * metrics, and the daily rows whose wear time keeps unworn days out of the HRV baseline (the wear in
 * the generic shape the connector maps, #3668).
 */
export function restTrendsFromRows(
  sleepSessions: SleepSession[],
  bodyMetrics: readonly BodyMetrics[],
  dailyRows: readonly { date: string; nonWearTimeSec?: number | null }[],
  tz: string,
): RestTrends {
  return {
    sleepScore: sleepScoreTrendReading(sleepSessions, tz),
    sleepDuration: sleepDurationTrendReading(sleepSessions, tz),
    hrv: hrvTrendReading(bodyMetrics, sleepSessions, wearByDate(ouraDailyWear(dailyRows))),
    spo2: spo2TrendReading(bodyMetrics, sleepSessions),
  }
}
