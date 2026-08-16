'use client'

import { useEffect, useRef } from 'react'

// Pushes a history entry while a sheet is open so the Android back gesture
// closes the sheet instead of navigating the underlying page.
//
// Each instance uses a unique ID in the pushed state. The popstate handler
// only fires onClose when the state we're arriving at is NOT our own entry —
// this prevents a nested sheet's history.back() cleanup from cascading into
// parent sheet handlers and silently closing them.
export function useSheetBackDismiss(open: boolean, onClose: () => void) {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const idRef = useRef(`sheet-${Math.random().toString(36).slice(2)}`)

  useEffect(() => {
    if (!open) return

    const id = idRef.current
    window.history.pushState({ sheetId: id }, '')
    let pushed = true

    const handlePopState = (e: PopStateEvent) => {
      if (e.state?.sheetId !== id) {
        pushed = false
        onCloseRef.current()
      }
    }

    window.addEventListener('popstate', handlePopState)
    return () => {
      window.removeEventListener('popstate', handlePopState)
      if (pushed) window.history.back()
    }
  }, [open])
}
