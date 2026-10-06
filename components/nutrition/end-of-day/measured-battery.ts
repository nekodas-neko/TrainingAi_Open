import type { BodyBatteryLabel } from '@trainingai/shared/health/body-battery-band'

/** The slice of `/api/body-battery` the end-of-day review reads. */
export interface EndOfDayBattery {
  current: number
  label: BodyBatteryLabel
  trend: string
  charged: number
  drained: number
  /** False when no HR drove the arc: `current` is then the route's default 50, not a reading.
   *  Optional on read so a payload cached without it still renders as before. */
  hasData?: boolean
}

/**
 * #2337 — the battery only when something measured it.
 *
 * A no-ring day comes back `hasData: false` with the default 50, and the review printed it as
 * "Body Battery 50 (down 0)", showed it as a chip on the day summary, and pre-set the tiredness
 * slider from its "Good" label. The Body Battery card already refuses to present that default as a
 * reading (`components/body-battery-card.tsx`, `noData`); every use on this screen goes through here.
 */
export function measuredBattery<T extends Pick<EndOfDayBattery, 'current' | 'hasData'>>(bb: T | null | undefined): T | null {
  return bb != null && bb.hasData !== false ? bb : null
}
