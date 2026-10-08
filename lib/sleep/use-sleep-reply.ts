import { useCallback } from 'react'
import { sleepReplyWithPending, type NightRef } from '@/lib/sleep/manual-night-view'

/**
 * Issue 2667 — the handler a screen hands `cachedFetch` / `fetchWithRetry` for `/api/sleep-sessions`.
 * The reply lags this device's own manual-night writes until the outbox pushes, so a night just
 * removed on the Sleep screen would show again; this applies the pending writes before `set`.
 */
export function useSleepReply<T extends NightRef>(userId: string | undefined, tz: string, set: (rows: T[]) => void) {
  return useCallback((reply: T[] | null) => { void sleepReplyWithPending<T>(reply, userId, tz).then(set) }, [userId, tz, set])
}
