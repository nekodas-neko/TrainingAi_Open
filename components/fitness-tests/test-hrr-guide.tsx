'use client'
import { useEffect, useRef, useState } from 'react'
import { hapticLight, hapticSuccess } from '@/lib/haptics'
import { phasesTotalSec, type HrrPhase } from '@trainingai/shared/fitness-tests/protocols'

// Leaf that drives the guided rest→effort→recovery phases and owns the 1 Hz tick,
// so the parent TestActive (which holds the HR subscription) never re-renders on the
// timer. Prompts the user through each phase, buzzes on transitions, and calls
// onExpire() once the final phase completes.
export function TestHrrGuide({ startedAtMs, phases, onExpire }: {
  startedAtMs: number
  phases: HrrPhase[]
  onExpire: () => void
}) {
  const [elapsed, setElapsed] = useState(0)
  const firedRef = useRef(false)
  const lastPhaseRef = useRef(-1)
  const onExpireRef = useRef(onExpire)
  onExpireRef.current = onExpire

  const total = phasesTotalSec(phases)

  useEffect(() => {
    const tick = () => {
      const e = Math.floor((Date.now() - startedAtMs) / 1000)
      setElapsed(e)
      if (e >= total && !firedRef.current) {
        firedRef.current = true
        onExpireRef.current()
      }
    }
    tick()
    const id = setInterval(tick, 250)
    return () => clearInterval(id)
  }, [startedAtMs, total])

  // Resolve the current phase and its remaining seconds from cumulative offsets.
  let acc = 0
  let index = phases.length - 1
  let phaseRemaining = 0
  for (let k = 0; k < phases.length; k++) {
    if (elapsed < acc + phases[k].durationSec) {
      index = k
      phaseRemaining = acc + phases[k].durationSec - elapsed
      break
    }
    acc += phases[k].durationSec
  }
  const current = phases[index]

  // Buzz on each phase change (skip the initial mount) — the last non-recovery
  // transition into 'recovery' gets the stronger success cue so the user knows to stop.
  useEffect(() => {
    if (lastPhaseRef.current !== -1 && index !== lastPhaseRef.current) {
      if (current.key === 'recovery') hapticSuccess()
      else hapticLight()
    }
    lastPhaseRef.current = index
  }, [index, current.key])

  const mm = Math.floor(phaseRemaining / 60)
  const ss = phaseRemaining % 60
  const accent = current.key === 'effort' ? 'var(--color-brand)' : 'var(--color-muted-foreground)'

  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: accent }}>
        {current.label} · step {index + 1} of {phases.length}
      </p>
      <p className="text-7xl font-bold tabular-nums" aria-label="Phase time remaining">
        {mm}:{String(ss).padStart(2, '0')}
      </p>
      <p className="max-w-xs text-sm text-muted-foreground">{current.instruction}</p>
    </div>
  )
}
