'use client'

import { useEffect, type RefObject } from 'react'
import { handleResume } from '@/lib/resume-repaint'

/**
 * BF-110 — repaint the shell's scroll container when the app is looked at again.
 *
 * Placed on the container `PullToSync` already owns, for the reason BF-100's restoration hook is
 * there: every screen using the shell inherits it, and the report says *"pages often"* rather than
 * naming one screen. Fixing this in a component would look like a fix and hold for a day.
 *
 * **Not a reload.** BF-80 rules that out and `local-day-provider.tsx` repeats why — it costs the
 * instant-paint behaviour and trades an intermittent blank screen for a guaranteed two-second one.
 */
export function useResumeRepaint(ref: RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      const el = ref.current
      if (!el) return
      handleResume(el, cb => requestAnimationFrame(cb))
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [ref])
}
