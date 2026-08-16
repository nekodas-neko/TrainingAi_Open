// lib/live-hr/paired-strap.ts
// Persists the chosen chest strap across sessions. localStorage is sufficient
// because the Polar H10 advertises a STABLE public MAC (unlike the ring's
// rotating RPA) — the cached deviceId stays valid indefinitely.
const KEY = 'ta_paired_hr_strap_v1'

export interface PairedStrap { deviceId: string; name: string }

export function getPairedStrap(): PairedStrap | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) as PairedStrap : null
  } catch { return null }
}

export function setPairedStrap(s: PairedStrap | null): void {
  if (typeof window === 'undefined') return
  try {
    if (s) window.localStorage.setItem(KEY, JSON.stringify(s))
    else window.localStorage.removeItem(KEY)
  } catch { /* storage unavailable — pairing simply won't persist */ }
}
