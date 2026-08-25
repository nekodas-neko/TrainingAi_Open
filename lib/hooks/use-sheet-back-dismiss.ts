'use client'

import { useEffect, useRef } from 'react'

// Pushes a history entry while a sheet is open so the Android back gesture
// closes the sheet instead of navigating the underlying page.
//
// Each instance uses a unique ID in the pushed state. The popstate handler
// only fires onClose when the state we're arriving at is NOT our own entry —
// this prevents a nested sheet's history.back() cleanup from cascading into
// parent sheet handlers and silently closing them.
//
// LB-10: the cleanup's own back() has to be swallowed, or React StrictMode's
// mount-time cleanup→effect pair closes the sheet on the frame it opened.
// history.back() resolves its delta when it is CALLED, not when it runs, so
// push → back() → push lands the popstate after the second push carrying the
// pre-push state — indistinguishable from a real back gesture, and it takes
// our entry with it. Measured in a browser: history.state and e.state both
// read null there, so neither can tell the two apart. selfPop can: when it is
// set the pop is ours, so we swallow it and re-push the entry it removed.
// `absorb` is what keeps that flag from outliving its pop — on an ordinary
// close nothing re-runs to consume it, and a stale flag would make the next
// open skip its push and leave the sheet with no entry at all.
export function useSheetBackDismiss(open: boolean, onClose: () => void) {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const idRef = useRef(`sheet-${Math.random().toString(36).slice(2)}`)
  const pushedRef = useRef(false)
  const selfPopRef = useRef(false)
  const absorbRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!open) return

    const id = idRef.current
    if (absorbRef.current) {
      window.removeEventListener('popstate', absorbRef.current)
      absorbRef.current = null
    }
    // Skip the push while our own back() is still in flight — it would be the
    // second of the two entries that pop then collapses.
    if (!selfPopRef.current) {
      window.history.pushState({ sheetId: id }, '')
      pushedRef.current = true
    }

    const handlePopState = (e: PopStateEvent) => {
      if (selfPopRef.current) {
        selfPopRef.current = false
        window.history.pushState({ sheetId: id }, '')
        pushedRef.current = true
        return
      }
      if (e.state?.sheetId !== id) {
        pushedRef.current = false
        onCloseRef.current()
      }
    }

    window.addEventListener('popstate', handlePopState)
    return () => {
      window.removeEventListener('popstate', handlePopState)
      if (!pushedRef.current) return
      pushedRef.current = false
      selfPopRef.current = true
      const absorb = () => {
        selfPopRef.current = false
        window.removeEventListener('popstate', absorb)
        absorbRef.current = null
      }
      absorbRef.current = absorb
      window.addEventListener('popstate', absorb)
      window.history.back()
    }
  }, [open])
}
