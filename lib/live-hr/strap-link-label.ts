import type { StrapLinkStatus } from './chest-strap-source'

/**
 * What the pairing card says about the strap link.
 *
 * Kept out of the component and unit-tested because the previous inline version derived the label
 * from `gattConnected` and `active` alone: `active` is true from app start (ambient mode runs all
 * day), so EVERY non-ready state — including a service that had exhausted its retries and stopped
 * — rendered as "Connecting…" indefinitely (owner report, 2026-08-02).
 */
export function strapLinkLabel(link: StrapLinkStatus): string {
  if (link.gattConnected) {
    return link.worn
      ? 'Connected · on your chest'
      : 'Connected · no chest contact (ring takes over)'
  }
  if (!link.active) return 'Not connected — tap Connect, or it connects during workouts'
  switch (link.state) {
    case 'connecting':
    case 'preparing':
      return 'Connecting…'
    case 'idle':
    case 'disconnected':
    case 'closed':
      return 'Strap not reachable — retrying'
    default:
      return 'Not connected — tap Connect, or it connects during workouts'
  }
}
