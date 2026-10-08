"use client"

import { useEffect, useRef, useState } from 'react'
import { History, Loader2, Square } from 'lucide-react'
import { toast } from 'sonner'
import { todayInTz } from '@trainingai/shared/date-utils'
import { useUserTimezone } from '@/components/shell/user-timezone-provider'
import { invalidateActivityWrites, invalidateBiometrics, invalidatePulledDomains } from '@/lib/cache-groups'
import { pullDelta } from '@/lib/local-store/sync-engine'
import {
  fetchHistoryOldest, formatImportedTo, importEndMessage, importMoreHistory,
  HISTORY_WINDOW_DAYS,
} from '@/lib/health-connect-history-import'

/**
 * "Import more history" (issue 2169): pulls older Health Connect data in, 30 days a window, each
 * window older than the last, until Health Connect has nothing more or the user taps Stop. A second
 * press continues from the account's stored oldest day. Health Connect exists only in the native app,
 * so on the web build the row does not render.
 *
 * One control, the existing row pattern of Data & Sync: while a run is going the same row becomes
 * "Stop importing" and its second line shows how far back it has reached.
 */
export function HistoryImportRow({ userId }: { userId?: string }) {
  const tz = useUserTimezone()
  const [native, setNative] = useState(false)
  const [oldest, setOldest] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const stopRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { Capacitor } = await import('@capacitor/core')
      if (cancelled || !Capacitor.isNativePlatform()) return
      setNative(true)
      try {
        const stored = await fetchHistoryOldest()
        if (!cancelled) setOldest(stored)
      } catch { /* the subtitle falls back to the prompt; a press reads it again */ }
    })()
    return () => { cancelled = true }
  }, [])

  async function handlePress() {
    if (running) { stopRef.current = true; return }
    if (!userId) return
    stopRef.current = false
    setRunning(true)
    const today = todayInTz(tz)
    try {
      const outcome = await importMoreHistory({
        tz,
        shouldStop: () => stopRef.current,
        onProgress: setOldest,
      })
      if (outcome === null) {
        toast.error('Import needs the app (Health Connect) - not available on web')
        return
      }
      if (outcome.oldest) setOldest(outcome.oldest)
      const message = importEndMessage(outcome, today)
      if (outcome.end === 'failed') toast.error(message, { duration: 15000 })
      else toast.success(message)
      // The rows landed on the server. Drop what derives from them, then pull them to this device
      // the way "Sync now" does - the pull reaches back 90 days; older history stays on the server
      // until "Restore from cloud".
      if (outcome.windows > 0) {
        await Promise.all([invalidateBiometrics(), invalidateActivityWrites()])
        try {
          const pulled = await pullDelta(userId, true)
          if (pulled) await invalidatePulledDomains(pulled.domains)
        } catch (err) { console.error('[history-import] pull after import failed:', err) }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[history-import] failed:', err)
      toast.error(`Import failed: ${msg}`, { duration: 15000 })
    } finally {
      setRunning(false)
    }
  }

  if (!native) return null

  const today = todayInTz(tz)
  const subtitle = running
    ? (oldest ? `Importing... reached ${formatImportedTo(oldest, today)}` : 'Importing...')
    : (oldest ? `Imported to ${formatImportedTo(oldest, today)}. Tap to go ${HISTORY_WINDOW_DAYS} days further.`
              : `Pull older Health Connect data, ${HISTORY_WINDOW_DAYS} days at a time`)

  return (
    <button
      type="button"
      onClick={handlePress}
      className="flex w-full items-center justify-between px-4 py-3 hover:bg-muted/60 transition"
    >
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-muted">
          {running
            ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            : <History className="h-4 w-4 text-muted-foreground" />
          }
        </div>
        <div className="text-left">
          <p className="text-sm font-semibold">{running ? 'Stop importing' : 'Import more history'}</p>
          <p className="text-[10px] text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      {running && <Square className="h-4 w-4 text-muted-foreground" />}
    </button>
  )
}
