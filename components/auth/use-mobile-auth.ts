'use client'

import { useEffect } from 'react'
import { completeAndroidSignIn } from '@/lib/auth/mobile/client'

export function useMobileAuth(hasSession: boolean) {
  useEffect(() => {
    let disposed = false
    let cleanup: (() => void) | undefined

    async function listen() {
      const { Capacitor } = await import('@capacitor/core')
      if (!Capacitor.isNativePlatform() || disposed) {
        return
      }
      const { App } = await import('@capacitor/app')
      const listener = await App.addListener('appUrlOpen', event => {
        if (!disposed) {
          void completeAndroidSignIn(event.url)
        }
      })
      if (disposed) {
        await listener.remove()
        return
      }
      cleanup = () => { void listener.remove() }

      const launch = await App.getLaunchUrl()
      if (!disposed && !hasSession && launch?.url) {
        void completeAndroidSignIn(launch.url)
      }
    }

    void listen()
    return () => {
      disposed = true
      cleanup?.()
    }
  }, [hasSession])
}
