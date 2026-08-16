'use client'

import { useEffect, useRef } from 'react'

export type PipAction = 'weightUp' | 'weightDown' | 'repsUp' | 'repsDown' | 'log'

interface Handlers {
  onWeightUp: () => void
  onWeightDown: () => void
  onRepsUp: () => void
  onRepsDown: () => void
  onLog: () => void
}

// Listens for pipAction events dispatched by the Android PiP broadcast receiver
// and routes them to the provided handlers. Uses a ref so the event listener
// is registered once and always calls the latest handler closures.
export function usePipActions(handlers: Handlers) {
  const ref = useRef(handlers)
  ref.current = handlers

  useEffect(() => {
    function handle(e: Event) {
      const action = (e as CustomEvent<{ action: PipAction }>).detail?.action
      if (!action) return
      switch (action) {
        case 'weightUp':   ref.current.onWeightUp();   break
        case 'weightDown': ref.current.onWeightDown(); break
        case 'repsUp':     ref.current.onRepsUp();     break
        case 'repsDown':   ref.current.onRepsDown();   break
        case 'log':        ref.current.onLog();        break
      }
    }
    window.addEventListener('pipAction', handle)
    return () => window.removeEventListener('pipAction', handle)
  }, [])
}
