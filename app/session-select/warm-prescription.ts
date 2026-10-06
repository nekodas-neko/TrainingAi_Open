import { invalidatePrescriptionChanged } from '@/lib/cache-groups'

// One warm per session per local day from this device. The route is cheap to call when nothing is
// needed, but Home re-renders constantly and a request per render would still be a request per render.
const warmed = new Set<string>()

/**
 * Ask the server to generate today's prescription for `sessionId` while Home is on screen (#2155),
 * so the workout tab opens on it instead of on "Preparing your AI workout…".
 *
 * Fire-and-forget. The server decides whether a generation is due and runs at most one; when one
 * lands, the caches that still say "preparing" are cleared so the tab paints the new plan. A failed
 * request forgets its key, so the next visit to Home tries again.
 */
export function warmPrescription(sessionId: string, localDay: string): void {
  const key = `${sessionId}:${localDay}`
  if (warmed.has(key)) return
  warmed.add(key)
  fetch(`/api/ai-periodization/session/${encodeURIComponent(sessionId)}/warm`, { method: 'POST' })
    .then(res => (res.ok ? res.json() as Promise<{ status?: string }> : null))
    .then(body => {
      if (body?.status === 'generated') invalidatePrescriptionChanged(sessionId).catch(() => {})
      else if (body == null || body.status === 'failed') warmed.delete(key)
    })
    .catch(() => warmed.delete(key))
}
