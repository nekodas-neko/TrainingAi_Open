'use client'

import { useEffect } from 'react'
import { Capacitor } from '@capacitor/core'
import { startAutoDetection, stopAutoDetection } from '@/lib/activity/auto-detection-service'
import { offerRingWalks } from '@/lib/activity/ring-walks'
import { OURA_DATA_CHANGED_EVENT } from '@/lib/oura-data-changed'

export function AutoDetectionProvider() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return

    startAutoDetection().catch(console.error)
    // #2471: walks the ring saw are offered whenever new Oura data reaches the app (a Bluetooth drain
    // settling, or a sync pull carrying Oura's rows, #3077), and once now for anything since the
    // last time the app was open.
    void offerRingWalks()
    const onSynced = () => { void offerRingWalks() }
    window.addEventListener(OURA_DATA_CHANGED_EVENT, onSynced)
    return () => {
      window.removeEventListener(OURA_DATA_CHANGED_EVENT, onSynced)
      stopAutoDetection().catch(console.error)
    }
  }, [])

  return null
}
