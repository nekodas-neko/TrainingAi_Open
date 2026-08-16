'use client'

import { useEffect } from 'react'
import { getLiveHrManager } from '@/lib/live-hr/manager'
import { getPairedStrap } from '@/lib/live-hr/paired-strap'

/**
 * Keeps the chest strap connected all day (not just during a workout) so its
 * beat-accurate HR is the app-wide source whenever it's worn — the owner can't
 * battery-gate the strap's coin cell anyway, so there's no reason to gate the
 * connection. Ambient mode drives ONLY the strap; the Oura ring's aggressive
 * burst loop stays workout-only (see lib/live-hr/manager.ts), so this does not
 * drain the ring.
 *
 * Inert unless a strap is paired. The strap source itself no-ops off-device
 * (web/dev sandbox), so this is safe everywhere.
 *
 * On the APK the native foreground service owns the connection, so it survives
 * backgrounding. The in-WebView fallback path (web / older APK) is foreground-only.
 * See docs/superpowers/plans/2026-07-19-always-on-chest-strap-hr.md.
 */

/**
 * Both strap paths give up on an unreachable strap by design — the native service after its ~4 min
 * ladder, the WebView fallback after ~17 s. That is the right call for battery (the H10 only
 * advertises while worn, so an unworn strap is unreachable for hours), but nothing ever re-armed
 * them, so putting the strap on after launch did nothing until the app was restarted.
 *
 * This tick is what re-arms them. It is cheap by construction: the native service ignores a start
 * command while it already has a client, and retry() exits immediately while the link is up — so
 * once the strap IS connected, every tick is a no-op. It only does real work in exactly the state
 * the owner hit. Foreground-gated: an app in the background does not scan.
 */
const RETRY_EVERY_MS = 60_000

export function LiveHrAmbientProvider() {
  useEffect(() => {
    if (!getPairedStrap()) return
    const mgr = getLiveHrManager()
    mgr.startAmbient().catch(() => {})

    const retry = () => {
      if (document.visibilityState !== 'visible') return
      mgr.retryAmbient().catch(() => {})
    }
    const timer = setInterval(retry, RETRY_EVERY_MS)
    // Coming back to the app is the strongest "I want this now" signal there is — retry then too,
    // rather than waiting out the rest of the interval.
    document.addEventListener('visibilitychange', retry)

    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', retry)
      mgr.stopAmbient().catch(() => {})
    }
  }, [])
  return null
}
