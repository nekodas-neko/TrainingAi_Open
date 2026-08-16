'use client'

import CalibrationCard, { type CalibrationView } from '@/components/admin/calibration-card'
import type { SleepFeelCalibration } from '@trainingai/shared/health/sleep-feel-calibration'

// Sleep Score vs the owner's own morning rating, over a window. Owner decision on finding Q-16:
// `sleep_quality_feel` stays out of the score and is a record to tune the curves against — so this
// card is read-only calibration evidence, never an input.
//
// The panel itself lives in `calibration-card.tsx`, shared with the Body Battery check (Q-79). The
// sleep API keeps its own `feel`/`nights` vocabulary, so the mapping happens here rather than by
// renaming a route contract other things read.

interface SleepResponse extends SleepFeelCalibration {
  timezone: string
  generatedAt: string
}

function toCalibrationView(raw: unknown): CalibrationView {
  const d = raw as SleepResponse
  const row = (r: SleepFeelCalibration['rows'][number]) => ({
    date: r.date,
    modelScore: r.modelScore,
    rating: r.feel,
    ratingLabel: r.feelLabel,
    ratingAsScore: r.feelAsScore,
    rankGapPct: r.rankGapPct,
  })
  return {
    ...d,
    rows: d.rows.map(row),
    buckets: d.buckets.map(b => ({
      rating: b.feel,
      label: b.label,
      count: b.nights,
      meanModelScore: b.meanModelScore,
      minModelScore: b.minModelScore,
      maxModelScore: b.maxModelScore,
    })),
    ratingRange: d.feelRange,
    worstDisagreements: d.worstDisagreements.map(row),
  }
}

export default function SleepFeelCalibrationCard() {
  return (
    <CalibrationCard
      title="Sleep Score vs how it felt"
      blurb="Each night's model score next to the rating you gave the next morning. Your rating does not feed the score — this is here so a systematic disagreement is visible and the curves can be tuned against it."
      endpoint="/api/admin/sleep-feel-calibration"
      modelLabel="Sleep Score"
      unit={{ one: 'night', many: 'nights' }}
      normalize={toCalibrationView}
    />
  )
}
