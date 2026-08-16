import { hrMaxFromAge, computeHrZones } from '@trainingai/shared/health/hr-zones'
import type { PillarAudit } from './types'

export interface HeartRateAuditInput {
  date: string
  hrRows: { timestamp: Date; bpm: number; source: string | null }[]
  /** 7-day mean resting HR (the card's headline) and the 28-day low-wear-excluded baseline. */
  recentRhr: number | null
  baselineRhr: number | null
  recentHrv: number | null
  baselineHrv: number | null
  ageYears: number | null
  /** Rows contributing to each baseline, for judging how trustworthy it is. */
  rhrSampleDays: number
  hrvSampleDays: number
  lowWearDaysExcluded: number
}

export function buildHeartRateAudit(input: HeartRateAuditInput): PillarAudit {
  const {
    date, hrRows, recentRhr, baselineRhr, recentHrv, baselineHrv, ageYears,
    rhrSampleDays, hrvSampleDays, lowWearDaysExcluded,
  } = input

  const gaps: string[] = []
  const notes: string[] = []

  const bpms = hrRows.map(r => r.bpm)
  const hrMin = bpms.length ? Math.min(...bpms) : null
  const hrMax = bpms.length ? Math.max(...bpms) : null
  const hrAvg = bpms.length ? Math.round(bpms.reduce((s, b) => s + b, 0) / bpms.length) : null

  // Coverage matters more than the values here: a resting-HR reading built from 40 minutes of a
  // 24-hour day is not the same measurement as one built from full-day wear.
  const bySource = hrRows.reduce<Record<string, number>>((acc, r) => {
    const k = r.source ?? 'unknown'
    acc[k] = (acc[k] ?? 0) + 1
    return acc
  }, {})
  const spanHours = hrRows.length > 1
    ? (Math.max(...hrRows.map(r => r.timestamp.getTime())) - Math.min(...hrRows.map(r => r.timestamp.getTime()))) / 3_600_000
    : 0

  if (hrRows.length === 0) gaps.push(`No intraday HR samples for ${date} — the ring/strap either wasn't worn or hasn't synced.`)
  if (baselineRhr == null) gaps.push('No 28-day resting-HR baseline (needs ≥5 qualifying days) — nothing to judge today\'s resting HR against, and HR zones can\'t be built.')
  if (baselineHrv == null) gaps.push('No 28-day HRV baseline (needs ≥5 qualifying days).')
  if (lowWearDaysExcluded > 0) {
    notes.push(`${lowWearDaysExcluded} low-wear day(s) were excluded from the 28-day baselines — partial-wear days skew resting HR low and HRV high.`)
  }
  if (hrRows.length > 0 && spanHours < 12) {
    notes.push(`HR samples span only ${spanHours.toFixed(1)}h of the day — treat the min/avg as partial-day, not a full-day resting measure.`)
  }

  const rhrDelta = recentRhr != null && baselineRhr != null ? recentRhr - baselineRhr : null
  const hrvDelta = recentHrv != null && baselineHrv != null ? recentHrv - baselineHrv : null

  const maxHr = ageYears != null ? hrMaxFromAge(ageYears) : null
  const zones = maxHr != null && baselineRhr != null ? computeHrZones({ maxHr, restingHr: baselineRhr }) : null

  return {
    pillar: 'heartRate',
    label: 'Heart Rate',
    // Deliberately not a 0-100 score: this card displays a measurement against a personal baseline,
    // so there is no weighted model to audit — the tuning surface here is the baselines themselves.
    score: null,
    band: null,
    source: 'measurement vs personal baseline (no weighted model)',
    model: {
      note: 'The Heart Rate card is a raw measurement plus a baseline comparison, not a scored model. '
        + 'Tuning levers are the baseline windows (28-day, low-wear excluded) and the ≥5-day minimum sample.',
      baselineWindowDays: 28,
      recentWindowDays: 7,
      minSampleDays: 5,
      maxHrFormula: 'hrMaxFromAge(age)',
    },
    inputs: {
      restingHrRecent7d: { value: recentRhr != null ? Math.round(recentRhr) : null, unit: 'bpm', source: 'body_metrics.resting_heart_rate (7-day mean)', note: 'The value the card shows.' },
      restingHrBaseline28d: { value: baselineRhr != null ? Math.round(baselineRhr) : null, unit: 'bpm', source: 'body_metrics (28-day mean, low-wear days excluded)' },
      restingHrDelta: { value: rhrDelta != null ? Math.round(rhrDelta * 10) / 10 : null, unit: 'bpm vs baseline', note: 'Positive = elevated vs your norm.' },
      hrvRecent7d: { value: recentHrv != null ? Math.round(recentHrv) : null, unit: 'ms rMSSD' },
      hrvBaseline28d: { value: baselineHrv != null ? Math.round(baselineHrv) : null, unit: 'ms rMSSD' },
      hrvDelta: { value: hrvDelta != null ? Math.round(hrvDelta * 10) / 10 : null, unit: 'ms vs baseline' },
      rhrSampleDays: { value: rhrSampleDays, unit: 'days', note: 'Days feeding the 28-day resting-HR baseline (≥5 required).' },
      hrvSampleDays: { value: hrvSampleDays, unit: 'days', note: 'Days feeding the 28-day HRV baseline (≥5 required).' },
      intradaySampleCount: { value: hrRows.length, unit: 'samples', source: 'oura_heartrate' },
      intradaySpanHours: { value: Math.round(spanHours * 10) / 10, unit: 'h' },
      intradaySources: { value: JSON.stringify(bySource), note: 'Sample counts by source (ring / strap / workout).' },
      hrMinToday: { value: hrMin, unit: 'bpm' },
      hrAvgToday: { value: hrAvg, unit: 'bpm' },
      hrMaxToday: { value: hrMax, unit: 'bpm' },
      estimatedMaxHr: { value: maxHr, unit: 'bpm', note: 'Age-derived — the basis for the zone boundaries used by Activity.' },
      hrZones: { value: zones ? JSON.stringify(zones) : null, note: 'Karvonen zones from estimated max HR + baseline resting HR. These drive the Activity zone-minutes contributor.' },
    },
    contributors: [],
    gaps,
    stored: { score: null, contributors: null, source: null },
    storedMatchesRecompute: null,
    notes,
  }
}
