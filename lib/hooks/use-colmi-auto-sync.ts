'use client'

// Mounted once in the tab shell, which never unmounts — so this is the app being open, not a screen
// being visited. See `lib/colmi-ble/auto-sync.ts` for why the ring cannot wait to be synced by hand.
import { useEffect, useRef } from 'react'
import { formatInTimeZone } from 'date-fns-tz'
import { syncColmiRing } from '@/lib/colmi-ble/ble'
import { attemptAutoSync, colmiAutoSyncDeps, AUTO_SYNC_INTERVAL_MS } from '@/lib/colmi-ble/auto-sync'
import { nowPartsInTz } from '@/lib/colmi-ble/resolve-time'

/** How long after a resume to try. The WebView is still settling the radio right after a resume,
 *  and a connect issued into that window fails in a way that looks like an absent ring. */
const RESUME_DELAY_MS = 4_000

export function useColmiAutoSync(timezone: string): void {
  // The timezone is read at call time, not captured, so a Profile change reaches the next sync
  // without re-arming the interval.
  const tzRef = useRef(timezone)
  tzRef.current = timezone

  useEffect(() => {
    let cancelled = false

    const run = () => {
      if (cancelled) return
      void attemptAutoSync({
        ...colmiAutoSyncDeps,
        runSync: () => syncColmiRing({
          todayStr: formatInTimeZone(new Date(), tzRef.current, 'yyyy-MM-dd'),
          timezone: tzRef.current,
          now: nowPartsInTz(tzRef.current),
        }),
      })
    }

    const onVisible = () => { if (document.visibilityState === 'visible') setTimeout(run, RESUME_DELAY_MS) }

    const first = setTimeout(run, RESUME_DELAY_MS)
    const timer = setInterval(run, AUTO_SYNC_INTERVAL_MS)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      clearTimeout(first)
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])
}
