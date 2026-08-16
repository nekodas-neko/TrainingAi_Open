'use client'

import { useEffect, useState } from 'react'
import { formatTime } from '@/components/workout/utils'

// Leaf 1 Hz ticker (PERF-8) — owns its own setInterval so the whole screen
// (distance/pace/map) doesn't re-render every second; accounts for accumulated
// pause time the same way the orchestrator's tick used to.
export function ActivityElapsedClock({ startMs, accumulatedPauseMs, isPaused, pauseStartMs }: {
  startMs: number | null
  accumulatedPauseMs: number
  isPaused: boolean
  pauseStartMs: number | null
}) {
  const [elapsedSec, setElapsedSec] = useState(0)

  useEffect(() => {
    if (!startMs) return
    const tick = () => {
      const pauseMs = accumulatedPauseMs + (isPaused && pauseStartMs ? Date.now() - pauseStartMs : 0)
      setElapsedSec(Math.floor((Date.now() - startMs - pauseMs) / 1000))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [startMs, accumulatedPauseMs, isPaused, pauseStartMs])

  return <span className="text-6xl font-bold tabular-nums">{formatTime(elapsedSec)}</span>
}
