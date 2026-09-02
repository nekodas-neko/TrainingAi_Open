'use client'
import { motion, useReducedMotion } from 'motion/react'

/**
 * One wash of the incoming phase's colour across the screen edges, keyed on the segment so
 * each change restarts it. It is a vignette rather than a full overlay because peripheral
 * vision is what has to catch this — the walker's eyes are on the path, not on the readout —
 * and a centred wash would dim the numbers it is trying to draw attention to.
 *
 * Under `prefers-reduced-motion` it still fires: the flash is a functional indicator, and the
 * repo's convention is that those keep their state and lose their motion. A cross-fade is the
 * whole animation, so there is nothing to freeze — it just runs longer and dimmer.
 */
export function PhaseChangeFlash({ cueKey, color }: { cueKey: number | null; color: string }) {
  const reduced = useReducedMotion()
  if (cueKey === null) return null
  return (
    <motion.div
      key={cueKey}
      aria-hidden
      className="pointer-events-none absolute inset-0 z-10"
      style={{
        background: `radial-gradient(circle at 50% 45%, transparent 25%, color-mix(in oklch, ${color} 45%, transparent) 100%)`,
      }}
      initial={{ opacity: 0 }}
      animate={{ opacity: [0, 1, 1, 0] }}
      transition={{ duration: reduced ? 1.1 : 0.8, times: [0, 0.12, 0.45, 1], ease: 'easeOut' }}
    />
  )
}
