'use client'

import { useEffect, useState } from 'react'
import { CadenceTracker } from './cadence-tracker'
import { supportsCadence } from '@trainingai/shared/health/cadence'

/** Owns a CadenceTracker's lifecycle for foot-based activities: creates it on mount,
 *  starts it against the activity's startMs, and stops/tears it down on unmount (must
 *  not be skipped — the strap's accelerometer stream would otherwise keep running and
 *  drain it for the rest of the day). Shared between the generic activity screen and
 *  the dedicated run screen so the lifecycle isn't duplicated. */
export function useCadenceTracking(activityType: string | null, startMs: number | null): {
  tracker: CadenceTracker | null
  enabled: boolean
} {
  const enabled = supportsCadence(activityType)
  const [tracker, setTracker] = useState<CadenceTracker | null>(null)

  useEffect(() => {
    if (!enabled) return
    const t = new CadenceTracker()
    setTracker(t)
    void t.start(startMs ?? Date.now())
    return () => {
      setTracker(null)
      void t.stop()
    }
    // Deliberately not keyed on isPaused — a pause is a standing rest, which simply
    // produces no cadence readings. Tearing the BLE stream down and back up would
    // cost more than it saves.
  }, [enabled, startMs])

  return { tracker, enabled }
}
