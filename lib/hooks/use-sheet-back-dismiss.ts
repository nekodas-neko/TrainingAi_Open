'use client'

import { useEffect, useRef } from 'react'

// Pushes a history entry while a sheet is open so the Android back gesture
// closes the sheet instead of navigating the underlying page.
//
// Each instance uses a unique ID in the pushed state. The popstate handler
// only fires onClose when the state we're arriving at is BELOW our own entry —
// this prevents a nested sheet's history.back() cleanup from cascading into
// parent sheet handlers and silently closing them.
//
// LB-17: "below" has to be a DEPTH, not an id mismatch. An id test reads every
// entry that is not this sheet's own as "mine is gone", which is true only when
// nothing is stacked under it — at two layers the sheet underneath happens to
// be the one we land on, so it stayed correct by coincidence. At three, a back
// from the top lands on the MIDDLE sheet's entry and the bottom sheet sees a
// foreign id and closes itself, taking its whole subtree with it. Measured on
// the Q-395c nest (Log Food → My Foods → a meal): one press collapsed two
// layers. Each entry now carries the depth it was pushed at, and a sheet closes
// only when it arrives at something shallower than itself. An entry with no
// depth — the page itself — is depth 0, so a lone sheet still closes on back.
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

// The sheets that currently hold a history entry, innermost last. Module scope
// because depth is a property of the STACK, not of any one sheet — a sheet
// cannot know how many are open under it. Ids rather than a bare counter so a
// sheet that closes out of order removes its own slot instead of decrementing
// someone else's.
const openSheetIds: string[] = []

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
    openSheetIds.push(id)
    const depth = openSheetIds.length
    // Skip the push while our own back() is still in flight — it would be the
    // second of the two entries that pop then collapses.
    if (!selfPopRef.current) {
      window.history.pushState({ sheetId: id, sheetDepth: depth }, '')
      pushedRef.current = true
    }

    const handlePopState = (e: PopStateEvent) => {
      if (selfPopRef.current) {
        selfPopRef.current = false
        window.history.pushState({ sheetId: id, sheetDepth: depth }, '')
        pushedRef.current = true
        return
      }
      const arrivedDepth = typeof e.state?.sheetDepth === 'number' ? e.state.sheetDepth : 0
      if (arrivedDepth < depth) {
        pushedRef.current = false
        onCloseRef.current()
      }
    }

    window.addEventListener('popstate', handlePopState)
    return () => {
      window.removeEventListener('popstate', handlePopState)
      const slot = openSheetIds.lastIndexOf(id)
      if (slot !== -1) openSheetIds.splice(slot, 1)
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
