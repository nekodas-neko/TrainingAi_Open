// Persists the chosen Renpho scale + the background-sync opt-in across sessions.
// localStorage is sufficient — the QN-Scale advertises a stable MAC (Phase 0 capture:
// A4:C1:38:ED:B4:07), same reasoning as lib/live-hr/paired-strap.ts.
const KEY = 'ta_paired_scale_v1'
const BG_SYNC_KEY = 'ta_scale_bg_sync_v1'

export interface PairedScale { deviceId: string; name: string }

export function getPairedScale(): PairedScale | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) as PairedScale : null
  } catch { return null }
}

export function setPairedScale(s: PairedScale | null): void {
  if (typeof window === 'undefined') return
  try {
    if (s) window.localStorage.setItem(KEY, JSON.stringify(s))
    else window.localStorage.removeItem(KEY)
  } catch { /* storage unavailable — pairing simply won't persist */ }
}

/** Whether the user opted into the backgrounded foreground-service sync. Read by
 *  capacitor-native-init.tsx on app open to decide whether to auto-start the service. */
export function getScaleBackgroundSyncEnabled(): boolean {
  if (typeof window === 'undefined') return false
  try { return window.localStorage.getItem(BG_SYNC_KEY) === 'true' } catch { return false }
}

export function setScaleBackgroundSyncEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return
  try { window.localStorage.setItem(BG_SYNC_KEY, enabled ? 'true' : 'false') } catch { /* ignore */ }
}
