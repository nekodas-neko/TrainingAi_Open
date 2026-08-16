import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { requireAdmin } from '@/lib/admin'
import { getRepositoryAsync } from '@/lib/data'
import { DEFAULT_TZ, toAestDay, dateStrMidnightInTz, secondsSinceLocalMidnight } from '@trainingai/shared/date-utils'
import { daytimeHrvCurve, type SleepInterval } from '@trainingai/shared/health/daytime-hrv'
import { intradayTempCurve } from '@trainingai/shared/health/intraday-temp'
import { intradaySpo2Curve } from '@trainingai/shared/health/intraday-spo2'
import { completenessForDay } from '@trainingai/shared/health/wear-confidence'
import type { OuraRawSampleRow } from '@/lib/data/repository'

const HRV_TAG = 0x5d
const TEMP_TAGS = [0x46, 0x69]
const SPO2_TAG = 0x8b
// on-finger signals the wear/completeness gate counts (mirror the rollup's worn-bin set)
const BIOMETRIC_TAGS = [0x5d, 0x80, 0x60, 0x6f, 0x8b, 0x86, 0x46, 0x69, 0x72, 0x75, 0x4b, 0x4e, 0x5a]
const WEAR_BIN_MIN = 15
const WEAR_BIN_SEC = WEAR_BIN_MIN * 60

export interface DeviceMetricsResponse {
  days: {
    date: string
    daytimeHrv: { tSec: number; rmssd: number }[]
    intradayTemp: { tSec: number; tempC: number }[]
    intradaySpo2: { tSec: number; spo2: number }[]
    completeness: { wornBins: number; expectedBins: number; pct: number; longestGapMin: number; lastSampleAgeMin: number }
  }[]
}

const avg = (a: number[]): number | null => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null)
const numArr = (decoded: unknown, key: string): number[] => {
  const v = (decoded as Record<string, unknown> | null)?.[key]
  return Array.isArray(v) ? (v.filter(n => typeof n === 'number') as number[]) : []
}

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    await requireAdmin(session.user.id, session.user.isAdmin)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const userId = session.user.id
  const tz = session.user?.timezone ?? DEFAULT_TZ
  const days = Math.min(14, Math.max(1, Number(new URL(req.url).searchParams.get('days') ?? '3')))

  const repo = await getRepositoryAsync()
  const rows = await repo.getOuraRawSamplesForTags(userId, BIOMETRIC_TAGS, days)

  // Bucket by user-local day using the already-stamped measured_at.
  const byDay = new Map<string, OuraRawSampleRow[]>()
  for (const r of rows) {
    if (!r.measuredAt) continue
    const day = toAestDay(new Date(r.measuredAt), tz)
    const bucket = byDay.get(day) ?? []
    if (!byDay.has(day)) byDay.set(day, bucket)
    bucket.push(r)
  }

  const todayIso = toAestDay(new Date(), tz)
  // Load the window's sleep sessions once, to exclude sleep from the daytime-HRV curve.
  const fromIso = [...byDay.keys()].sort()[0] ?? todayIso
  const sleepSessions = await repo.listSleepSessions(userId, fromIso, todayIso)

  const out: DeviceMetricsResponse['days'] = []
  for (const [date, dayRows] of [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0]))) {
    const midnightMs = dateStrMidnightInTz(date, tz).getTime()
    const secOfDay = (r: OuraRawSampleRow) =>
      Math.max(0, Math.floor((new Date(r.measuredAt as string).getTime() - midnightMs) / 1000))

    const hrvSamples = dayRows
      .filter(r => r.tag === HRV_TAG)
      .map(r => ({ tSec: secOfDay(r), rmssd: avg(numArr(r.decoded, 'rmssd_ms')) }))
      .filter((x): x is { tSec: number; rmssd: number } => x.rmssd != null)
    const tempSamples = dayRows
      .filter(r => TEMP_TAGS.includes(r.tag))
      .map(r => ({ tSec: secOfDay(r), tempC: avg(numArr(r.decoded, 'temps_c')) }))
      .filter((x): x is { tSec: number; tempC: number } => x.tempC != null)
    const spo2Samples = dayRows
      .filter(r => r.tag === SPO2_TAG)
      .map(r => ({ tSec: secOfDay(r), r: avg(numArr(r.decoded, 'r')) }))
      .filter((x): x is { tSec: number; r: number } => x.r != null)

    // Sleep intervals for this day, in seconds-since-local-midnight (clamped to the day).
    const sleep: SleepInterval[] = sleepSessions
      .filter(s => s.date === date)
      .map(s => ({
        startSec: Math.max(0, Math.floor((s.sleepStart.getTime() - midnightMs) / 1000)),
        endSec: Math.min(86_400, Math.floor((s.sleepEnd.getTime() - midnightMs) / 1000)),
      }))
      .filter(iv => iv.endSec > iv.startSec)

    const wornBinIndices = [...new Set(dayRows.map(r => Math.floor(secOfDay(r) / WEAR_BIN_SEC)))]
    const expectedBins = date === todayIso
      ? Math.ceil(secondsSinceLocalMidnight(tz) / WEAR_BIN_SEC)
      : Math.ceil(86_400 / WEAR_BIN_SEC) // 96

    out.push({
      date,
      daytimeHrv: daytimeHrvCurve(hrvSamples, sleep),
      intradayTemp: intradayTempCurve(tempSamples),
      intradaySpo2: intradaySpo2Curve(spo2Samples),
      completeness: completenessForDay({ wornBinIndices, expectedBins, binMinutes: WEAR_BIN_MIN }),
    })
  }

  return NextResponse.json({ days: out } satisfies DeviceMetricsResponse)
}
