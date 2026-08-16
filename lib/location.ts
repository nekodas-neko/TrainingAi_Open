import { Capacitor } from '@capacitor/core'
import type { LocationCoords } from '@/lib/weather/types'

const TIMEOUT_MS = 10_000
const MAX_AGE_MS = 60 * 60 * 1000

export async function getDeviceLocation(): Promise<LocationCoords | null> {
  if (Capacitor.isNativePlatform()) return getNativeLocation()
  return getWebLocation()
}

async function getNativeLocation(): Promise<LocationCoords | null> {
  try {
    const { Geolocation } = await import('@capacitor/geolocation')
    const status = await Geolocation.checkPermissions()
    if (status.location !== 'granted' && status.coarseLocation !== 'granted') {
      const requested = await Geolocation.requestPermissions()
      if (requested.location !== 'granted' && requested.coarseLocation !== 'granted') return null
    }
    const position = await Geolocation.getCurrentPosition({
      enableHighAccuracy: false,
      timeout: TIMEOUT_MS,
    })
    return { lat: position.coords.latitude, lon: position.coords.longitude }
  } catch {
    return null
  }
}

function getWebLocation(): Promise<LocationCoords | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.resolve(null)
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lon: position.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: TIMEOUT_MS, maximumAge: MAX_AGE_MS },
    )
  })
}
