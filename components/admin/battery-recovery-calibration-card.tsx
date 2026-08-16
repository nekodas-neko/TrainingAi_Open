'use client'

import CalibrationCard from '@/components/admin/calibration-card'

// Q-79 — does the Body Battery model still agree with how recovered the owner says they feel?
//
// Measured over production: end-of-day battery → perceived recovery r = −0.400 (r|t = −0.414,
// p = 0.010, n = 39). Negative is agreement: the rating stores 1 = fully recovered … 5 = wrecked,
// and the card's engine flips it onto the model's higher-is-better axis before ranking, so a high
// "Agreement" number here means the model orders days the way the owner does.
//
// Deliberately admin-only. The gradient is modest and the owner already knows how they felt — the
// value is a regression check that survives model changes, not a headline.

export default function BatteryRecoveryCalibrationCard() {
  return (
    <CalibrationCard
      title="Body Battery vs how recovered you felt"
      blurb="Each day's end-of-day battery next to the recovery rating you gave that morning. Your rating does not feed the model — this is a standing check that the two still move together as the model changes."
      endpoint="/api/admin/battery-recovery-calibration"
      modelLabel="end-of-day Battery"
      unit={{ one: 'day', many: 'days' }}
    />
  )
}
