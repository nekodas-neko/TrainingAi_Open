'use client'

import { useEffect, useState } from 'react'
import { isDevAppId } from '@/lib/platform/app-flavour'

/**
 * True inside the TrainingAi Dev app, false everywhere else (the real app, the web build, and
 * before the answer is known). Defaults to false so the real app and the web build never lose an
 * entry waiting on a native call; the Dev app hides its entries as soon as it knows (#2390).
 *
 * Capacitor is a dynamic import so it stays out of the web bundle, the same guard the update card
 * has always used.
 */
export function useIsDevApp(): boolean {
  const [isDev, setIsDev] = useState(false)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { Capacitor } = await import('@capacitor/core')
        if (!Capacitor.isNativePlatform()) return
        const { App } = await import('@capacitor/app')
        const info = await App.getInfo()
        if (!cancelled) setIsDev(isDevAppId(info.id))
      } catch { /* unknown stays "not dev": the real app's behaviour is unchanged */ }
    })()
    return () => { cancelled = true }
  }, [])
  return isDev
}
