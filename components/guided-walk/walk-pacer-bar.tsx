'use client'

import { memo, useEffect, useRef, useState } from 'react'
import type { CadenceTracker, CadenceTrackerSnapshot } from '@/lib/activity/cadence-tracker'
import { readPacer, bandColor, type PacerInput, type TargetPair } from '@/lib/walk/walk-pacer'
import { startPacerSampler, type PacerShown } from '@/lib/walk/pacer-sampler'
import { ProgressFill } from "@/components/ui/progress-fill";

/**
 * The live pacing verdict and its bar (Q-410).
 *
 * A leaf that owns its own cadence subscription, for the same reason `CadenceReadout` does: the
 * strap reports about once a second, and routing that through the walk screen would re-render the
 * countdown, the route map and the metric row on every reading.
 */
export const WalkPacerBar = memo(function WalkPacerBar({
  tracker, kind, speedKmh, bpm, cadenceTargets, speedTargets, hrTargets, segmentIndex, onTick,
}: {
  tracker: CadenceTracker | null
  kind: PacerInput['kind']
  speedKmh: number | null
  bpm: number | null
  cadenceTargets: TargetPair
  speedTargets: TargetPair | null
  hrTargets: TargetPair
  /** The segment this bar is pacing, and a once-a-second report of what it is showing (issue 2242). */
  segmentIndex?: number
  onTick?: (segmentIndex: number, shown: PacerShown, atMs: number) => void
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

  // What is on screen right now, for the sampler below. A ref, so counting never re-renders this.
  const shownRef = useRef<PacerShown | null>(null)
  shownRef.current = reading ? { signal: reading.signal, band: reading.band } : null
  const onTickRef = useRef(onTick)
  onTickRef.current = onTick
  useEffect(() => {
    if (segmentIndex == null) return
    return startPacerSampler(
      () => shownRef.current,
      (shown, atMs) => onTickRef.current?.(segmentIndex, shown, atMs),
    )
  }, [segmentIndex])

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
        <ProgressFill pct={reading.progress * 100} color={color} />
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
