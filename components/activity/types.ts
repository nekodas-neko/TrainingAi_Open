import type { Split, PacePoint, ElevationPoint } from '@/lib/activity/activity-metrics'

export type ActivityMode = 'pre' | 'active' | 'done'

export interface ActivityDraftSummary {
  durationMin: number
  distanceKm?: number
  routePolyline?: string
  splits?: Split[]
  bestEfforts?: Record<string, number>
  paceSeries?: PacePoint[]
  avgPaceSecPerKm?: number
  elevationGainM?: number
  elevationLossM?: number
  elevationProfile?: ElevationPoint[]
  cadenceSpm?: number
  cadenceSeries?: { tSec: number; spm: number }[]
  cadenceSource?: 'ring' | 'strap'
  /** Steps integrated from strap cadence readings at summarise time (Q-230). Carried on the draft
   *  because the binned `cadenceSeries` has lost the per-reading source the estimate is gated on. */
  cadenceStepsEstimate?: number
}
