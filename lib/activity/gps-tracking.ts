import type { RoutePoint } from './route-encoding'
import type { BackgroundGeolocationPlugin } from '@capacitor-community/background-geolocation'

export interface GpsWatcher {
  stop: () => Promise<void>
}

/**
 * Starts watching GPS position. On native (Capacitor) platforms this uses
 * @capacitor-community/background-geolocation, which keeps reporting
 * locations with the screen off via an Android foreground service. In the
 * browser (web/dev) it falls back to navigator.geolocation.watchPosition,
 * which only works while the tab is foregrounded.
 *
 * `onError` fires for both a rejected addWatcher() call (e.g. permission
 * denied) and a per-update error from the watcher callback — the caller is
 * responsible for surfacing this somewhere visible, since watchers otherwise
 * fail in a way that looks identical to "no movement yet".
 */
export async function startGpsWatcher(
  onPoint: (point: RoutePoint) => void,
  onError?: (message: string) => void,
): Promise<GpsWatcher> {
  const { Capacitor, registerPlugin } = await import('@capacitor/core')

  if (Capacitor.isNativePlatform()) {
    const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation')
    try {
      const id = await BackgroundGeolocation.addWatcher(
        {
          backgroundMessage: 'Tracking your walk or run',
          backgroundTitle: 'TrainingAI · Activity',
          requestPermissions: true,
          distanceFilter: 5,
        },
        (location, error) => {
          if (error) { onError?.(error.message || 'Location watcher error'); return }
          if (!location) return
          onPoint({
            lat: location.latitude,
            lng: location.longitude,
            ele: location.altitude ?? undefined,
            t: location.time ?? Date.now(),
          })
        },
      )
      return { stop: () => BackgroundGeolocation.removeWatcher({ id }) }
    } catch (err) {
      onError?.(err instanceof Error ? err.message : String(err))
      return { stop: async () => {} }
    }
  }

  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return { stop: async () => {} }
  }

  const watchId = navigator.geolocation.watchPosition(
    (pos) => onPoint({
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      ele: pos.coords.altitude ?? undefined,
      t: pos.timestamp,
    }),
    (err) => onError?.(err.message || 'Location watcher error'),
    { enableHighAccuracy: true },
  )
  return { stop: async () => navigator.geolocation.clearWatch(watchId) }
}
