// The ring-battery read's refusal back-off (#3069), held apart from `webhook.ts` so `tokens.ts` can
// clear it when a connection is renewed without importing the webhook (which imports tokens).

/** After a refusal (401, 403, or a connection needing the user), the read waits this long before trying again. */
export const RING_BATTERY_REFUSED_BACKOFF_MS = 24 * 60 * 60 * 1000

// Held in this process, so a restart retries once more; that is a bounded cost.
const refusedAt = new Map<string, number>()

export function isRingBatteryBackedOff(userId: string, now: number): boolean {
  const at = refusedAt.get(userId)
  return at !== undefined && now - at < RING_BATTERY_REFUSED_BACKOFF_MS
}

export function markRingBatteryRefused(userId: string, now: number): void {
  refusedAt.set(userId, now)
}

/** A new or renewed grant may carry the scope the last one lacked, so the read tries again at once. */
export function clearRingBatteryBackoff(userId: string): void {
  refusedAt.delete(userId)
}

/** Test seam: forget every user's back-off. */
export function resetRingBatteryBackoff(): void {
  refusedAt.clear()
}
