// Thin wrapper over the native background-location bridge exposed by
// MainActivity as `window.AndroidLocation`. The Capacitor background-geolocation
// plugin only ever requests foreground ACCESS_FINE/COARSE_LOCATION — it never
// requests ACCESS_BACKGROUND_LOCATION — so a user who hasn't separately flipped
// their Android location permission to "Allow all the time" gets a watcher that
// silently never produces a fix while the app is backgrounded. This lets the UI
// check that state and send the user straight to the settings page for it.
//
// On web / non-native platforms the bridge is absent; every call reports
// "granted"/no-ops so nothing is shown where it doesn't apply.

interface AndroidLocationBridge {
  isBackgroundGranted: () => boolean
  openSettings: () => void
}

function bridge(): AndroidLocationBridge | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as unknown as { AndroidLocation?: AndroidLocationBridge }).AndroidLocation
}

export function isBackgroundLocationCheckAvailable(): boolean {
  return !!bridge()
}

export function isBackgroundLocationGranted(): boolean {
  return bridge()?.isBackgroundGranted() ?? true
}

export function openLocationSettings(): void {
  bridge()?.openSettings()
}
