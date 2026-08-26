// Which Colmi ring this device is paired to.
//
// Stores the NAME as well as the id, and the name is what a re-pair matches on. The ring's BLE
// address is a random non-resolvable type (plan §11a): the evidence on whether it actually rotates
// is mixed — the advertised name and the System ID characteristic both embed it, which argues
// stable — so the id is kept as a fast path and the name as the thing that still works if it turns
// out not to be. A stored id that silently stops resolving would present as "ring not found",
// which reads identically to out-of-range.
const KEY = 'ta_paired_colmi_ring_v1'

export interface PairedRing { deviceId: string; name: string }

export function getPairedRing(): PairedRing | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) as PairedRing : null
  } catch { return null }
}

export function setPairedRing(r: PairedRing | null): void {
  if (typeof window === 'undefined') return
  try {
    if (r) window.localStorage.setItem(KEY, JSON.stringify(r))
    else window.localStorage.removeItem(KEY)
  } catch { /* storage unavailable — pairing simply won't persist */ }
}
