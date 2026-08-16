'use client'
import { useEffect, useRef, useState } from 'react'

export function TestTimer({ startedAtMs, durationSec, onExpire }: {
  startedAtMs: number
  durationSec: number | null
  onExpire: () => void
}) {
  const [elapsed, setElapsed] = useState(0)
  const firedRef = useRef(false)
  const onExpireRef = useRef(onExpire)
  onExpireRef.current = onExpire

  useEffect(() => {
    const tick = () => {
      const e = Math.floor((Date.now() - startedAtMs) / 1000)
      setElapsed(e)
      if (durationSec != null && e >= durationSec && !firedRef.current) {
        firedRef.current = true
        onExpireRef.current()
      }
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [startedAtMs, durationSec])

  // Count DOWN for fixed protocols, UP for self-paced.
  const shown = durationSec != null ? Math.max(0, durationSec - elapsed) : elapsed
  const mm = Math.floor(shown / 60)
  const ss = shown % 60
  return (
    <p className="text-6xl font-bold tabular-nums" aria-label="Time remaining">
      {mm}:{String(ss).padStart(2, '0')}
    </p>
  )
}
