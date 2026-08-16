'use client'

import { ContributorDetails } from '@/components/health/contributor-details'

/**
 * "Understanding your heart metrics" — the Heart-Rate pillar's version of the per-factor
 * explainers. Resting HR and HRV are the two heart signals that drive recovery; each is laid
 * out in full (what it measures / measured against / means / how to improve) with your own
 * recent values, matching the always-visible detail sections on the other pillars.
 */
export function HrFactorsCard({
  restingHr,
  recentHrv,
  baselineHrv,
}: {
  restingHr: number | null
  recentHrv: number | null
  baselineHrv: number | null
}) {
  return (
    <ContributorDetails
      title="Understanding your heart metrics"
      factors={[
        {
          key: 'resting_heart_rate',
          label: 'Resting heart rate',
          extra: restingHr != null ? <ValueLine>Lowest recorded today: {restingHr} bpm</ValueLine> : null,
        },
        {
          key: 'hrv_balance',
          label: 'Heart-rate variability (HRV)',
          extra:
            recentHrv != null || baselineHrv != null ? (
              <ValueLine>
                {recentHrv != null && <>Recent 7-day HRV {Math.round(recentHrv)} ms</>}
                {recentHrv != null && baselineHrv != null && ' · '}
                {baselineHrv != null && <>baseline {Math.round(baselineHrv)} ms</>}
              </ValueLine>
            ) : null,
        },
      ]}
    />
  )
}

function ValueLine({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Your values</p>
      <p className="mt-0.5 text-muted-foreground tabular-nums">{children}</p>
    </div>
  )
}
