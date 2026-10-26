import { handleStaleDataEpoch } from '@/lib/local-store/data-epoch'
import { DATA_EPOCH_STALE_HEADER } from '@/lib/auth/data-epoch-gate'

/**
 * #3369 — the app's reaction to the server's write gate. A write answered 409 `data-epoch-stale`
 * means an admin reset this account since the device last wiped; the device wipes and reloads
 * (`handleStaleDataEpoch`). Installed once at the root, so every upload path gets it — the sync
 * outbox, ring samples, accelerometer chunks, live steps, the Colmi ring, Health Connect — without
 * each remembering to look. The response itself is passed through untouched, so the caller still
 * sees the 409 and keeps whatever it was sending until the wipe reloads the page.
 */
let installed = false

export function installDataEpochFetchGuard(): void {
  if (installed || typeof window === 'undefined' || typeof window.fetch !== 'function') return
  installed = true
  const original = window.fetch.bind(window)
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const res = await original(...args)
    if (res.status === 409 && res.headers.get(DATA_EPOCH_STALE_HEADER) === '1') {
      res.clone().json().then(
        (body: { userId?: unknown }) => { void handleStaleDataEpoch(typeof body.userId === 'string' ? body.userId : null) },
        () => {},
      )
    }
    return res
  }
}
