'use client'

import { memo, useEffect, useState } from 'react'
import type { CadenceTracker, CadenceTrackerSnapshot } from '@/lib/activity/cadence-tracker'
import { readPacer, bandColor, type PacerInput, type TargetPair } from '@/lib/walk/walk-pacer'

/**
 * The live pacing verdict and its bar (Q-410).
 *
 * A leaf that owns its own cadence subscription, for the same reason `CadenceReadout` does: the
 * strap reports about once a second, and routing that through the walk screen would re-render the
 * countdown, the route map and the metric row on every reading.
 */
export const WalkPacerBar = memo(function WalkPacerBar({
  tracker, kind, speedKmh, bpm, cadenceTargets, speedTargets, hrTargets,
}: {
  tracker: CadenceTracker | null
  kind: PacerInput['kind']
  speedKmh: number | null
  bpm: number | null
  cadenceTargets: TargetPair
  speedTargets: TargetPair | null
  hrTargets: TargetPair
}) {
  const [snap, setSnap] = useState<CadenceTrackerSnapshot | null>(null)

  useEffect(() => {
    if (!tracker) { setSnap(null); return }
    setSnap(tracker.snapshot())
    return tracker.subscribe(setSnap)
  }, [tracker])

  const reading = readPacer({
    kind, cadenceSpm: snap?.liveSpm ?? null, speedKmh, bpm, cadenceTargets, speedTargets, hrTargets,
  })
  if (!reading) return null

  const color = bandColor(reading.band)

  return (
    <div className="w-full max-w-xs space-y-1.5">
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-[color:var(--border)]"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(reading.progress * 100)}
        aria-label={reading.message}
      >
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${reading.progress * 100}%`, background: color }}
        />
      </div>
      {/* The mark and the sentence are not decoration — the band is also carried by colour, and
          colour alone is not allowed to be the whole message. */}
      <p className="text-sm font-semibold" style={{ color }}>
        <span aria-hidden className="mr-1">{reading.mark}</span>
        {reading.message}
      </p>
      {reading.fallbackNote && (
        <p className="text-xs text-muted-foreground">{reading.fallbackNote}</p>
      )}
    </div>
  )
})
