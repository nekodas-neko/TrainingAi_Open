'use client'

import { useEffect } from 'react'
import { Capacitor } from '@capacitor/core'
import { startAutoDetection, stopAutoDetection } from '@/lib/activity/auto-detection-service'
import { offerRingWalks } from '@/lib/activity/ring-walks'

export function AutoDetectionProvider() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return

    startAutoDetection().catch(console.error)
    // #2471: walks the ring saw are offered after every ring sync the app sees settle, including
    // the drain on app open, and once now for anything since the last time the app was open.
    void offerRingWalks()
    const onSynced = () => { void offerRingWalks() }
    window.addEventListener('ta:oura-ble-synced', onSynced)
    return () => {
      window.removeEventListener('ta:oura-ble-synced', onSynced)
      stopAutoDetection().catch(console.error)
    }
  }, [])

  return null
}
