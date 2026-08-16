'use client'

import { useEffect, useState } from 'react'

export function usePipMode(): boolean {
  const [isPip, setIsPip] = useState(false)

  useEffect(() => {
    function handler(e: Event) {
      setIsPip((e as CustomEvent<{ active: boolean }>).detail.active)
    }
    window.addEventListener('pipModeChanged', handler)
    return () => window.removeEventListener('pipModeChanged', handler)
  }, [])

  return isPip
}
