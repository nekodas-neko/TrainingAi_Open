'use client'

import { memo, useEffect, useState } from 'react'
import { FootprintsIcon, MountainsIcon } from '@phosphor-icons/react'
import type { CadenceTracker, CadenceTrackerSnapshot } from '@/lib/activity/cadence-tracker'

/**
 * The quieter half of the free-activity metric row (Q-418): cadence source, running step total,
 * elevation gained.
 *
 * **Separate from the primary row because four `text-2xl` figures fit on a 412 px screen and six do
 * not.** Distance, pace and heart rate are the numbers you act on mid-walk; these are the ones you
 * glance at. That hierarchy is the guided walk's, which is already this app's answer to the
 * question.
 *
 * A leaf with its own subscription, for the same reason as `CadenceReadout`: the strap reports about
 * once a second and the screen renders a route map.
 */
export const ActivitySecondaryMetrics = memo(function ActivitySecondaryMetrics({
  tracker, elevationGainM,
}: {
  tracker: CadenceTracker | null
  /** Metres climbed so far, or null when there is no usable elevation in the track. */
  elevationGainM: number | null
}) {
  const [snap, setSnap] = useState<CadenceTrackerSnapshot | null>(null)

  useEffect(() => {
    if (!tracker) { setSnap(null); return }
    setSnap(tracker.snapshot())
    return tracker.subscribe(setSnap)
  }, [tracker])

  // Each is hidden rather than shown as zero. A step total is integrated cadence and is
  // **strap-only** — with no strap it does not exist, and `0 steps` on a 40-minute walk reads as a
  // broken counter rather than an absent sensor. Elevation is the same on a flat route.
  const steps = snap?.stepsEstimate ?? null
  const parts: { key: string; icon: React.ReactNode; text: string }[] = []
  if (steps != null && steps > 0) {
    parts.push({ key: 'steps', icon: <FootprintsIcon size={12} />, text: `~${Math.round(steps).toLocaleString()} steps` })
  }
  if (elevationGainM != null && elevationGainM >= 1) {
    parts.push({ key: 'elev', icon: <MountainsIcon size={12} />, text: `${Math.round(elevationGainM)} m up` })
  }
  if (parts.length === 0) return null

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {parts.map(p => (
        <span key={p.key} className="flex items-center gap-1 tabular-nums">
          {p.icon}
          {p.text}
        </span>
      ))}
    </div>
  )
})
