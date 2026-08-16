'use client'

import { memo, useEffect, useState } from 'react'
import { FootprintsIcon } from '@phosphor-icons/react'
import type { CadenceTracker, CadenceTrackerSnapshot } from '@/lib/activity/cadence-tracker'

/**
 * Live cadence during an activity.
 *
 * A leaf that owns its own subscription: the strap updates roughly once a second, and
 * pushing that through the activity screen's state would re-render the map and route on
 * every reading. Same reason the elapsed clock is its own component.
 */
export const CadenceReadout = memo(function CadenceReadout({ tracker }: {
  tracker: CadenceTracker | null
}) {
  const [snap, setSnap] = useState<CadenceTrackerSnapshot | null>(null)

  useEffect(() => {
    if (!tracker) { setSnap(null); return }
    setSnap(tracker.snapshot())
    return tracker.subscribe(setSnap)
  }, [tracker])

  const spm = snap?.liveSpm ?? null

  return (
    <div>
      <p className="text-2xl font-bold tabular-nums">{spm === null ? '--' : Math.round(spm)}</p>
      <p className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
        <FootprintsIcon size={12} />
        spm
        {/* Source is shown as text, never as colour alone. It matters to the reader: the ring
            updates every ~30s and the strap every second, so which one is behind the number
            explains why it is or isn't tracking a pace change. */}
        {snap?.liveSource && <span className="opacity-70">· {snap.liveSource}</span>}
      </p>
    </div>
  )
})
