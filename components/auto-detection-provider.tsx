'use client'

import { useEffect } from 'react'
import { Capacitor } from '@capacitor/core'
import { startAutoDetection, stopAutoDetection } from '@/lib/activity/auto-detection-service'

export function AutoDetectionProvider() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return

    startAutoDetection().catch(console.error)
    return () => { stopAutoDetection().catch(console.error) }
  }, [])

  return null
}
