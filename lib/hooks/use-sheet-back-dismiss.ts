'use client'

import { useEffect, useRef } from 'react'
import { closeSurface, handlePop, openSurface } from './sheet-back-stack'

// Pushes a history entry while a sheet is open so the Android back gesture
// closes the sheet instead of navigating the underlying page.
//
// **The decision logic lives in `sheet-back-stack.ts`** — when to close, when a
// pop is one of ours, how deep a surface sits. This file is the React wiring
// and nothing else, because all three bugs this has carried were in the logic
// and none of them was reachable from a test while it was tangled up in an
// effect. See that file for LB-10, LB-17 and BF-34.
//
// **One module-level listener owns the whole stack.** It used to be one per
// hook instance, which is why a sheet could not tell a pop aimed at a sibling
// from a real back gesture: the closing sheet's in-flight `history.back()` was
// invisible to the dialog that received it, so the dialog closed on the frame
// it opened. Keeping the listener attached for the lifetime of the page also
// means our own pop is swallowed even when it arrives with nothing open, which
// is what stops a stale flag leaking into the next sheet's push.

let attached = false

function onPop(e: PopStateEvent) {
  handlePop(e.state, window.history)
}

function ensureAttached() {
  if (attached || typeof window === 'undefined') return
  window.addEventListener('popstate', onPop)
  attached = true
}

export function useSheetBackDismiss(open: boolean, onClose: () => void) {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const idRef = useRef(`sheet-${Math.random().toString(36).slice(2)}`)

  useEffect(() => {
    if (!open) return
    ensureAttached()
    const surface = openSurface(idRef.current, () => onCloseRef.current(), window.history)
    return () => closeSurface(surface, window.history)
  }, [open])
}
